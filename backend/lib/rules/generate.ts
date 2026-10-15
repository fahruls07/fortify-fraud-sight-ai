import { Type } from "@google/genai";
import { generate, geminiConfigured } from "../copilot/gemini";
import type { State } from "../store";
import { FIELDS, OPS, RULE_ACTIONS, SEVERITIES, validateRule, type Leaf, type RuleBody } from "./dsl";

const TIMEOUT_MS = 3500; // 06 §7: demo prompts must produce a rule in < 4 s

const leaf = { type: Type.OBJECT, required: ["field", "op"], properties: {
  field: { type: Type.STRING, enum: Object.keys(FIELDS) }, op: { type: Type.STRING, enum: [...OPS] },
  value: { type: Type.STRING, description: "Number/true/false/text as a string; for op in, separate with commas; leave empty for isNotNull" },
} };
const SCHEMA = { type: Type.OBJECT, required: ["name", "description", "condition", "action", "severity"], properties: {
  name: { type: Type.STRING }, description: { type: Type.STRING },
  condition: { type: Type.OBJECT, properties: { all: { type: Type.ARRAY, items: leaf }, any: { type: Type.ARRAY, items: leaf } } },
  action: { type: Type.STRING, enum: [...RULE_ACTIONS] }, severity: { type: Type.STRING, enum: [...SEVERITIES] },
} };

const SYSTEM = `You translate fraud rule requests (in English or Indonesian) into a JSON rule in a restricted DSL. Do not write code.
Allowed fields: ${Object.entries(FIELDS).map(([f, t]) => `${f} (${t})`).join(", ")}.
Operators: ${OPS.join(" ")}. Combine conditions with condition.all (all must match) or condition.any (any one matches); use exactly one.
Actions: ${RULE_ACTIONS.join(", ")}. "block" (or "blokir") means DECLINE.
Amounts in full rupiah without separators ("10 million" / "10 juta" = 10000000). Hours use hourOfDay 0-23; "2-5 am" = hourOfDay >= 2 and hourOfDay < 5.
"screen sharing app active" = screenSharingAppDetected isNotNull. name is short and description is one sentence, both in English.`;

// Gemini returns every value as a string (the schema has no union type); coerce by the field's declared type before validating.
function coerce(raw: any): unknown {
  const fix = (l: any): Leaf => {
    if (!l || !(l.field in FIELDS) || l.value === undefined || l.value === "" || l.value === null) return l;
    const base = FIELDS[l.field as keyof typeof FIELDS].replace("?", "");
    const one = (v: string) => (base === "number" ? Number(v) : base === "boolean" ? (v === "true" ? true : v === "false" ? false : v) : v);
    return { ...l, value: l.op === "in" ? String(l.value).split(",").map((x) => one(x.trim())) : one(String(l.value)) };
  };
  const c = raw?.condition ?? {};
  return { ...raw, condition: { ...(c.all?.length ? { all: c.all.map(fix) } : {}), ...(c.any?.length ? { any: c.any.map(fix) } : {}) } };
}

const norm = (p: string) => p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// 06 §5 chips. Matched by normalised text or key phrase so small edits to a chip still hit the canned rule.
function canned(s: State, prompt: string): RuleBody | null {
  const p = norm(prompt);
  const key = p.includes("screen sharing") ? "rules-screen-sharing" : /jam 2\s*(-|sampai|s d)?\s*5|2 5 pagi|\b2\s*(-|to)?\s*5\s*am\b|2 00 5 00/.test(p) ? "rules-night-new-account" : null;
  return key ? (s.fallbacks[key] as RuleBody) : null;
}

export async function generateRule(s: State, prompt: string): Promise<{ rule: RuleBody; source: "gemini" | "fallback"; reason?: string }> {
  let reason = s.fallbackOnly ? "fallback_only_mode" : !geminiConfigured() ? "no_credentials (GOOGLE_CLOUD_PROJECT unset)" : "";
  if (!reason) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const out = await generate(prompt, ac.signal, { systemInstruction: SYSTEM, responseSchema: SCHEMA });
      const v = validateRule(coerce(JSON.parse(out.text)));
      if ("rule" in v) return { rule: v.rule, source: "gemini" };
      reason = `validation: ${v.error}`;
    } catch (e) { reason = ac.signal.aborted ? "timeout" : `gemini_error: ${(e as Error).message}`; }
    finally { clearTimeout(timer); }
  }
  console.log(JSON.stringify({ rules: "generate", fallback: true, reason, prompt }));
  const c = canned(s, prompt);
  if (!c) throw Object.assign(new Error(`Could not generate a rule (${reason}). Try an example prompt.`), { status: 502 });
  const v = validateRule(c);
  if (!("rule" in v)) throw Object.assign(new Error(`canned rule invalid: ${v.error}`), { status: 500 });
  return { rule: v.rule, source: "fallback", reason };
}
