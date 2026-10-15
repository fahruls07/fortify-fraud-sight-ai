import { makeZip, readZip } from "../zip.ts";
import { validateRule, type Rule, type RuleBody } from "./dsl.ts";

// Rule package = .zip with a package.json manifest listing rules/<id>.json files.
export const FORMAT = "fortify.rules/v1";

export function exportPack(rules: Rule[], by: string) {
  const files = rules.map((r) => ({ name: `rules/${r.id}.json`, data: Buffer.from(JSON.stringify({ id: r.id, name: r.name, description: r.description, severity: r.severity, condition: r.condition, action: r.action, status: r.status }, null, 2)) }));
  const pkg = { name: "fortify-rules", version: "1.0.0", format: FORMAT, description: "Fortify fraud rule package", exportedAt: new Date().toISOString(), exportedBy: by, count: rules.length, rules: files.map((f) => f.name) };
  return makeZip([{ name: "package.json", data: Buffer.from(JSON.stringify(pkg, null, 2)) }, ...files]);
}

export type PackItem = { file: string; rule?: RuleBody; error?: string };

// Reads the package; each listed file comes back with its validated rule or its error (for the import preview).
export function parsePack(buf: Buffer): { items: PackItem[] } | { errors: string[] } {
  let files: Map<string, Buffer>;
  try { files = readZip(buf); } catch (e) { return { errors: [(e as Error).message] }; }
  const raw = files.get("package.json");
  if (!raw) return { errors: ["package.json is missing from the ZIP."] };
  let pkg: { format?: unknown; rules?: unknown };
  try { pkg = JSON.parse(raw.toString("utf8")); } catch { return { errors: ["package.json is not valid JSON."] }; }
  if (pkg.format !== FORMAT) return { errors: [`package.json format must be "${FORMAT}".`] };
  if (!Array.isArray(pkg.rules) || !pkg.rules.length || pkg.rules.length > 200) return { errors: ["package.json must list 1–200 rule files in \"rules\"."] };
  return { items: pkg.rules.map((file): PackItem => {
    const data = typeof file === "string" ? files.get(file) : undefined;
    if (!data) return { file: String(file), error: "Listed in package.json but not found." };
    let json: unknown;
    try { json = JSON.parse(data.toString("utf8")); } catch { return { file, error: "Not valid JSON." }; }
    const v = validateRule(json);
    return "error" in v ? { file, error: v.error } : { file, rule: v.rule };
  }) };
}
