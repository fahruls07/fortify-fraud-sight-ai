import { matches, type Features, type Rule } from "./rules/dsl.ts";

// Active Rule Builder rules, evaluated on one transaction's features. Strictest action wins:
// DECLINE > CHALLENGE > HOLD. An ALLOW rule is an exception that only applies when no stricter rule matched.
export const STRICT = { DECLINE: 3, CHALLENGE: 2, HOLD: 1, ALLOW: 0 } as const;
export type RuleOutcome = { hits: Pick<Rule, "id" | "name" | "action" | "severity" | "expression">[]; action: Rule["action"] | null };

export function evaluateRules(rules: Rule[], f: Features): RuleOutcome {
  const hits = rules.filter((r) => r.status === "Active" && matches(r.condition, f)).map(({ id, name, action, severity, expression }) => ({ id, name, action, severity, expression }));
  const action = hits.reduce<Rule["action"] | null>((a, r) => (a === null || STRICT[r.action] > STRICT[a] ? r.action : a), null);
  return { hits, action };
}
