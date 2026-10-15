// Regenerates the large seed files (customers, transactions, alerts, sessions, meta).
// Deterministic (seeded PRNG). Run: nvm use 22 && npm run seed
import { readFileSync, writeFileSync } from "node:fs";
import { scoreBaseline } from "../lib/scoring.ts";

const OUT = new URL("../data/seed/", import.meta.url).pathname;
const ANCHOR = "2026-10-14T12:00:00.000Z";
const T0 = new Date(ANCHOR).getTime();
const H = 3600e3, D = 24 * H;

let a = 20261014;
const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const round = (n, step) => Math.round(n / step) * step;
const pad = (n, w) => String(n).padStart(w, "0");

const FIRST = ["Andi", "Sinta", "Rudi", "Dewi", "Agus", "Maya", "Fajar", "Lestari", "Hendra", "Putri", "Dimas", "Rina", "Yoga", "Wulan", "Bayu", "Citra", "Eko", "Nadia", "Galih", "Intan"];
const LAST = ["Wijaya", "Hartono", "Nugroho", "Saputra", "Lubis", "Siregar", "Kusuma", "Pangestu", "Halim", "Rahayu", "Setiawan", "Maharani"];
const CITIES = ["Jakarta", "Bandung", "Surabaya", "Medan", "Yogyakarta", "Semarang", "Makassar", "Denpasar"];
const DEVICES = ["Samsung Galaxy A54", "iPhone 13", "Xiaomi Redmi Note 12", "OPPO A78", "Vivo Y27", "Samsung Galaxy S23", "Realme C55"];
const SEGMENTS = ["Student", "Salaried", "Salaried", "Entrepreneur", "Homemaker"];
const BANKS = ["Bank Nusantara Digital", "Bank Samudra", "Bank Cendana", "Bank Arunika"];

const customers = [{
  id: "CUST-0001", name: "Budi Santoso", age: 21, segment: "Student", city: "Jakarta", homeCountry: "ID",
  customerSince: "2023-08-15", riskProfile: "LOW", accountId: "ACC-0001", maskedAccount: "•••2231", accountStatus: "ACTIVE",
  avgDailySpend: 500000, usualDevice: "Samsung Galaxy A54", usualActiveHours: { from: "08:00", to: "22:00" },
  knownBeneficiaries: ["ACC-KB-0001-1", "ACC-KB-0001-2", "ACC-KB-0001-3", "ACC-KB-0001-4"],
  sessionBaseline: { hesitationTimeMs: 800, typingCadenceDeviation: 0.15, sessionDurationSec: 180, navigationPattern: "browse-then-transfer" },
}];
for (let i = 2; i <= 41; i++) {
  const id = `CUST-${pad(i, 4)}`;
  customers.push({
    id, name: `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`, age: int(19, 58), segment: pick(SEGMENTS),
    city: pick(CITIES), homeCountry: "ID", customerSince: `${int(2015, 2025)}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`,
    riskProfile: "LOW", accountId: `ACC-${pad(i, 4)}`, maskedAccount: `•••${pad(int(0, 9999), 4)}`, accountStatus: "ACTIVE",
    avgDailySpend: round(int(300000, 3000000), 50000), usualDevice: pick(DEVICES), usualActiveHours: { from: "07:00", to: "23:00" },
    knownBeneficiaries: [1, 2, 3, 4, 5].slice(0, int(3, 5)).map((k) => `ACC-KB-${pad(i, 4)}-${k}`),
    sessionBaseline: { hesitationTimeMs: int(600, 1000), typingCadenceDeviation: 0.15, sessionDurationSec: int(120, 240), navigationPattern: "browse-then-transfer" },
  });
}

// ~30 days of normal history: 1-2 transfers/day to known beneficiaries, well below 10x average.
const transactions = [];
let tn = 1;
for (const c of customers) {
  for (let d = 30; d >= 1; d--) {
    for (let k = int(1, 2); k > 0; k--) {
      const ben = pick(c.knownBeneficiaries);
      transactions.push({
        id: `TX-${pad(tn++, 5)}`, customerId: c.id, accountId: c.accountId, sessionId: null,
        amount: round(c.avgDailySpend * (0.2 + rnd() * 1.3), 10000), currency: "IDR",
        createdAt: new Date(T0 - d * D + int(8, 21) * H + int(0, 59) * 60e3).toISOString(), channel: "MOBILE_APP",
        beneficiary: { accountId: ben, bankName: pick(BANKS), name: `Beneficiary ${ben.slice(-6)}`, isNew: false, accountAgeDays: int(200, 2000) },
        status: "COMPLETED",
      });
    }
  }
}

