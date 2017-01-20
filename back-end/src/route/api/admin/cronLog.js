const Promise = require('bluebird');

const dao = require('../../../dao');
const protectedEndpoint = require('../../../route-helper/protectedEndpoint');

module.exports = protectedEndpoint('json', (req, res, account, privs) => {
  privs.requireRead('cronLogs', false);

  return dao.getCronLogsRecent()
  .then(rows => {
    return {
      rows: rows,
    };
  });
});
