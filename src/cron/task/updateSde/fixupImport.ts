import { Tnex, val } from '../../../tnex';
import { sdeImport, sdeType, sdeAttribute, sdeTypeAttribute } from '../../../dao/tables';
import * as c from '../../../eve/sde/constants';

/**
 * Repair or remove and inconsistencies in the imported SDE data, such as
 * incompletely-defined attributes or inconsistent data patterns. There are a
 * surprising number of these, but most can be ignored.
 */
export async function fixupImport(db: Tnex) {
  await deleteIncompleteSocialSkillRequirement(db);
}

/**
 * The "Social" skillbook defines a required skill level but not a required
 * skill.
 */
async function deleteIncompleteSocialSkillRequirement(db: Tnex) {
  const SOCIAL_SKILLBOOK_TYPE_ID = 3355;
  
  const missingAttribute = await db
      .select(sdeTypeAttribute)
      .where('sta_type', '=', val(SOCIAL_SKILLBOOK_TYPE_ID))
      .where('sta_attribute', '=', val(c.DGM_ATTR_REQUIRED_SKILL_1))
      .fetchFirst();
  
  if (missingAttribute != null) {
    throw new Error(`Obsolete fixup: deleteIncompleteSocialSkillRequirement`);
  }

  const count = await db
      .del(sdeTypeAttribute)
      .where('sta_type', '=', val(SOCIAL_SKILLBOOK_TYPE_ID))
      .where('sta_attribute', '=', val(c.DGM_ATTR_REQUIRED_SKILL_1_LEVEL))
      .run();

  if (count != 1) {
    throw new Error(`Obsolete fixup: deleteIncompleteSocialSkillRequirement`);
  }
}
