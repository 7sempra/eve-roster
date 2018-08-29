import { Tnex } from '../../tnex';
import { dao } from '../../dao';
import { pluck } from '../../util/underscore';
import { jsonEndpoint } from '../../express/protectedEndpoint';
import { AccountPrivileges } from '../../express/privileges';
import { idParam } from '../../route-helper/paramVerifier';
import * as policy from '../../route-helper/policy';
import { NotFoundError } from '../../error/NotFoundError';
import { buildLoggerFromFilename } from '../../logs/buildLogger';


const logger = buildLoggerFromFilename(__filename);


interface Output {
  character: {
    name: string
    corporationId: number,
    titles: string[],
    totalSp: number,
  },
  account: {
    id: number | null,
    groups: string[],
    activeTimezone?: string | null,
    citadelName?: string | null,
    main?: CharacterRef,
    alts?: CharacterRef[],
  },
  access: {
    [key: string]: number,
  },
  timezones?: string[],
  citadels?: string[],
}

interface CharacterRef { id: number, name: string, }

export default jsonEndpoint((req, res, db, account, privs): Promise<Output> => {
  let characterId = idParam(req, 'id');
  let accountId: number | null;
  let isOwned = false;
  let payload: Output;

  // Fetch character and account data
  return Promise.resolve()
  .then(() => {
    return dao.character.getDetailedCharacterStats(db, characterId);
  })
  .then(row => {
    if (row == null) {
      throw new NotFoundError();
    }
    accountId = row.account_id;
    isOwned = account.id == row.account_id;

    payload = {
      character: {
        name: row.character_name,
        corporationId: row.character_corporationId,
        titles: row.character_titles || [],
        totalSp: row.sp_total || 0,
      },
      account: {
        id: row.account_id,
        groups: [],
        main: undefined,
        alts: undefined,
      },
      access: privs.dumpForFrontend(
        [
          'memberTimezone',
          'memberHousing',
          'characterSkills',
          'characterSkillQueue',
        ],
        isOwned),
    };

    if (privs.canRead('memberTimezone', isOwned)) {
      payload.account.activeTimezone = row.account_activeTimezone;
    }

    if (privs.canRead('memberHousing', isOwned)) {
      payload.account.citadelName = row.citadel_name;
    }

    if (privs.canRead('memberAlts', isOwned) && row.account_id != null) {
      if (row.account_mainCharacter == characterId) {
        return injectAlts(db, row.account_id, characterId, privs, payload);
      } else {
        return injectMain(db, row.account_id, payload);
      }
    }
  })
  .then(() => {
    if (privs.canWrite('memberTimezone', isOwned)) {
      payload.timezones = policy.TIMEZONE_LABELS;
    }
    if (privs.canWrite('memberHousing', isOwned)) {
      return dao.citadel.getAll(db, ['citadel_name'])
      .then(rows => {
        payload.citadels = pluck(rows, 'citadel_name');
      });
    }
  })
  .then(() => {
    if (accountId != null && privs.canRead('memberGroups')) {
      return dao.group.getAccountGroups(db, accountId)
      .then(groups => {
        payload.account.groups = groups;
      });
    }
  })
  .then(() => {
    return payload;
  });
});

function injectAlts(
    db: Tnex,
    accountId: number,
    thisCharacterId: number,
    privs: AccountPrivileges,
    payload: Output,
    ) {
  return dao.account.getAlts(db, accountId)
  .then(function(rows) {
    let alts = [];
    for (let row of rows) {
      if (row.ownership_opsec && !privs.canRead('memberOpsecAlts')) {
        continue;
      }
      alts.push({
        id: row.character_id,
        name: row.character_name,
      });
    }
    alts.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });

    if (alts.length > 0) {
      payload.account.alts = alts;
    }
  });
}

function injectMain(db: Tnex, accountId: number, payload: Output) {
  return dao.account.getMain(db, accountId)
  .then(row => {
    if (row == null) {
      logger.error(`(in character.ts) Account ${accountId} has a null main.`);
      return;
    }

    payload.account.main = {
      id: row.character_id,
      name: row.character_name,
    };
  });
}
