// 06 §4 constrained DSL. Rules are data, never code. shortcut: conditions are one flat all/any group, no nesting; upgrade if a demo rule needs it.
export const FIELDS = {
  amount: "number", hourOfDay: "number", isNewBeneficiary: "boolean", screenSharingAppDetected: "string?", isVpnDetected: "boolean",
  ipCountry: "string", copyPasteEventsOnBeneficiaryField: "number", deviceRooted: "boolean", sharedDeviceWith: "number",
} as const;
export const OPS = [">", ">=", "<", "<=", "==", "!=", "in", "isNotNull"] as const;
export const RULE_ACTIONS = ["ALLOW", "CHALLENGE", "HOLD", "DECLINE"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type Field = keyof typeof FIELDS;
export type Value = string | number | boolean | (string | number)[];
export interface Leaf { field: Field; op: (typeof OPS)[number]; value?: Value }
export interface Condition { all?: Leaf[]; any?: Leaf[] }
export interface RuleBody {
  name: string; description: string; condition: Condition; expression: string;
  action: (typeof RULE_ACTIONS)[number]; severity: (typeof SEVERITIES)[number];
}
export interface Rule extends RuleBody { id: string; status: "Draft" | "Active"; createdBy: string; createdAt: string; updatedAt?: string; updatedBy?: string }

const show = (v: unknown) => JSON.stringify(v);
const leafExpr = (l: Leaf) => l.op === "isNotNull" ? `${l.field} != null` : `${l.field} ${l.op} ${show(l.value)}`;
export const renderExpression = (c: Condition) => (c.all ?? c.any ?? []).map(leafExpr).join(c.all ? " && " : " || ");

function checkLeaf(l: unknown): string | null {
  const x = l as Leaf;
  if (!x || typeof x !== "object" || !(x.field in FIELDS)) return `unknown field ${(x as Leaf)?.field}`;
  if (!OPS.includes(x.op)) return `unknown operator ${x.op}`;
  const t = FIELDS[x.field], base = t.replace("?", "");
  if (x.op === "isNotNull") return t.endsWith("?") && x.value === undefined ? null : `${x.field}: isNotNull needs a nullable field and no value`;
  if (["<", "<=", ">", ">="].includes(x.op) && base !== "number") return `${x.field}: ${x.op} is for numbers only`;
  if (base === "boolean" && x.op === "in") return `${x.field}: in is not valid for booleans`;
  const okType = (v: unknown) => typeof v === base;
  if (x.op === "in") { if (!Array.isArray(x.value) || !x.value.length || !x.value.every(okType)) return `${x.field}: in needs a non-empty ${base} array`; }
  else if (!okType(x.value)) return `${x.field}: value must be a ${base}`;
  if (x.field === "hourOfDay" && [x.value].flat().some((v) => (v as number) < 0 || (v as number) > 23)) return "hourOfDay must be 0-23";
  return null;
}

// Trust boundary: used for Gemini output and for client-submitted rules alike. The expression is always recomputed here.
export function validateRule(raw: unknown): { error: string } | { rule: RuleBody } {
  const r = raw as Partial<RuleBody> | null;
  if (!r || typeof r !== "object") return { error: "rule must be an object" };
  if (typeof r.name !== "string" || !r.name.trim() || typeof r.description !== "string" || !r.description.trim()) return { error: "name and description are required" };
  if (!RULE_ACTIONS.includes(r.action as never)) return { error: `action must be one of ${RULE_ACTIONS.join(", ")}` };
  if (!SEVERITIES.includes(r.severity as never)) return { error: `severity must be one of ${SEVERITIES.join(", ")}` };
  const c = r.condition;
  const group = c && typeof c === "object" ? ((c.all ? 1 : 0) + (c.any ? 1 : 0) === 1 ? (c.all ?? c.any) : null) : null;
  if (!Array.isArray(group) || !group.length) return { error: "condition needs exactly one non-empty all/any list" };
  for (const l of group) { const e = checkLeaf(l); if (e) return { error: e }; }
  const condition: Condition = c!.all ? { all: c!.all } : { any: c!.any };
  return { rule: { name: r.name.trim(), description: r.description.trim(), condition, expression: renderExpression(condition), action: r.action!, severity: r.severity! } };
}

export type Features = Record<Field, string | number | boolean | null>;
const test = (l: Leaf, f: Features) => {
  const v = f[l.field];
  switch (l.op) {
    case "isNotNull": return v != null;
    case "in": return (l.value as unknown[]).includes(v);
    case "==": return v === l.value;
    case "!=": return v !== l.value;
    default: return v != null && (l.op === ">" ? v > l.value! : l.op === ">=" ? v >= l.value! : l.op === "<" ? v < l.value! : v <= l.value!);
  }
};
export const matches = (c: Condition, f: Features) => (c.all ? c.all.every((l) => test(l, f)) : c.any!.some((l) => test(l, f)));
