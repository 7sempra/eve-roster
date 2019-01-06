import Bluebird = require('bluebird');

import { jsonEndpoint } from '../../../infra/express/protectedEndpoint';
import { dao } from '../../../db/dao';
import { Tnex } from '../../../db/tnex';
import { MemberCorporation, GroupTitle } from '../../../db/tables';
import { SimpleMap } from '../../../util/simpleTypes';
import { censor } from './_censor';
import { Input as Output } from './setup_PUT';

type CorporationConfig = Output['corporations'][0];

export default jsonEndpoint((req, res, db, account, privs) => {
  privs.requireRead('serverConfig', false);

  return Promise.all([
    dao.config.getSiggyCredentials(db),
    getCorpConfig(db),
  ])
  .then(([siggyConfig, corpConfig]) => {
    corpConfig.sort(configSorter);

    if (corpConfig.length == 0) {
      corpConfig.push(EXAMPLE_CORP_CONFIG);
    }

    return {
      siggy: {
        username: siggyConfig.username,
        password: censor(siggyConfig.password, 0, 10),
      },
      corporations: corpConfig,
    };
  });
});

function getCorpConfig(db: Tnex) {
  return Promise.resolve()
  .then(() => dao.config.getMemberCorporations(db))
  .then(configRows => {
    return Bluebird.map(
        configRows,
        configRow => convertCorpConfigRowToJson(db, configRow));
  });
}

function convertCorpConfigRowToJson(
    db: Tnex,
    row: MemberCorporation,
    ): Promise<CorporationConfig> {
  return Promise.resolve()
  .then(() => {
    return dao.config.getCorpTitleToGroupMapping(
        db,
        row.mcorp_corporationId);
  })
  .then(mappingRows => {
    return {
      id: row.mcorp_corporationId,
      membership: row.mcorp_membership,
      titles: createTitleMap(mappingRows),
    };
  });
}

function createTitleMap(
    mapRows: Pick<GroupTitle, "groupTitle_title" | "groupTitle_group">[]) {
  let map = {} as SimpleMap<string>;
  for (let row of mapRows) {
    map[row.groupTitle_title] = row.groupTitle_group;
  }
  return map;
}

function configSorter(a: CorporationConfig, b: CorporationConfig) {
  if (a.membership == 'full'
      && b.membership != 'full') {
    return -1;
  } else if (b.membership == 'full'
      && a.membership != 'full') {
    return 1;
  } else {
    return 0;
  }
}

const EXAMPLE_CORP_CONFIG = {
  id: 123456,
  membership: 'full/affiliated',
  titles: {
    'Staff': 'admin',
    'Line Member': 'full_member',
    'Greenie': 'provisional_member',
  },
};
