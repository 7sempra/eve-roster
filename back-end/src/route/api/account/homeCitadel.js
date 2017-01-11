const Promise = require('bluebird');

const dao = require('../../../dao');
const jsonEndpoint = require('../../../route-helper/jsonEndpoint');
const BadRequestError = require('../../../error/BadRequestError');

module.exports = jsonEndpoint(function(req, res, accountId, privs) {
  let targetAccountId = req.params.id;
  let citadelName = req.body.citadelName;
  let isOwner = targetAccountId == accountId;

  privs.requireWrite('memberHousing', isOwner);

  return dao.getCitadelByName(citadelName)
  .then(([row]) => {
    if (!row) {
      throw new BadRequestError('Unknown citadel: ' + citadelName);
    }
    return dao.setAccountCitadel(targetAccountId, row.id);
  })
  .then(() => {
    return {};
  });
});
