import { fetchHullMarketValues, resolvePayout } from './payout';
import { SrpTriageJson, VerdictOptionJson } from '../SrpLossJson';
import { SrpVerdictStatus } from '../../dao/enums';
import { TriagedLoss } from '../triage/triageLosses';


/**
 * Converts the output for triageLosses() to the triage format in SrpLossJson.
 */
export async function triagedLossesToSuggestionJson(
    triagedLosses: TriagedLoss[]
) {
  const marketValues = await fetchHullMarketValues(triagedLosses);

  const out = new Map<number, SrpTriageJson>();
  for (let triagedLoss of triagedLosses) {
    let suggestedKey: string | null = null;
    const suggestedVerdicts: VerdictOptionJson[] = [];

    for (let suggestion of triagedLoss.suggestedVerdicts) {
      let key: string = suggestion.status;
      if (suggestion.status == SrpVerdictStatus.APPROVED) {
        key = `extra_${suggestedVerdicts.length}`;
        suggestedVerdicts.push({
          label: suggestion.label,
          key: key,
          payout:
              resolvePayout(suggestion, triagedLoss.killmail, marketValues),
          verdict: suggestion.status,
        });
      } else if (suggestion.status == SrpVerdictStatus.INELIGIBLE) {
        key = `${suggestion.status}_${suggestion.reason}`;
      }
      if (suggestedKey == null) {
        suggestedKey = key;
      }
    }

    out.set(triagedLoss.killmail.killmail_id, {
      extraOptions: suggestedVerdicts,
      suggestedOption: suggestedKey || 'custom',
    });
  }
  return out;
}
