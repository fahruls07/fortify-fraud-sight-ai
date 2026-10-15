import { Type } from "@google/genai";
import { generate, geminiConfigured } from "./gemini.ts";
import { FIELDS as RULE_FIELDS, OPS, RULE_ACTIONS, SEVERITIES, validateRule, type Leaf, type Rule, type RuleBody } from "../rules/dsl.ts";
import { ACTIONS, CRITERIA_OPS, DB_QUERIES, FIELDS, GATEWAYS, KINDS, SOURCES, TARGETS, TRIGGERS, validateWorkflow, type WfNode, type WorkflowBody } from "../workflows.ts";

// Builder Assistant: chat that creates or edits a rule / workflow. Every proposal goes through the same validator as Save,
// and the user still reviews and saves it. Without Gemini an offline keyword builder answers (clearly labelled).
export type Kind = "rule" | "workflow";
export type Msg = { role: "user" | "assistant"; content: string };
export type BuildResult = { reply: string; proposal: RuleBody | WorkflowBody | null; source: "gemini" | "offline"; note?: string };

const SCHEMA = { type: Type.OBJECT, required: ["reply", "proposal_json"], properties: {
  reply: { type: Type.STRING, description: "Short answer to the user, in English, explaining what you built or changed" },
  proposal_json: { type: Type.STRING, description: "The COMPLETE new definition as a JSON string, or empty string if the user only asked a question" },
} };

const RULE_SYS = `You are the Rule Assistant of a bank fraud console. You help an analyst create or edit ONE fraud rule by chat (English or Indonesian input).
Output a complete rule as JSON: {"name","description","severity","action","condition":{"all":[...]} or {"any":[...]}}.
Leaf: {"field","op","value"}. Fields: ${Object.entries(RULE_FIELDS).map(([f, t]) => `${f} (${t})`).join(", ")}. Operators: ${OPS.join(" ")} (isNotNull takes no value; "in" takes an array).
Actions: ${RULE_ACTIONS.join(", ")} (block/blokir = DECLINE, review/tahan = HOLD, verify/flag = CHALLENGE). Severity: ${SEVERITIES.join(", ")}.
Amounts are full rupiah ("10 juta" = 10000000). "screen sharing app active" = screenSharingAppDetected isNotNull. When editing, keep what the user did not ask to change.
Name short, description one sentence, both English. If the request is unclear, ask one question and return an empty proposal_json.`;

const WF_SYS = (rules: Rule[]) => `You are the Workflow Assistant of a bank fraud console. You help an analyst create or edit ONE visual workflow by chat (English or Indonesian input).
Output the complete workflow JSON: {"name","description","nodes":[{"id","type","data","position":{"x","y"}}],"edges":[{"source","target"}]}. Ids are short strings "1","2"…; lay nodes out top-to-bottom (y += 130 per level, branches at x ±220).
Node types and data:
- trigger {event: ${Object.keys(TRIGGERS).join("|")}, source: ${Object.keys(SOURCES).join("|")}}  (exactly one, first)
- condition {mode:"AND"|"OR", conditions:[{field, operator, value}]} on event fields only
- criteria {mode, criteria:[{field, operator: ${CRITERIA_OPS.join("|")}, value}]} on ANY variable (event fields or outputs of earlier nodes)
- rule {ruleId, output} calls an existing rule; continues only if it matches. Rules: ${rules.map((r) => `${r.id} "${r.name}" (${r.expression})`).join("; ") || "none"}
- scoring {output, base, items:[{field, operator, value, points}]}
- calculation {expression, output} arithmetic with + - * / % ( ) min max abs round floor ceil sqrt log10 and variable names
- calc_field {input, output, buckets:[{max, label}], otherwise}
- db_query {query: ${Object.keys(DB_QUERIES).join("|")}, output}
- api_call {method:"GET"|"POST", url, body, path, output}
- ai {prompt, output} writes output (0-100) and output_label
- gateway {kind: ${Object.keys(GATEWAYS).join("|")}}; timer {minutes}
- action {action: ${Object.keys(ACTIONS).join("|")}, target: ${Object.keys(TARGETS).join("|")}, params:{}}; parallel_action {actions:[{action,target}, …]} (2+)
Event fields: ${Object.entries(FIELDS).map(([f, d]) => `${f} (${d.type})`).join(", ")}. Output variable names are lowercase snake_case and must not reuse an event field name.
Edges flow one way from the trigger; actions have no outgoing edges; at least one action. Amounts in full rupiah. When editing, keep unchanged nodes, ids and positions.
If the request is unclear, ask one question and return an empty proposal_json.`;

