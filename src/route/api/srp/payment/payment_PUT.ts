import { jsonEndpoint } from '../../../../route-helper/protectedEndpoint';
import { number, verify, boolean, optional } from '../../../../route-helper/schemaVerifier';
import { AccountSummary } from '../../../../route-helper/getAccountPrivs';
import { AccountPrivileges } from '../../../../route-helper/privileges';
import { Tnex } from '../../../../tnex';
import { dao } from '../../../../dao';
import { BadRequestError } from '../../../../error/BadRequestError';
import { NotFoundError } from '../../../../error/NotFoundError';
import { idParam } from '../../../../route-helper/paramVerifier';

export class Input {
  paid = boolean();
  payingCharacter = optional(number());
}
const inputSchema = new Input();

export interface Output {}


/**
 * Marks a reimbursement as paid (or unpaid).
 */
export default jsonEndpoint((req, res, db, account, privs): Promise<Output> => {

  return handleEndpoint(
      db, account, privs, idParam(req, 'id'), verify(req.body, inputSchema));
});

async function handleEndpoint(
    db: Tnex,
    account: AccountSummary,
    privs: AccountPrivileges,
    id: number,
    input: Input,
) {
  privs.requireWrite('srp');

  let updateCount;
  if (input.paid) {
    if (input.payingCharacter == undefined) {
      throw new BadRequestError(`Missing payingCharacter field.`);
    }
    updateCount =
        await dao.srp.markReimbursementAsPaid(db, id, input.payingCharacter);
  } else {
    updateCount = await dao.srp.markReimbursementAsUnpaid(db, id);
  }

  if (updateCount != 1) {
    throw new NotFoundError();
  }

  return {};
}
