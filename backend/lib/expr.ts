// Safe arithmetic for Calculation nodes: numbers, variables, + - * / %, parentheses and a few functions. No eval, no strings.
const FN: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, log10: Math.log10,
};
type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function lex(src: string): Tok[] {
  if (src.length > 300) throw new Error("Formula is too long (max 300 characters).");
  const out: Tok[] = [], re = /\s*(?:(\d+(?:\.\d+)?)|([a-z_][a-z0-9_]*)|([-+*/%(),]))/iy;
  let i = 0;
  while (i < src.length) {
    if (/^\s+$/.test(src.slice(i))) break;
    re.lastIndex = i; const m = re.exec(src);
    if (!m) throw new Error(`Unexpected "${src.slice(i).trim()[0]}" in formula.`);
    out.push(m[1] ? { t: "num", v: Number(m[1]) } : m[2] ? { t: "id", v: m[2] } : { t: "op", v: m[3] });
    i = re.lastIndex;
  }
  return out;
}

// Returns the variables a formula uses (for validation) and an evaluator.
export function compile(src: string) {
  const toks = lex(src), vars = new Set<string>();
  let p = 0, depth = 0;
  const peek = () => toks[p], eat = (v?: string) => { const t = toks[p]; if (!t || (v && t.v !== v)) throw new Error(`Expected "${v ?? "value"}" in formula.`); p++; return t; };
  type Node = (ctx: Record<string, unknown>) => number;
  const expr = (): Node => {
    let l = term();
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) { const o = eat().v, a = l, b = term(); l = o === "+" ? (c) => a(c) + b(c) : (c) => a(c) - b(c); }
    return l;
  };
  const term = (): Node => {
    let l = unary();
    while (peek()?.t === "op" && "*/%".includes(peek().v as string)) { const o = eat().v, a = l, b = unary(); l = o === "*" ? (c) => a(c) * b(c) : o === "/" ? (c) => a(c) / b(c) : (c) => a(c) % b(c); }
    return l;
  };
  const unary = (): Node => { if (peek()?.v === "-") { eat(); const a = unary(); return (c) => -a(c); } return primary(); };
  const primary = (): Node => {
    if (++depth > 40) throw new Error("Formula is nested too deeply.");
    const t = eat();
    try {
      if (t.t === "num") return () => t.v;
      if (t.t === "op" && t.v === "(") { const a = expr(); eat(")"); return a; }
      if (t.t === "id") {
        if (peek()?.v === "(") {
          const f = FN[t.v.toLowerCase()]; if (!f) throw new Error(`Unknown function ${t.v}(). Use ${Object.keys(FN).join(", ")}.`);
          eat("("); const args: Node[] = [];
          if (peek()?.v !== ")") { args.push(expr()); while (peek()?.v === ",") { eat(","); args.push(expr()); } }
          eat(")"); return (c) => f(...args.map((a) => a(c)));
        }
        vars.add(t.v);
        return (c) => { const v = Object.hasOwn(c, t.v) ? c[t.v] : undefined; if (typeof v === "boolean") return v ? 1 : 0; if (typeof v !== "number") throw new Error(`Variable ${t.v} is not a number.`); return v; };
      }
      throw new Error(`Unexpected "${t.v}" in formula.`);
    } finally { depth--; }
  };
  if (!toks.length) throw new Error("Formula is empty.");
  const root = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" in formula.`);
  return { vars: [...vars], run: (ctx: Record<string, unknown>) => { const v = root(ctx); if (!Number.isFinite(v)) throw new Error("Formula result is not a finite number (division by zero?)."); return v; } };
}