const LIMIT = 15000;

async function viaGemini(kind: Kind, messages: Msg[], current: unknown, rules: Rule[]): Promise<BuildResult> {
  const deadline = Date.now() + LIMIT;
  const history = messages.slice(-12).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  let prompt = `Current ${kind} definition (JSON, may be empty):\n${JSON.stringify(current ?? null)}\n\nConversation:\n${history}\n\nReply to the last user message.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await generate(prompt, AbortSignal.timeout(Math.max(1000, deadline - Date.now())), { systemInstruction: kind === "rule" ? RULE_SYS : WF_SYS(rules), responseSchema: SCHEMA });
    const j = JSON.parse(out.text) as { reply: string; proposal_json: string };
    if (!j.proposal_json?.trim()) return { reply: j.reply, proposal: null, source: "gemini" };
    let raw: unknown; try { raw = JSON.parse(j.proposal_json); } catch { raw = null; }
    const v = kind === "rule" ? validateRule(raw) : validateWorkflow(raw);
    if ("rule" in v) return { reply: j.reply, proposal: v.rule, source: "gemini" };
    if ("workflow" in v) return { reply: j.reply, proposal: v.workflow, source: "gemini" };
    prompt += `\n\nYour previous proposal was rejected by the validator: ${v.error}\nReturn a corrected complete definition.`; // one repair round
  }
  return { reply: "I could not produce a valid definition for that. Could you rephrase or simplify it?", proposal: null, source: "gemini" };
}

// ---------- Offline builder (keywords, English + Indonesian) ----------
const lc = (s: string) => s.toLowerCase();
function money(t: string): number | null {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(juta|jt|million|mio|m\b|miliar|billion|bn|ribu|rb|k\b)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", ".")), u = lc(m[2] ?? "");
  return Math.round(n * (/juta|jt|million|mio|^m$/.test(u) ? 1e6 : /miliar|billion|bn/.test(u) ? 1e9 : /ribu|rb|^k$/.test(u) ? 1e3 : 1));
}
type Signal = { leaf: Leaf | null; wf: { field: string; operator: string; value: number | boolean | string }; text: string };
function signals(t: string): Signal[] {
  const s = lc(t), out: Signal[] = [];
  const amt = s.match(/(?:amount|nominal|transfer|transaksi|jumlah|>|over|above|lebih dari|di atas|diatas)[^\d]{0,20}(\d[\d.,]*\s*(?:juta|jt|million|mio|miliar|billion|ribu|rb|k)?)/);
  const v = amt ? money(amt[1]) : null;
  if (v) out.push({ leaf: { field: "amount", op: ">", value: v }, wf: { field: "amount", operator: ">", value: v }, text: `amount > ${v.toLocaleString("en-US")}` });
  if (/screen.?shar|anydesk|teamviewer|remote app/.test(s)) out.push({ leaf: { field: "screenSharingAppDetected", op: "isNotNull" }, wf: { field: "screen_sharing", operator: "==", value: true }, text: "screen-sharing app" });
  if (/vpn/.test(s)) out.push({ leaf: { field: "isVpnDetected", op: "==", value: true }, wf: { field: "vpn", operator: "==", value: true }, text: "VPN" });
  if (/root|jailbreak/.test(s)) out.push({ leaf: { field: "deviceRooted", op: "==", value: true }, wf: { field: "rooted", operator: "==", value: true }, text: "rooted device" });
  if (/(new|baru).{0,12}(beneficiar|account|rekening|penerima)|(beneficiar|rekening|penerima).{0,8}(new|baru)/.test(s)) out.push({ leaf: { field: "isNewBeneficiary", op: "==", value: true }, wf: { field: "new_beneficiary", operator: "==", value: true }, text: "new beneficiary" });
  if (/(new|baru).{0,8}(device|perangkat|hp)/.test(s)) out.push({ leaf: null, wf: { field: "new_device", operator: "==", value: true }, text: "new device" });
  if (/(luar negeri|abroad|foreign|outside indonesia|overseas|geo)/.test(s)) out.push({ leaf: { field: "ipCountry", op: "!=", value: "ID" }, wf: { field: "geo_anomaly", operator: "==", value: true }, text: "abroad / geo anomaly" });
  if (/mule|shared device|device bersama/.test(s)) out.push({ leaf: { field: "sharedDeviceWith", op: ">", value: 0 }, wf: { field: "shared_device_with", operator: ">", value: 0 }, text: "mule-linked beneficiary" });
  if (/(paste|tempel)/.test(s)) out.push({ leaf: { field: "copyPasteEventsOnBeneficiaryField", op: ">", value: 2 }, wf: { field: "copy_paste", operator: ">", value: 2 }, text: "pasted account number" });
  const hr = s.match(/(?:jam|between|antara|from)?\s*(\d{1,2})\s*(?:-|to|sampai|s\/d|–)\s*(\d{1,2})\s*(?:am|pagi|wib)?/);
  if (hr && (/(jam|am|pagi|night|malam|hour)/.test(s)) && Number(hr[1]) < 24 && Number(hr[2]) <= 24) {
    out.push({ leaf: { field: "hourOfDay", op: ">=", value: Number(hr[1]) }, wf: { field: "hour_of_day", operator: ">=", value: Number(hr[1]) }, text: `from ${hr[1]}:00` });
    out.push({ leaf: { field: "hourOfDay", op: "<", value: Number(hr[2]) }, wf: { field: "hour_of_day", operator: "<", value: Number(hr[2]) }, text: `before ${hr[2]}:00` });
  } else if (/night|malam|dini hari/.test(s)) out.push({ leaf: { field: "hourOfDay", op: "<", value: 5 }, wf: { field: "hour_of_day", operator: "<", value: 5 }, text: "night (before 05:00)" });
  const vel = s.match(/(\d+)\s*(?:x|times|kali|transaksi|transactions|tx)\s*(?:per|in an?|dalam|\/)\s*(?:hour|jam)/);
  if (vel) out.push({ leaf: null, wf: { field: "velocity", operator: ">", value: Number(vel[1]) }, text: `velocity > ${vel[1]}/h` });
  return out;
}
const ruleAction = (s: string): Rule["action"] => (/block|blokir|tolak|decline|reject/.test(s) ? "DECLINE" : /verif|challenge|otp|konfirmasi|flag/.test(s) ? "CHALLENGE" : /allow|loloskan/.test(s) ? "ALLOW" : "HOLD");
function wfActions(s: string) {
  const a: { action: keyof typeof ACTIONS; target: keyof typeof TARGETS }[] = [];
  if (/block|blokir|tolak|decline/.test(s)) a.push({ action: "block_transaction", target: "core_banking" });
  if (/flag|review|tahan|hold|tinjau/.test(s)) a.push({ action: "flag_for_review", target: "fraud_team" });
  if (/notif|sms|customer|nasabah|user/.test(s)) a.push({ action: "notify_user", target: "customer" });
  if (/alert|soc|security|peringatan/.test(s)) a.push({ action: "send_alert", target: "soc" });
  return a.length ? a : [{ action: "flag_for_review" as const, target: "fraud_team" as const }];
}
const title = (xs: string[]) => xs.slice(0, 3).map((x) => x[0].toUpperCase() + x.slice(1)).join(" + ");

function offline(kind: Kind, messages: Msg[], current: unknown, rules: Rule[]): BuildResult {
  const last = messages.at(-1)?.content ?? "", s = lc(last), sig = signals(last), any = /\b(or|atau|salah satu)\b/.test(s);
  const note = "offline builder (Gemini not configured)";
  if (!sig.length && !/rule-\d{4}|\bai\b|gemini|score|skor/.test(s))
    return { reply: "I could not find conditions in that. Try e.g. “block transfers over 10 juta to a new beneficiary while a screen-sharing app is active”.", proposal: null, source: "offline", note };
  if (kind === "rule") {
    const cur = current as Partial<RuleBody> | null, add = /\b(add|also|tambah|juga|plus)\b/.test(s) && cur?.condition;
    const usable = sig.filter((x) => x.leaf), skipped = sig.filter((x) => !x.leaf).map((x) => x.text);
    const leaves = [...(add ? (cur!.condition!.all ?? cur!.condition!.any ?? []) : []), ...usable.map((x) => x.leaf!)];
    const action = /block|blokir|tolak|decline|review|tahan|verif|challenge|flag|allow/.test(s) || !cur?.action ? ruleAction(s) : cur.action;
    const v = validateRule({ name: add && cur?.name ? cur.name : title(usable.map((x) => x.text)) || "Generated rule", description: `${{ DECLINE: "Block", HOLD: "Hold for review", CHALLENGE: "Ask the customer to verify", ALLOW: "Allow" }[action]} when ${usable.map((x) => x.text).join(any ? " or " : " and ")}.`,
      severity: action === "DECLINE" ? "HIGH" : action === "ALLOW" ? "LOW" : "MEDIUM", action, condition: any ? { any: leaves } : { all: leaves } });
    if ("error" in v) return { reply: `I could not build a valid rule: ${v.error}`, proposal: null, source: "offline", note };
    return { reply: `${add ? "Added to the rule" : "Built a rule"}: ${v.rule.expression} → ${v.rule.action}. Review it and save.${skipped.length ? ` Rules cannot check ${skipped.join(", ")}; use a workflow for that.` : ""}`, proposal: v.rule, source: "offline", note };
  }
  // workflow: trigger → condition/criteria → [rule] → [AI → criteria] → action / parallel action
  const nodes: WfNode[] = [], edges: { source: string; target: string }[] = [];
  let y = 0, prev = "1";
  const push = (n: Omit<WfNode, "position" | "id">) => { const id = String(nodes.length + 1); nodes.push({ ...n, id, position: { x: 0, y } } as WfNode); if (nodes.length > 1) edges.push({ source: prev, target: id }); prev = id; y += 130; return id; };
  push({ type: "trigger", data: { event: /login/.test(s) ? "login_attempt" : /account update|ubah akun|profil/.test(s) ? "account_update" : "transaction_created", source: /internet banking/.test(s) ? "internet_banking" : /mobile|aplikasi/.test(s) ? "mobile_app" : "any" } } as never);
  if (sig.length) push({ type: "criteria", data: { mode: any ? "OR" : "AND", criteria: sig.map((x) => x.wf) } } as never);
  const ruleId = s.match(/rule-\d{4}/)?.[0]?.toUpperCase();
  if (ruleId && rules.some((r) => r.id === ruleId)) push({ type: "rule", data: { ruleId, output: "rule_hit" } } as never);
  if (/\bai\b|gemini|copilot/.test(s)) { push({ type: "ai", data: { prompt: "How risky is this transfer of {{amount}} IDR?", output: "ai_risk" } } as never); push({ type: "criteria", data: { mode: "AND", criteria: [{ field: "ai_risk", operator: ">=", value: 60 }] } } as never); }
  const acts = wfActions(s);
  push(acts.length > 1 ? { type: "parallel_action", data: { actions: acts } } as never : { type: "action", data: { ...acts[0], params: {} } } as never);
  const v = validateWorkflow({ name: title(sig.map((x) => x.text)) || "Generated workflow", description: `Generated from: “${last.slice(0, 200)}”`, nodes, edges });
  if ("error" in v) return { reply: `I could not build a valid workflow: ${v.error}`, proposal: null, source: "offline", note };
  return { reply: `Built a ${nodes.length}-node workflow: ${nodes.map((n) => KINDS[n.type].title).join(" → ")}. It replaces the canvas; review it and save. (The offline builder always builds a fresh workflow; Gemini can edit the existing one.)`, proposal: v.workflow, source: "offline", note };
}

export async function chatBuild(kind: Kind, messages: Msg[], current: unknown, rules: Rule[], fallbackOnly = false): Promise<BuildResult> {
  if (!fallbackOnly && geminiConfigured()) {
    try { return await viaGemini(kind, messages, current, rules); }
    catch (e) { const r = offline(kind, messages, current, rules); return { ...r, note: `offline builder (Gemini failed: ${(e as Error).message.slice(0, 80)})` }; }
  }
  return offline(kind, messages, current, rules);
}