// Alert noise: scores come from the real engine, so they always agree with 07 §4.
const sessions = [{
  id: "SES-9001", customerId: "CUST-0001", startedAt: ANCHOR, deviceModel: "Samsung Galaxy A54", deviceRooted: false, isVpnDetected: true,
  ipCountry: "RU", screenSharingAppDetected: "AnyDesk", isNewDevice: false, copyPasteEventsOnBeneficiaryField: 7, hesitationTimeMs: 4500,
  typingCadenceDeviation: 0.82, sessionDurationSec: 1260, navigationPattern: "direct-to-transfer", pinCorrect: true, failedPinAttempts: 0,
}];
const alerts = [];
const VARIANTS = [ // [spike, young, newDevice, failedPin, weight]
  [true, true, false, false, 3], [true, false, true, false, 2], [true, true, true, true, 1], [false, true, false, false, 2], [false, false, false, false, 1],
];
const bag = VARIANTS.flatMap((v) => Array(v[4]).fill(v));
const others = customers.slice(1);
const mkSession = (id, c, newDevice, failed) => ({
  id, customerId: c.id, startedAt: ANCHOR, deviceModel: newDevice ? pick(DEVICES) : c.usualDevice, deviceRooted: false, isVpnDetected: false,
  ipCountry: "ID", screenSharingAppDetected: null, isNewDevice: newDevice, copyPasteEventsOnBeneficiaryField: int(0, 1),
  hesitationTimeMs: int(500, 1200), typingCadenceDeviation: round(0.05 + rnd() * 0.2, 0.01), sessionDurationSec: int(100, 260),
  navigationPattern: "browse-then-transfer", pinCorrect: !failed, failedPinAttempts: failed ? 2 : 0,
});
const NOISE = 140;
let takeovers = 0;
for (let i = 1; i <= NOISE + 1; i++) {
  const control = i === NOISE + 1;
  const c = others[(i * 3) % others.length];
  let v = control ? [false, false, false, false] : pick(bag);
  if (v === VARIANTS[2] && ++takeovers > 3) v = VARIANTS[0]; // only the first 3 takeover-style alerts stay (these are the HIGH ones); same draws, so the rest of the seed is unchanged
  const [spike, young, newDev, failed] = v;
  const at = new Date(T0 - (control ? 60e3 : (NOISE + 1 - i) * 15 * 60e3 - 3 * 60e3)).toISOString();
  const txId = `TX-A${pad(i, 4)}`, sesId = `SES-A${pad(i, 4)}`;
  const ses = { ...mkSession(sesId, c, newDev, failed), startedAt: at };
  const tx = {
    id: txId, customerId: c.id, accountId: c.accountId, sessionId: sesId,
    // capped below Budi's Rp 50 jt so the default queue sort (New, amount desc) keeps his alert on top
    amount: control ? 150000 : Math.min(45000000, spike ? round(c.avgDailySpend * int(11, 30), 100000) : round(c.avgDailySpend * (0.5 + rnd() * 5), 50000)), currency: "IDR",
    createdAt: at, channel: "MOBILE_APP",
    beneficiary: control
      ? { accountId: c.knownBeneficiaries[0], bankName: pick(BANKS), name: "Regular beneficiary", isNew: false, accountAgeDays: 900 }
      : { accountId: `ACC-NB-${pad(i, 4)}`, bankName: pick(BANKS), name: `New Beneficiary ${pad(i, 3)}`, isNew: true, accountAgeDays: young ? int(1, 25) : int(60, 900) },
    status: "HELD",
  };
  const r = scoreBaseline(tx, c, ses);
  sessions.push(ses); transactions.push(tx);
  alerts.push({
    id: `ALT-${pad(i, 4)}`, transactionId: txId, customerId: c.id, createdAt: at, baselineScore: r.score, baselineLevel: r.level,
    status: !control && i % 10 === 0 ? "Investigating" : "New", assignedTo: "analyst-sari",
  });
}
// A full day of normal traffic (6000 transfers); the store spreads them over today's hours. Generated last so the draws above stay unchanged.
for (let i = 1; i <= 6000; i++) {
  const c = pick(customers), ben = pick(c.knownBeneficiaries);
  transactions.push({
    id: `TX-T${pad(i, 4)}`, customerId: c.id, accountId: c.accountId, sessionId: null,
    amount: round(c.avgDailySpend * (0.05 + rnd() * 0.6), 10000), currency: "IDR", createdAt: ANCHOR, channel: "MOBILE_APP",
    beneficiary: { accountId: ben, bankName: pick(BANKS), name: `Beneficiary ${ben.slice(-6)}`, isNew: false, accountAgeDays: int(200, 2000) },
    status: "COMPLETED",
  });
}
// A few beneficiary networks so the graph isn't only Budi's: 4 mule-like (young account, shared devices, flagged) + 4 mild (a few senders, nothing flagged).
// Generated after everything else so earlier draws stay unchanged; Budi's hand-written entry in network.json is kept.
const network = JSON.parse(readFileSync(OUT + "network.json", "utf8"));
for (const k of Object.keys(network)) if (k.startsWith("ACC-NB-")) delete network[k];
const cust = (id) => customers.find((c) => c.id === id);
const noiseTx = transactions.filter((t) => t.id.startsWith("TX-A") && t.beneficiary.isNew);
const pickTx = (young, n) => noiseTx.filter((t) => (t.beneficiary.accountAgeDays <= 25) === young).filter((_, i) => i % 3 === 0).slice(0, n);
for (const [mule, t] of [...pickTx(true, 4).map((t) => [true, t]), ...pickTx(false, 4).map((t) => [false, t])]) {
  const id = t.beneficiary.accountId, c = cust(t.customerId), tag = id.slice(-4);
  const nodes = [{ id, label: "Beneficiary Account", type: "beneficiary", flagged: false }];
  const edges = [];
  const shared = mule ? int(2, 3) : 0, senders = mule ? int(3, 5) : int(1, 3);
  for (let k = 1; k <= shared; k++) { const n = `ACC-M-${tag}-D${k}`; nodes.push({ id: n, label: `•••${pad(int(0, 9999), 4)}`, type: "account", flagged: true }); edges.push({ source: id, target: n, type: "SHARED_DEVICE" }); }
  for (let k = 1; k <= senders; k++) { const n = `ACC-M-${tag}-S${k}`; nodes.push({ id: n, label: `•••${pad(int(0, 9999), 4)}`, type: "account", flagged: false }); edges.push({ source: n, target: id, type: "TRANSFER", amount: round(int(2000000, 9000000), 100000) }); }
  nodes.push({ id: c.accountId, label: `${c.name} (${c.maskedAccount})`, type: "customer", flagged: false });
  edges.push({ source: c.accountId, target: id, type: "TRANSFER", amount: t.amount });
  network[id] = { centerAccountId: id, linkedAccountsCount: shared + senders, sharedDeviceWith: shared, nodes, edges };
}
writeFileSync(OUT + "network.json", JSON.stringify(network, null, 2) + "\n");
// Attack origins: ~30% of noise sessions come from abroad (some via VPN). Drawn last so earlier data is unchanged; baseline scoring ignores IP country.
const ORIGINS = [["SG", 6], ["MY", 5], ["RU", 5], ["CN", 4], ["NG", 4], ["US", 3], ["VN", 2], ["BR", 1]].flatMap(([c, n]) => Array(n).fill(c));
for (const ses of sessions) {
  if (!ses.id.startsWith("SES-A") || ses.id === `SES-A${pad(NOISE + 1, 4)}`) continue;
  if (rnd() < 0.3) { ses.ipCountry = pick(ORIGINS); ses.isVpnDetected = rnd() < 0.4; }
}
alerts.reverse(); // newest first

const w = (f, v) => writeFileSync(OUT + f, JSON.stringify(v, null, 2) + "\n");
w("meta.json", { anchor: ANCHOR }); w("customers.json", customers); w("transactions.json", transactions); w("alerts.json", alerts); w("sessions.json", sessions);
const lv = (l) => alerts.filter((x) => x.baselineLevel === l).length;
console.log(`customers=${customers.length} transactions=${transactions.length} alerts=${alerts.length} (LOW ${lv("LOW")}, MEDIUM ${lv("MEDIUM")}, HIGH ${lv("HIGH")})`);
