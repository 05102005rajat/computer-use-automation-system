// In-memory "core banking" data store for the mock legacy target app.
// Deliberately includes SSN-like data so the redaction layer has something real to scrub.

export interface SubAccount {
  id: string;
  type: string;
  nickname: string;
  balance: number;
}

export interface Member {
  id: string;
  name: string;
  status: "active" | "frozen";
  savingsBalance: number;
  ssn: string;
  subAccounts: SubAccount[];
}

export const members: Record<string, Member> = {
  "10023": {
    id: "10023",
    name: "Dana Whitfield",
    status: "active",
    savingsBalance: 4382.1,
    ssn: "512-11-4477",
    subAccounts: [],
  },
  "10099": {
    id: "10099",
    name: "Marcus Ojo",
    status: "frozen",
    savingsBalance: 950.0,
    ssn: "488-22-9901",
    subAccounts: [],
  },
  "40040": {
    id: "40040",
    name: "Priya Nandakumar",
    status: "active",
    savingsBalance: 12500.55,
    ssn: "601-33-1120",
    subAccounts: [],
  },
};

let subAccountSeq = 1000;
export function nextSubAccountId(): string {
  subAccountSeq += 1;
  return `SA-${subAccountSeq}`;
}

// Sessions: sessionId -> username. In-memory only, never persisted.
export const sessions = new Map<string, { username: string }>();

// Member 40040 is wired to force a "session expired" interstitial the first time
// its sub-account form is opened in a given session, to give replay something
// recoverable to detect. Tracked per-session so replay runs are independent.
export const sessionExpiryTriggered = new Set<string>();
