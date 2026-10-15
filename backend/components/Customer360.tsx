"use client";
import { useEffect, useState } from "react";
import type { Customer, Transaction } from "@/lib/types";
import { idr } from "@/lib/format";
import { Skel } from "./Skeleton";

export default function Customer360({ customerId }: { customerId: string }) {
  const [c, setC] = useState<Customer | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  useEffect(() => {
    fetch(`/api/customers/${customerId}`).then((r) => r.json()).then(setC);
    fetch(`/api/customers/${customerId}/transactions?limit=10`).then((r) => r.json()).then(setTxs);
  }, [customerId]);
  if (!c) return <div className="card" style={{ display: "grid", gap: 10 }}><Skel w="50%" h={18} /><Skel w="80%" /><Skel /><Skel /><Skel w="60%" /></div>;
  const since = new Date(c.customerSince).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <div className="card">
      <b>{c.name}</b> <span className="mute">{c.age} y/o · {c.segment} · since {since}</span>
      {c.accountStatus === "FROZEN" && <div className="chip HIGH">Account FROZEN</div>}
      <div>Risk profile <span className={`chip ${c.riskProfile}`}>{c.riskProfile[0] + c.riskProfile.slice(1).toLowerCase()}</span></div>
      <dl className="kv">
        <dt>Usual device</dt><dd>{c.usualDevice}</dd>
        <dt>Usual location</dt><dd>{c.city}</dd>
        <dt>Avg daily spend</dt><dd>{idr(c.avgDailySpend)}</dd>
        <dt>Active hours</dt><dd>{c.usualActiveHours.from}–{c.usualActiveHours.to}</dd>
        <dt>Known beneficiaries</dt><dd>{c.knownBeneficiaries.length}</dd>
      </dl>
      <div className="mute">Last 10 transactions</div>
      <table>
        <tbody>
          {txs.map((t) => (
            <tr key={t.id}><td>{new Date(t.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td><td>{idr(t.amount)}</td><td className="mute">•••{t.beneficiary.accountId.slice(-4)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
