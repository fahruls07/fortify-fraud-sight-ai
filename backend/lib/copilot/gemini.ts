import { GoogleGenAI, Type } from "@google/genai";
import { config } from "../settings.ts";

const str = { type: Type.STRING };
const enumOf = (v: readonly string[]) => ({ type: Type.STRING, enum: [...v] });
const LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// 03 §7 responseSchema. Keep in step with InvestigationReport in lib/types.ts.
export const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["riskLevel", "confidence", "typology", "headline", "summary", "reasonCodes", "baselineComparison", "recommendedAction", "nextSteps", "citations"],
  propertyOrdering: ["riskLevel", "confidence", "typology", "headline", "summary", "reasonCodes", "baselineComparison", "recommendedAction", "nextSteps", "citations"],
  properties: {
    riskLevel: enumOf(LEVELS), confidence: { type: Type.NUMBER },
    typology: enumOf(["SOCIAL_ENGINEERING_SCREEN_SHARING", "MULE_ACCOUNT", "ACCOUNT_TAKEOVER", "PHISHING_CREDENTIAL_THEFT", "AUTHORISED_PUSH_PAYMENT", "NONE"]),
    headline: str, summary: str,
    reasonCodes: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ["code", "severity", "evidence", "explanation"], properties: { code: str, severity: enumOf(LEVELS), evidence: str, explanation: str } } },
    baselineComparison: str,
    recommendedAction: enumOf(["ALLOW", "CHALLENGE", "HOLD", "DECLINE", "DECLINE_AND_FREEZE"]),
    nextSteps: { type: Type.ARRAY, items: str },
    citations: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ["docId", "title"], properties: { docId: str, title: str } } },
  },
};

export const SYSTEM_INSTRUCTION = `You are a senior fraud investigator at an Indonesian bank.
Rules:
- Use ONLY facts from the provided tool results. Do not invent values.
- Compare the session with the customer's baseline explicitly (device, location, amount, hour, behaviour).
- Map the case to the relevant playbooks and cite their docId in citations (at least one; include the Bank Fraud Policy when relevant).
- The recommended action must be consistent with the Bank Fraud Policy.
- Every reasonCodes[].code must come from the provided catalog; reasonCodes[].evidence must name the field and its value from the tool results, e.g. "screenSharingAppDetected = AnyDesk".
- baselineComparison explains why the baseline engine scored it that way and what it missed.
- If the transaction looks normal, use riskLevel LOW, recommendedAction ALLOW, typology NONE, and do not make things up.
- All text (headline ≤ 140 characters, summary 3–5 sentences, explanations, nextSteps) must be in English; codes and enums in English.
- You only recommend; the final decision rests with the analyst.`;

// Connection comes from Settings → AI (falls back to env: GEMINI_API_KEY, or GOOGLE_CLOUD_PROJECT for Vertex AI).
function conn() {
  const a = config().ai, env = process.env;
  const apiKey = a.mode === "api_key" ? a.apiKey || env.GEMINI_API_KEY || "" : "";
  const project = a.mode === "vertex" ? a.project || env.GOOGLE_CLOUD_PROJECT || "" : !apiKey ? env.GOOGLE_CLOUD_PROJECT || "" : "";
  return { apiKey, project, location: a.location || env.GOOGLE_CLOUD_LOCATION || "global", baseUrl: a.baseUrl, model: a.model || env.GEMINI_MODEL || "gemini-2.5-flash" };
}
export const geminiConfigured = () => { const c = conn(); return !!(c.apiKey || c.project); };
export const geminiInfo = () => { const c = conn(); return { configured: !!(c.apiKey || c.project), via: c.apiKey ? "api_key" : c.project ? "vertex" : "none", model: c.model, baseUrl: c.baseUrl || null }; };

let client: { key: string; ai: GoogleGenAI } | undefined; // rebuilt when the Settings connection changes

export async function generate(prompt: string, signal: AbortSignal, opts: { systemInstruction?: string; responseSchema?: object; text?: boolean } = {}) {
  const c = conn(), key = JSON.stringify(c);
  if (client?.key !== key) {
    const httpOptions = c.baseUrl ? { baseUrl: c.baseUrl } : undefined;
    client = { key, ai: c.apiKey ? new GoogleGenAI({ apiKey: c.apiKey, httpOptions }) : new GoogleGenAI({ vertexai: true, project: c.project, location: c.location, httpOptions }) };
  }
  const res = await client.ai.models.generateContent({
    model: c.model,
    contents: prompt,
    config: { systemInstruction: opts.systemInstruction ?? SYSTEM_INSTRUCTION, temperature: 0.2, ...(opts.text ? {} : { responseMimeType: "application/json", responseSchema: opts.responseSchema ?? RESPONSE_SCHEMA }), abortSignal: signal },
  });
  return { text: res.text ?? "", tokens: res.usageMetadata?.totalTokenCount ?? null };
}
