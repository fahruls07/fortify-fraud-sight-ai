"use client";
// SLA countdown chip: green with time left, orange in the last 25 %, red when breached.
export default function Sla({ due, done, start }: { due?: string; done?: boolean; start?: string }) {
  if (!due || done) return null;
  const left = Date.parse(due) - Date.now(), total = start ? Date.parse(due) - Date.parse(start) : 0;
  const h = Math.floor(Math.abs(left) / 3600e3), m = Math.floor((Math.abs(left) % 3600e3) / 60e3);
  const t = h >= 48 ? `${Math.round(h / 24)} d` : h ? `${h} h ${m} m` : `${m} m`;
  return <span className={`sla ${left < 0 ? "breach" : total && left < total / 4 ? "soon" : "ok"}`} title={`SLA due ${new Date(due).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" })} WIB`}>{left < 0 ? `SLA breached ${t} ago` : `SLA ${t} left`}</span>;
}
