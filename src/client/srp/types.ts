export type Loss = {
  payout: number;
  killmail: number;
};
export type Payment = {
  paid: boolean;
  payer: number;
  recipient: number;
  modified: number;
  modifiedLabel: string;
  totalPayout: number;
};
export type Battle = {
  teams: {
    totalLosses: number;
  }[];
};

export type VerdictOption = {
  key: string;
  label: string;
  payout: number;
  verdict: string;
  reason: string | null;
};

export type Triage = {
  suggestedOption: string;
  extraOptions: VerdictOption[];
};

export type Srp = {
  status: string;
  reason: string;
  killmail: number;
  relatedKillmail: {
    id: number;
  };
  victim: number;
  victimCorp: number;
  executioner: {
    character: number;
    ship: number;
    alliance: number;
    corporation: number;
  };
  triage: null | Triage;
  payout: number | null;
  payingCharacter: number | null;
  renderingCharacter: number | null;
  reimbursement: number | null;
};
