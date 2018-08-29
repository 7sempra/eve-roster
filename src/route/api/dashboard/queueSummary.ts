import { jsonEndpoint } from '../../../express/protectedEndpoint';
import { dao } from '../../../dao';

import { parallelize } from '../../../util/asyncUtil';
import { loadSummarizedQueue, SkillQueueSummary } from '../../../domain/skills/skillQueueSummarizer';


export type Payload = Array<{
  id: number,
  skillQueue: SkillQueueSummary,
}>

export default jsonEndpoint(function(req, res, db, account, privs)
    : Promise<Payload> {
  return Promise.resolve()
  .then(() => {
    return dao.character.getCharacterIdsOwnedByAccount(db, account.id);
  })
  .then(ids => {
    return parallelize(ids, id => {
      return loadSummarizedQueue(db, id, 'fresh')
      .then(summary => {
        return {
          id: id,
          skillQueue: summary,
        };
      });
    });
  });
});
