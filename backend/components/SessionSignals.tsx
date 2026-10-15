"use client";
import { useEffect, useState } from "react";
import type { signalsView } from "@/lib/signals";
import { Skel } from "./Skeleton";

type View = ReturnType<typeof signalsView>;
const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

export default function SessionSignals({ sessionId }: { sessionId: string }) {
  const [v, setV] = useState<View | null>(null);
  useEffect(() => { fetch(`/api/sessions/${sessionId}/signals`).then((r) => r.json()).then(setV); }, [sessionId]);
  if (!v) return <div className="card" style={{ display: "grid", gap: 10 }}><Skel w="40%" h={18} /><Skel /><Skel /><Skel w="70%" /></div>;
  return (
    <div className="card">
      <b>Session signals</b> <span className="mute">{v.sessionId} · from the device &amp; behaviour layer (production: the bank&apos;s risk SDK)</span>
      {v.groups.map((g) => (
        <div key={g.name}>
          <div className="mute" style={{ marginTop: 8 }}>{g.name}</div>
          <table>
            <thead><tr><th /><th>Field</th><th>Value</th><th>Baseline</th></tr></thead>
            <tbody>
              {g.signals.map((s) => (
                <tr key={s.field}>
                  <td><span className={`dot ${s.anomalous ? "bad" : "ok"}`} title={s.anomalous ? "anomalous" : "normal"} aria-label={s.anomalous ? "anomalous" : "normal"} /></td>
                  <td>{s.field}</td><td className={s.anomalous ? "HIGH" : ""}><code>{show(s.value)}</code></td><td className="mute">{show(s.baseline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
