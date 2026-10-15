import { EventEmitter } from "node:events";
import type { Alert, Level } from "./types";
import type { State } from "./store";

const g = globalThis as unknown as { __fortifyBus?: EventEmitter };
const bus = (g.__fortifyBus ??= new EventEmitter().setMaxListeners(0));

// Queue-row view: Alert joined with what the table needs. Alert schema itself is unchanged (M7).
export function toRow(s: State, a: Alert) {
  const tx = s.transactions.find((t) => t.id === a.transactionId)!;
  const c = s.customers.find((x) => x.id === a.customerId)!;
  return {
    ...a, customerName: c.name, maskedAccount: c.maskedAccount, amount: tx.amount,
    beneficiary: { masked: `•••${tx.beneficiary.accountId.slice(-4)}`, isNew: tx.beneficiary.isNew },
  };
}
export type AlertRow = ReturnType<typeof toRow>;

// M4 calls publish("alert.updated", ...) after a decision.
export const publish = (type: "alert.created" | "alert.updated", s: State, a: Alert) => bus.emit("alert", { type, row: toRow(s, a) });
export const subscribe = (fn: (e: { type: string; row: AlertRow }) => void) => { bus.on("alert", fn); return () => bus.off("alert", fn); };

const RISK: Level[] = ["LOW", "MEDIUM", "HIGH"];
const STATUS = ["New", "Investigating", "Decided"];

export function listAlerts(s: State, status?: string | null, risk?: string | null) {
  const r = risk?.toUpperCase();
  if ((status && !STATUS.includes(status)) || (r && !RISK.includes(r as Level))) return null;
  return s.alerts
    .filter((a) => (!status || a.status === status) && (!r || a.baselineLevel === r))
    .map((a) => toRow(s, a))
    .sort((x, y) => Number(y.status === "New") - Number(x.status === "New") || y.amount - x.amount);
}
