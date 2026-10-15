import { AI_ACTIONS, RISK_LEVELS, TYPOLOGIES, type InvestigationReport } from "../types.ts";

const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    out.add(k);
    if (k === "field" && typeof x === "string") out.add(x); // session signals are rows {field, value, baseline}
    keysOf(x, out);
  }
  return out;
};
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

// 03 §7 server-side validation. Returns an error message (fed back to Gemini on retry) or the typed report.
export function validateReport(raw: unknown, ctx: { codes: Set<string>; toolOutputs: unknown; docIds: Set<string> }): { error: string } | { report: InvestigationReport } {
  const r = raw as Partial<InvestigationReport> | null;
  if (!r || typeof r !== "object") return { error: "output is not an object" };
  if (!oneOf(RISK_LEVELS, r.riskLevel)) return { error: "riskLevel invalid" };
  if (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1) return { error: "confidence must be 0..1" };
  if (!oneOf(TYPOLOGIES, r.typology)) return { error: "typology invalid" };
  if (!str(r.headline) || r.headline.length > 140) return { error: "headline missing or longer than 140 chars" };
  if (!str(r.summary) || !str(r.baselineComparison)) return { error: "summary/baselineComparison missing" };
  if (!oneOf(AI_ACTIONS, r.recommendedAction)) return { error: "recommendedAction invalid" };
  if (!Array.isArray(r.nextSteps) || !r.nextSteps.every(str)) return { error: "nextSteps must be string[]" };
  if (!Array.isArray(r.reasonCodes)) return { error: "reasonCodes must be an array" };
  const keys = keysOf(ctx.toolOutputs);
  for (const rc of r.reasonCodes) {
    if (!rc || !ctx.codes.has(rc.code)) return { error: `reason code ${rc?.code} is not in the catalog` };
    if (!oneOf(RISK_LEVELS, rc.severity) || !str(rc.explanation)) return { error: `reason code ${rc.code}: severity/explanation invalid` };
    if (!str(rc.evidence) || ![...keys].some((k) => rc.evidence.includes(k))) return { error: `reason code ${rc.code}: evidence must reference a field from the tool results` };
  }
  if (!Array.isArray(r.citations) || !r.citations.length || !r.citations.every((c) => c && ctx.docIds.has(c.docId) && str(c.title))) return { error: "citations must be >= 1 and use known docIds" };
  return { report: r as InvestigationReport };
}
