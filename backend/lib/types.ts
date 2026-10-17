// Shapes follow 07 (seed), 01 (Alert), 02 (signals), 05 (network). Extra fields are marked "added".
export type Level = "LOW" | "MEDIUM" | "HIGH";

export interface Customer {
  id: string; name: string; age: number; segment: string; city: string; homeCountry: string;
  customerSince: string; riskProfile: Level;
  accountId: string; maskedAccount: string; accountStatus: "ACTIVE" | "FROZEN";
  avgDailySpend: number; usualDevice: string; usualActiveHours: { from: string; to: string };
  knownBeneficiaries: string[]; phone?: string;
  sessionBaseline: { hesitationTimeMs: number; typingCadenceDeviation: number; sessionDurationSec: number; navigationPattern: string };
}

export interface Transaction {
  id: string; customerId: string; accountId: string; sessionId: string | null;
  amount: number; currency: "IDR"; createdAt: string; channel: string;
  beneficiary: { accountId: string; bankName: string; name: string; isNew: boolean; accountAgeDays: number };
  status: "COMPLETED" | "HELD" | "RELEASED" | "DECLINED" | "CHALLENGE_SENT";
}

export interface Alert {
  id: string; transactionId: string; customerId: string; createdAt: string;
  baselineScore: number; baselineLevel: Level; aiLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "New" | "Investigating" | "Decided"; assignedTo: string;
  hits?: import("./intel").Hit[];       // watchlist / AML matches at scoring time
  slaDueAt?: string; escalated?: boolean; escalatedAt?: string; caseId?: string;
}

export interface Session {
  id: string; customerId: string; startedAt: string;
  deviceModel: string; deviceRooted: boolean; isVpnDetected: boolean; ipCountry: string;
  screenSharingAppDetected: string | null; isNewDevice: boolean;
  copyPasteEventsOnBeneficiaryField: number; hesitationTimeMs: number; typingCadenceDeviation: number;
  sessionDurationSec: number; navigationPattern: string;
  pinCorrect: boolean; failedPinAttempts: number; // added: needed by baseline rule "correct PIN / no failed attempts"
}

export interface Network {
  centerAccountId: string; linkedAccountsCount: number; sharedDeviceWith: number;
  nodes: { id: string; label: string; type: string; flagged: boolean }[];
  edges: { source: string; target: string; type: "SHARED_DEVICE" | "TRANSFER"; amount?: number }[];
}

export interface ReasonCode { code: string; title: string; description: string; defaultSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }

export interface Seed {
  meta: { anchor: string; refreshedAt?: string }; // refreshedAt: last demo-refresh marker, kept so refresh() stays idempotent
  customers: Customer[]; transactions: Transaction[]; alerts: Alert[]; sessions: Session[];
  network: Record<string, Network>; reasonCodes: ReasonCode[];
  kb: { docId: string; title: string; tags: string[]; body: string }[];
  fallbacks: Record<string, unknown>;
  attackTemplate: Omit<Transaction, "id" | "sessionId" | "createdAt" | "status">; // Budi's live transfer, 07 §3
}

// 04 §6 (AuditEvent); Decision backs §5 (label, followedAi) and the KPIs. Kept outside Alert so the M7 schema is untouched.
export interface AuditEvent {
  id: string; at: string; actor: string; entityType: "alert" | "account" | "rule" | "user"; entityId: string; action: string;
  before: Record<string, unknown>; after: Record<string, unknown>; reason: string | null; aiRecommendation: string | null;
}
export type DecisionAction = "APPROVE" | "CHALLENGE" | "DECLINE" | "DECLINE_AND_FREEZE";
export interface Decision {
  alertId: string; action: Exclude<DecisionAction, "CHALLENGE">; label: "FRAUD" | "NOT_FRAUD"; followedAi: boolean;
  reason: string | null; decidedBy: string; decidedAt: string; amount: number;
}

// 03 §7. `typology` is an enum here (PRD shows a bare string) so the UI can map it; NONE covers legitimate/low-risk cases.
export const TYPOLOGIES = ["SOCIAL_ENGINEERING_SCREEN_SHARING", "MULE_ACCOUNT", "ACCOUNT_TAKEOVER", "PHISHING_CREDENTIAL_THEFT", "AUTHORISED_PUSH_PAYMENT", "NONE"] as const;
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const AI_ACTIONS = ["ALLOW", "CHALLENGE", "HOLD", "DECLINE", "DECLINE_AND_FREEZE"] as const;
export interface InvestigationReport {
  riskLevel: (typeof RISK_LEVELS)[number]; confidence: number; typology: (typeof TYPOLOGIES)[number]; headline: string; summary: string;
  reasonCodes: { code: string; severity: (typeof RISK_LEVELS)[number]; evidence: string; explanation: string }[];
  baselineComparison: string; recommendedAction: (typeof AI_ACTIONS)[number]; nextSteps: string[];
  citations: { docId: string; title: string }[];
}
export interface TraceEvent { step: "plan" | "tool" | "synthesize"; tool?: string; detail: string; at: string; ms: number }
export interface Investigation {
  id: string; alertId: string; status: "running" | "done" | "failed"; events: TraceEvent[];
  report?: InvestigationReport; fallback: boolean; error?: string; startedAt: string; finishedAt?: string;
}
