// Small half-circle risk dial ("High · Risk level"), used on profile, device and session headers.
const ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export default function RiskDial({ level, label = "Risk level", score }: { level: string | null; label?: string; score?: number }) {
  const i = level ? ORDER.indexOf(level) : -1, v = score !== undefined ? Math.max(0, Math.min(1, score / 100)) : (i + 1) / 4;
  const r = 34, c = Math.PI * r;
  return (
    <div className={`rdial ${level ?? ""}`} role="img" aria-label={`${label}: ${level ?? "unknown"}`}>
      <svg viewBox="0 0 80 46" width="96"><path d="M6 40 A34 34 0 0 1 74 40" className="track" /><path d="M6 40 A34 34 0 0 1 74 40" className="val" strokeDasharray={`${c * v} ${c}`} /></svg>
      <b>{level ? level[0] + level.slice(1).toLowerCase() : "—"}</b><small>{label}{score !== undefined ? ` · ${score}` : ""}</small>
    </div>
  );
}
