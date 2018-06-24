import moment = require('moment');

import { dao } from '../../dao';
import { Tnex } from '../../tnex';
import { BasicRosterCharacter, OwnedRosterCharacter } from '../../dao/RosterDao';
import { AccountPrivileges } from '../../route-helper/privileges';
import { jsonEndpoint } from '../../route-helper/protectedEndpoint';
import { isAnyEsiError } from '../../util/error';
import * as alert from '../../shared/rosterAlertLevels';
import { fetchEveNames } from '../../eve/names';
import { SimpleMap } from '../../util/simpleTypes';

const logger = require('../../util/logger')(__filename);

interface Output {
  columns: string[],
  rows: AccountJson[],
}

interface Alertable {
  alertLevel?: number,
  alertMessage?: string,
}

interface AccountJson extends Alertable {
  main: CharacterJson,
  alts: CharacterJson[],
  activeTimezone?: string | null,
  homeCitadel?: string | null,
}

interface CharacterJson extends Alertable {
  id: number,
  name: string,
  corporationId: number,
  corporationName: string,

  lastSeen?: number,
  lastSeenLabel: string | null,
  killsInLastMonth: number | null,
  killValueInLastMonth: number | null,
  lossesInLastMonth: number | null,
  lossValueInLastMonth: number | null,
  siggyScore: number | null,
}

export default jsonEndpoint((req, res, db, account, privs): Promise<Output> => {
  privs.requireRead('roster');

  return Promise.all([
    dao.roster.getCharactersOwnedByAssociatedAccounts(db),
    dao.roster.getUnownedCorpCharacters(db),
    getCorpNames(db),
  ])
  .then(([ownedChars, unownedChars, corpNames]) => {
    let accountList = [] as AccountJson[];

    pushAccounts(ownedChars, privs, corpNames, accountList);

    for (let unownedChar of unownedChars) {
      accountList.push(
          getJsonForUnownedCharacter(unownedChar, privs, corpNames));
    }

    return {
      columns: getProvidedColumns(privs),
      rows: accountList
    };
  });

});

function getCorpNames(db: Tnex) {
  return Promise.resolve()
  .then(() => {
    return dao.roster.getRosterCharacterCorps(db);
  })
  .then(corpIds => {
    return fetchEveNames(corpIds);
  })
  .catch(e => {
    if (isAnyEsiError(e)) {
      // Move on with a null map and show a warning later
      // FIXME attach warning to response object once warnings are supported
      // in the roster client view
      logger.error('ESI error fetching corporation names', e);
      return null;
    } else {
      // Re-throw since it's something more serious
      throw e;
    }
  })
}

function pushAccounts(
    ownedRows: OwnedRosterCharacter[],
    privs: AccountPrivileges,
    corpNames: SimpleMap<string> | null,
    outList: AccountJson[]) {

  interface AccountGroup {
    id: number,
    main: OwnedRosterCharacter | null,
    alts: OwnedRosterCharacter[]
  }

  let accountGroups = new Map<number, AccountGroup>();

  for (let row of ownedRows) {
    let accountId = row.account_id;
    let group = accountGroups.get(accountId);
    if (group == null) {
      group = {
        id: accountId,
        main: null,
        alts: [],
      };
      accountGroups.set(accountId, group);
    }
    if (row.character_id == row.account_mainCharacter) {
      group.main = row;
    } else {
      if (!row.ownership_opsec || privs.canRead('memberOpsecAlts')) {
        group.alts.push(row);
      }
    }
  }

  for (let group of accountGroups.values()) {
    if (group.main == null) {
      // TODO: Display an error without crashing.
      throw new Error(`Account ${group.id} has no main character.`);
    }

    outList.push(
        getJsonForAccount(
            group.main, group.alts, privs, corpNames));
  }
}

function getJsonForAccount(
    mainRow: OwnedRosterCharacter,
    altRows: OwnedRosterCharacter[],
    privs: AccountPrivileges,
    corpNames: SimpleMap<string> | null,
    ): AccountJson {
  let accountJson: AccountJson = {
    main: getJsonForCharacter(mainRow, 'main', privs, corpNames),
    alts: [],
  };

  if (mainRow.memberCorporation_membership != 'full') {
    if (mainRow.memberCorporation_membership == 'affiliated') {
      addAlert(
        accountJson,
        alert.LEVEL_WARNING,
        'Main character is not in primary corporation.');
    } else {
      addAlert(
        accountJson,
        alert.LEVEL_ERROR,
        'Main character is not in any affiliated corporation.');
    }
  }

  if (altRows != null && privs.canRead('memberAlts')) {
    accountJson.alts = altRows.map(
        char => getJsonForCharacter(char, 'alt', privs, corpNames));
  }

  if (privs.canRead('memberHousing')) {
    accountJson.activeTimezone = mainRow.account_activeTimezone;
  }

  if (privs.canRead('memberTimezone')) {
    accountJson.homeCitadel = mainRow.citadel_name;
  }

  if (mainRow.trialCheck_group != null) {
    addAlert(accountJson, alert.LEVEL_INFO, 'Trial member');
  }

  return accountJson;
}

