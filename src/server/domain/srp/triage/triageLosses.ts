import { AnnotatedKillmail } from "../../../../shared/types/killmail/AnnotatedKillmail.js";
import { Tnex } from "../../../db/tnex/index.js";
import { TRIAGE_RULES } from "./rules.js";
import { dao } from "../../../db/dao.js";
import { TriageVerdict, TriageRule, isFuncRule } from "./TriageRule.js";
import { SdeType } from "../../../db/tables.js";
import { fileURLToPath } from "url";
import { buildLoggerFromFilename } from "../../../infra/logging/buildLogger.js";

const logger = buildLoggerFromFilename(fileURLToPath(import.meta.url));

export interface LossRow {
  km_timestamp: number;
  km_data: AnnotatedKillmail;
  related_data: AnnotatedKillmail | null;
  account_mainCharacter: number | null;
}

export interface TriagedLoss {
  loss: LossRow;
  suggestedVerdicts: TriageVerdict[];
}

/**
 * Given a list of losses, generates suggested SRP verdicts for each one.
 */
export async function triageLosses(
  db: Tnex,
  rows: LossRow[],
): Promise<TriagedLoss[]> {
  const shipDefs = await loadShipDefs(db, rows);

  return rows.map((row) => {
    return {
      loss: row,
      suggestedVerdicts: triageLoss(
        TRIAGE_RULES,
        row.km_data,
        row.related_data,
        row.account_mainCharacter,
        shipDefs,
      ),
    };
  });
}

/** For each type ID, load its associated group ID and market group ID. */
async function loadShipDefs(
  db: Tnex,
  losses: LossRow[],
): Promise<Map<number, ShipDef>> {
  const ids = new Set<number>();
  for (const loss of losses) {
    ids.add(loss.km_data.victim.ship_type_id);
    if (loss.related_data) {
      ids.add(loss.related_data.victim.ship_type_id);
    }
  }

  const rows = await dao.sde.getTypes(db, Array.from(ids), [
    "styp_id",
    "styp_group",
    "styp_marketGroup",
  ]);

  const map = new Map<number, ShipDef>();
  for (const row of rows) {
    map.set(row.styp_id, row);
  }

  if (map.size < ids.size) {
    for (const type of ids) {
      if (!map.has(type)) {
        logger.error(`Unknown ship ID "${type}".`);
      }
    }
  }

  return map;
}

function triageLoss(
  rules: TriageRule[],
  killmail: AnnotatedKillmail,
  relatedKillmail: AnnotatedKillmail | null,
  mainCharacter: number | null,
  shipDefs: Map<number, ShipDef>,
) {
  const triage = [];
  for (const rule of rules) {
    const results = executeRule(
      rule,
      killmail,
      relatedKillmail,
      mainCharacter,
      shipDefs,
    );
    if (results != undefined) {
      for (const result of results) {
        triage.push(result);
      }
    }
  }
  return triage;
}

function executeRule(
  rule: TriageRule,
  killmail: AnnotatedKillmail,
  relatedKillmail: AnnotatedKillmail | null,
  mainCharacter: number | null,
  shipDefs: Map<number, ShipDef>,
) {
  const shipDef = shipDefs.get(killmail.victim.ship_type_id);
  if (shipDef == undefined) {
    return undefined;
  }

  if (!testFilter(rule.filter, killmail, shipDef)) {
    return undefined;
  }
  if (rule.filter.relatedLoss != undefined) {
    if (relatedKillmail == undefined) {
      return undefined;
    }
    const shipDef = shipDefs.get(relatedKillmail.victim.ship_type_id);
    if (shipDef == undefined) {
      return undefined;
    }
    if (!testFilter(rule.filter.relatedLoss, relatedKillmail, shipDef)) {
      return undefined;
    }
  }
  if (isFuncRule(rule)) {
    return rule.discriminant(killmail, {
      shipGroup: shipDef.styp_group,
      shipMarketGroup: shipDef.styp_marketGroup,
      mainCharacter,
      relatedKillmail,
    });
  } else {
    return rule.verdicts;
  }
}

function testFilter(
  match: TriageRule["filter"],
  killmail: AnnotatedKillmail,
  shipDef: ShipDef,
) {
  if (
    match.tag != undefined &&
    ((match.tag == "npc" && !killmail.zkb.npc) ||
      (match.tag == "solo" && !killmail.zkb.solo))
  ) {
    return false;
  }
  if (
    match.groupId != undefined &&
    match.groupId.indexOf(shipDef.styp_group) == -1
  ) {
    return false;
  }
  if (
    match.marketGroupId != undefined &&
    match.marketGroupId.indexOf(shipDef.styp_marketGroup) == -1
  ) {
    return false;
  }
  if (
    match.shipId != undefined &&
    match.shipId.indexOf(shipDef.styp_id) == -1
  ) {
    return false;
  }
  return true;
}

type ShipDef = Pick<SdeType, "styp_id" | "styp_group" | "styp_marketGroup">;
