// Visual workflow <-> DSL condition. Series chain Trigger→c1→c2→Action = `all` (AND); parallel branches Trigger→cN→Action = `any` (OR).
// Shapes match @xyflow/react Node/Edge so the canvas can use them directly.
import { FIELDS, RULE_ACTIONS, type Condition, type Field, type Leaf, type Value } from "./dsl.ts";

export type RuleAction = (typeof RULE_ACTIONS)[number];
export type CondData = { field: Field; op: Leaf["op"]; text: string };
export type ActionData = { action: RuleAction };
export type WfNode =
  | { id: string; type: "trigger"; position: { x: number; y: number }; data: Record<string, never>; deletable?: boolean }
  | { id: string; type: "condition"; position: { x: number; y: number }; data: CondData }
  | { id: string; type: "action"; position: { x: number; y: number }; data: ActionData };
export type WfEdge = { id: string; source: string; target: string };

export const FIELD_LABEL: Record<Field, string> = {
  amount: "Transfer amount", hourOfDay: "Transaction hour (WIB)", isNewBeneficiary: "New beneficiary account", screenSharingAppDetected: "Screen sharing app",
  isVpnDetected: "VPN detected", ipCountry: "IP country", copyPasteEventsOnBeneficiaryField: "Account no. copy-paste", deviceRooted: "Rooted device",
  sharedDeviceWith: "Shared device",
};
export const OPS_FOR: Record<(typeof FIELDS)[Field], Leaf["op"][]> = {
  number: [">", ">=", "<", "<=", "==", "!=", "in"], boolean: ["==", "!="], string: ["==", "!=", "in"], "string?": ["isNotNull", "==", "!=", "in"],
};
// Sensible starting point when a block is dropped on the canvas.
export const DEFAULTS: Record<Field, Omit<CondData, "field">> = {
  amount: { op: ">", text: "10000000" }, hourOfDay: { op: "in", text: "0, 1, 2, 3, 4" }, isNewBeneficiary: { op: "==", text: "true" },
  screenSharingAppDetected: { op: "isNotNull", text: "" }, isVpnDetected: { op: "==", text: "true" }, ipCountry: { op: "!=", text: "ID" },
  copyPasteEventsOnBeneficiaryField: { op: ">=", text: "2" }, deviceRooted: { op: "==", text: "true" }, sharedDeviceWith: { op: ">=", text: "2" },
};

const toText = (v: Value | undefined) => (v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));
function toValue({ field, op, text }: CondData): Value | undefined {
  if (op === "isNotNull") return undefined;
  const base = FIELDS[field].replace("?", "");
  const one = (t: string) => (base === "number" ? (t.trim() === "" ? NaN : Number(t)) : base === "boolean" ? t === "true" : t.trim());
  return op === "in" ? text.split(",").map((t) => t.trim()).filter(Boolean).map(one) as (string | number)[] : one(text);
}

export const leafOf = (d: CondData): Leaf => ({ field: d.field, op: d.op, ...(d.op !== "isNotNull" && { value: toValue(d) }) });

const X = 260, Y = 130;
export function toGraph(condition: Condition, action: RuleAction): { nodes: WfNode[]; edges: WfEdge[] } {
  const leaves = condition.all ?? condition.any ?? [], series = !!condition.all;
  const conds: WfNode[] = leaves.map((l, i) => ({
    id: `c${i}`, type: "condition", data: { field: l.field, op: l.op, text: toText(l.value) },
    position: series ? { x: 0, y: Y * (i + 1) } : { x: (i - (leaves.length - 1) / 2) * X, y: Y },
  }));
  const nodes: WfNode[] = [
    { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: {}, deletable: false },
    ...conds,
    { id: "action", type: "action", position: { x: 0, y: series ? Y * (leaves.length + 1) : Y * 2 + 20 }, data: { action } },
  ];
  const ids = conds.map((c) => c.id);
  const edges = series
    ? ["trigger", ...ids, "action"].slice(1).map((t, i, a) => ({ id: `e${i}`, source: i ? a[i - 1] : "trigger", target: t }))
    : ids.flatMap((c, i) => [{ id: `t${i}`, source: "trigger", target: c }, { id: `a${i}`, source: c, target: "action" }]);
  return { nodes, edges };
}

export function toRule(nodes: WfNode[], edges: WfEdge[]): { error: string } | { condition: Condition; action: RuleAction; mode: "all" | "any" } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = (id: string) => edges.filter((e) => e.source === id).map((e) => byId.get(e.target)).filter((n) => !!n);
  const trigger = nodes.find((n) => n.type === "trigger"), actions = nodes.filter((n) => n.type === "action");
  if (!trigger) return { error: "Trigger block is missing. Click \"New rule\" to start over." };
  if (actions.length !== 1) return { error: actions.length ? "Only one Action block is allowed." : "Add an Action block at the end of the flow." };
  const first = next(trigger.id);
  if (!first.length) return { error: "Connect Trigger to the first condition block." };

  const used: WfNode[] = [];
  let mode: "all" | "any" = "all";
  if (first.length === 1) {
    let cur = first[0];
    while (cur.type === "condition") {
      if (used.includes(cur)) return { error: "The flow must not loop back." };
      used.push(cur);
      const nx = next(cur.id);
      if (nx.length !== 1) return { error: `"${FIELD_LABEL[cur.data.field]}" must connect to exactly one next block.` };
      cur = nx[0];
    }
    if (cur.type !== "action") return { error: "The flow must end at an Action block." };
  } else {
    mode = "any";
    for (const c of first) {
      if (c.type !== "condition") return { error: "Parallel branches from Trigger must be condition blocks." };
      const nx = next(c.id);
      if (nx.length !== 1 || nx[0].type !== "action") return { error: `Parallel branch "${FIELD_LABEL[c.data.field]}" must connect directly to the Action.` };
      used.push(c);
    }
  }
  if (!used.length) return { error: "Add at least one condition block between Trigger and Action." };
  if (nodes.some((n) => n.type === "condition" && !used.includes(n))) return { error: "A condition block is not connected to the flow." };
  const leaves = used.map((n) => leafOf(n.data as CondData));
  return { condition: mode === "all" ? { all: leaves } : { any: leaves }, action: (actions[0].data as ActionData).action, mode };
}