function getJsonForUnownedCharacter(
    character: BasicRosterCharacter,
    privs: AccountPrivileges,
    corpNames: SimpleMap<string> | null,
    ): AccountJson {

  let json: AccountJson = {
    main: getJsonForCharacter(character, 'unowned', privs, corpNames),
    alts: [],
  };

  addAlert(json, alert.LEVEL_WARNING, 'Character is not claimed.');

  return json;
}

function getJsonForCharacter(
    row: BasicRosterCharacter,
    status: 'main' | 'alt' | 'unowned',
    privs: AccountPrivileges,
    corpNames: SimpleMap<string> | null,
    ): CharacterJson {
  let obj = {
    id: row.character_id,
    name: row.character_name,
    corporationId: row.character_corporationId,
    corporationName:
        corpNames && corpNames[row.character_corporationId]
            || 'Name unavailable'
  } as CharacterJson;

  if (row.memberCorporation_membership == 'full'
      || row.memberCorporation_membership == 'affiliated') {
    if (row.character_titles == null || row.character_titles.length == 0) {
      if (status == 'main') {
        addAlert(obj, alert.LEVEL_ERROR, 'Main does not have roles.');
      } else if (status == 'alt') {
        if (row.memberCorporation_membership == 'full') {
          addAlert(obj, alert.LEVEL_WARNING, 'Alt does not have roles.');
        }
      } else if (status == 'unowned') {
        addAlert(obj, alert.LEVEL_ERROR, 'Character does not have roles.');
      }
    }
    if (row.accessToken_needsUpdate) {
      addAlert(
          obj, alert.LEVEL_ERROR, `Character needs to be reauthenticated.`);
    }
  }

  if (privs.canRead('characterActivityStats')) {
    let lastSeen;
    let lastSeenLabel;
    if (row.character_logonDate != null && row.character_logoffDate != null) {
      lastSeen = row.character_logonDate > row.character_logoffDate
          ? Date.now() : row.character_logoffDate;
      lastSeenLabel = row.character_logonDate > row.character_logoffDate ?
          'now' : moment(row.character_logoffDate).fromNow();
    } else {
      lastSeen = 0;
      lastSeenLabel = null;
    }

    obj.lastSeen = lastSeen;
    obj.lastSeenLabel = lastSeenLabel;
    obj.killsInLastMonth = row.cstats_killsInLastMonth;
    obj.killValueInLastMonth = row.cstats_killValueInLastMonth;
    obj.lossesInLastMonth = row.cstats_lossesInLastMonth;
    obj.lossValueInLastMonth = row.cstats_lossValueInLastMonth;
    obj.siggyScore = row.character_siggyScore;
  }

  return obj;
}

function getProvidedColumns(privs: AccountPrivileges) {
  let providedColumns = [
    'id',
    'name',
    'corporationId',
    'corporationName',
    'alertMessage',
    'alertLevel'
  ];

  if (privs.canRead('memberAlts')) {
    providedColumns.push('alts');
  }
  if (privs.canRead('memberHousing')) {
    providedColumns.push('activeTimezone');
  }
  if (privs.canRead('memberTimezone')) {
    providedColumns.push('homeCitadel');
  }

  if (privs.canRead('characterActivityStats')) {
    providedColumns.push(
      'lastSeen',
      'killsInLastMonth',
      'killValueInLastMonth',
      'lossesInLastMonth',
      'lossValueInLastMonth',
      'siggyScore'
    );
  }
  return providedColumns;
}

function addAlert(target: Alertable, level: number, message: string) {
  if (target.alertMessage) {
    // Append message and possibly increase level
    target.alertMessage = target.alertMessage + '\n' + message;
    target.alertLevel = Math.max(target.alertLevel || 0, level);
  } else {
    // No previous message so set as-is
    target.alertMessage = message;
    target.alertLevel = level;
  }
}
