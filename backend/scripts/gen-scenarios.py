#!/usr/bin/env python3
"""Scenario seed: customers, sessions, mule network and AML entries for 10 fraud scenarios, plus 100 sample requests.

Writes data/seed/scenarios.json (loaded additively by lib/store.ts) and docs/scenario-requests.txt.
Deterministic: same output every run. All people, accounts and phone numbers are fictional.
Usage: python3 scripts/gen-scenarios.py
"""
import json, random
from pathlib import Path

random.seed(20261015)
ROOT = Path(__file__).resolve().parent.parent
FIRST = ["Andi", "Rina", "Dedi", "Sinta", "Agus", "Maya", "Hendra", "Lestari", "Rudi", "Ayu", "Fajar", "Indah", "Yusuf", "Nadia", "Bambang", "Wulan", "Eko", "Putri", "Arif", "Dewi"]
LAST = ["Saputra", "Wijaya", "Pratama", "Lestari", "Nugroho", "Hidayat", "Siregar", "Kusuma", "Halim", "Santoso", "Gunawan", "Purba", "Wibowo", "Harahap", "Setiadi"]
CITIES = ["Jakarta", "Surabaya", "Bandung", "Medan", "Semarang", "Makassar", "Denpasar", "Yogyakarta", "Palembang", "Balikpapan"]
SEGMENTS = ["Employee", "Entrepreneur", "Student", "Retiree", "Homemaker", "Civil servant", "Freelancer"]
DEVICES = ["Samsung Galaxy S23", "iPhone 14", "Xiaomi Redmi Note 12", "OPPO Reno 10", "vivo V29", "iPhone 13", "Samsung Galaxy A54", "Realme 11"]
BANKS = ["BCA", "Mandiri", "BRI", "BNI", "CIMB Niaga", "Permata", "Danamon", "BSI"]

SCEN = [
    ("S01", "NORMAL", "Routine transfer to a known beneficiary", "/api/transactions/score", "ALLOW"),
    ("S02", "SCREEN_SHARING", "Social engineering: remote-access app (screen sharing) active during a large transfer", "/api/transactions/score", "DECLINE"),
    ("S03", "MULE_NETWORK", "Transfer to a mule account that shares devices with confirmed fraud accounts", "/api/transactions/score", "CHALLENGE"),
    ("S04", "APP_INVESTMENT_SCAM", "Authorised push payment / investment scam: amount far above usual to a new, very young account", "/api/transactions/score", "HOLD"),
    ("S05", "ACCOUNT_TAKEOVER", "Account takeover: new rooted device, VPN, foreign IP and wrong PINs before the transfer", "/api/transactions/score", "CHALLENGE"),
    ("S06", "COPY_PASTE_PAYEE", "Account number pasted several times into the beneficiary field (coached by a scammer)", "/api/transactions/score", "HOLD"),
    ("S07", "HIGH_VALUE_KNOWN_PAYEE", "Very high-value transfer to a known beneficiary from the usual device", "/api/transactions/score", "HOLD"),
    ("S08", "SANCTIONED_BENEFICIARY", "Beneficiary name matches the sanctions list (fictional demo names)", "/api/transactions/score", "HOLD"),
    ("S09", "LOGIN_ATTACK", "Credential stuffing / brute force: logins from unknown devices abroad with many failures", "/api/events/login", "DENY"),
    ("S10", "SIM_SWAP_PROFILE_CHANGE", "SIM swap / phishing: phone or email changed from a new device abroad", "/api/events/account-update", "DENY"),
]
SANCTIONED = ["Dmitri Volkov Sergeyevich", "Kim Song Chol", "Ahmad Reza Tehrani", "Hassan Al-Qadiri", "Viktor Petrov Antonov"]  # fictional
MULE_COUNTRIES = ["RU", "NG", "KH", "MY", "CN"]

customers, sessions, network, aml, samples = [], [], {}, [], {k: [] for k, *_ in SCEN}
used = set()

def person():
    while True:
        n = f"{random.choice(FIRST)} {random.choice(LAST)}"
        if n not in used: used.add(n); return n

def customer(code, i, **kw):
    cid = f"SCN-{code}-C{i:02d}"
    avg = kw.pop("avg", random.choice([500_000, 800_000, 1_200_000, 2_000_000, 3_500_000]))
    dev = random.choice(DEVICES)
    c = {"id": cid, "name": person(), "age": random.randint(21, 64), "segment": random.choice(SEGMENTS), "city": random.choice(CITIES), "homeCountry": "ID",
         "customerSince": f"{random.randint(2012, 2023)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}", "riskProfile": "LOW",
         "accountId": f"ACC-{code}-{i:02d}", "maskedAccount": f"•••{random.randint(1000, 9999)}", "accountStatus": "ACTIVE", "avgDailySpend": avg,
         "usualDevice": dev, "usualActiveHours": {"from": "06:00", "to": "23:00"}, "knownBeneficiaries": [f"ACC-KB-{code}-{i:02d}-{k}" for k in (1, 2, 3)],
         "sessionBaseline": {"hesitationTimeMs": random.randint(600, 1100), "typingCadenceDeviation": round(random.uniform(0.04, 0.15), 2), "sessionDurationSec": random.randint(120, 240), "navigationPattern": "browse-then-transfer"},
         "phone": f"+62813{random.randint(10_000_000, 99_999_999)}"}
    c.update(kw); customers.append(c); return c

def session(code, i, c, **kw):
    s = {"id": f"SCN-{code}-S{i:02d}", "customerId": c["id"], "minutesAgo": random.randint(1, 30), "deviceModel": c["usualDevice"], "deviceRooted": False, "isVpnDetected": False,
         "ipCountry": "ID", "screenSharingAppDetected": None, "isNewDevice": False, "copyPasteEventsOnBeneficiaryField": 0,
         "hesitationTimeMs": c["sessionBaseline"]["hesitationTimeMs"] + random.randint(-100, 150), "typingCadenceDeviation": c["sessionBaseline"]["typingCadenceDeviation"],
         "sessionDurationSec": c["sessionBaseline"]["sessionDurationSec"] + random.randint(-30, 40), "navigationPattern": "browse-then-transfer", "pinCorrect": True, "failedPinAttempts": 0}
    s.update(kw); sessions.append(s); return s

def transfer(c, s, amount, ben, channel="MOBILE_APP"):
    return {"customerId": c["id"], "sessionId": s["id"], "amount": amount, "channel": channel, "beneficiary": ben}

rnd_amt = lambda lo, hi, step=50_000: random.randrange(lo // step, hi // step) * step

for i in range(1, 11):
    # S01 normal: known payee, usual device, ordinary amount
    c = customer("S01", i); s = session("S01", i, c)
    samples["S01"].append(transfer(c, s, rnd_amt(c["avgDailySpend"] // 4, c["avgDailySpend"] * 2), {"accountId": c["knownBeneficiaries"][0], "bankName": random.choice(BANKS), "name": f"{person()}", "accountAgeDays": random.randint(400, 3000)}))

    # S02 screen sharing scam: AnyDesk / TeamViewer, long hesitation, > Rp 10 jt to a new account
    c = customer("S02", i, age=random.randint(55, 72), segment="Retiree")
    s = session("S02", i, c, screenSharingAppDetected=random.choice(["AnyDesk", "TeamViewer", "RustDesk", "AirDroid"]), hesitationTimeMs=random.randint(4000, 9000), typingCadenceDeviation=0.6, navigationPattern="direct-to-transfer", copyPasteEventsOnBeneficiaryField=random.randint(2, 6))
    samples["S02"].append(transfer(c, s, rnd_amt(15_000_000, 95_000_000, 1_000_000), {"accountId": f"ACC-SCAM-{i:03d}", "bankName": random.choice(BANKS), "name": person(), "accountAgeDays": random.randint(3, 25)}))

    # S03 mule network: beneficiary shares a device with 3–6 flagged accounts
    mule = f"ACC-MULE-{i:03d}"
    shared = random.randint(3, 6)
    network[mule] = {"centerAccountId": mule, "linkedAccountsCount": shared + random.randint(4, 10), "sharedDeviceWith": shared,
                     "nodes": [{"id": mule, "label": "Beneficiary Account", "type": "beneficiary", "flagged": False}] + [{"id": f"{mule}-L{k}", "label": f"•••{random.randint(1000, 9999)}", "type": "account", "flagged": k <= shared} for k in range(1, shared + 3)],
                     "edges": [{"source": mule, "target": f"{mule}-L{k}", "type": "SHARED_DEVICE"} for k in range(1, shared + 1)] + [{"source": f"{mule}-L{k}", "target": mule, "type": "TRANSFER", "amount": rnd_amt(2_000_000, 20_000_000, 100_000)} for k in range(shared + 1, shared + 3)]}
    c = customer("S03", i); s = session("S03", i, c)
    samples["S03"].append(transfer(c, s, rnd_amt(3_000_000, 25_000_000, 500_000), {"accountId": mule, "bankName": random.choice(BANKS), "name": person(), "accountAgeDays": random.randint(5, 60)}))

    # S04 investment / APP scam: usual device, amount 30–150× daily spend, brand-new account
    c = customer("S04", i, avg=random.choice([400_000, 700_000, 1_000_000])); s = session("S04", i, c, hesitationTimeMs=random.randint(2500, 5000))
    samples["S04"].append(transfer(c, s, rnd_amt(c["avgDailySpend"] * 30, c["avgDailySpend"] * 150, 500_000), {"accountId": f"ACC-INV-{i:03d}", "bankName": random.choice(BANKS), "name": random.choice(["PT Cuan Sejahtera Abadi", "CV Profit Kilat", "Koperasi Untung Bersama", "PT Robot Trading Nusantara", "Investasi Emas Digital"]), "accountAgeDays": random.randint(1, 20)}))

    # S05 account takeover: rooted new device, VPN, foreign IP, wrong PINs
    c = customer("S05", i)
    s = session("S05", i, c, deviceModel=random.choice(["Xiaomi Redmi Note 8 (rooted)", "Generic Android 11", "Samsung Galaxy J7 (rooted)"]), isNewDevice=True, deviceRooted=random.random() < 0.7, isVpnDetected=True,
                ipCountry=random.choice(MULE_COUNTRIES), failedPinAttempts=random.randint(1, 4), pinCorrect=True, typingCadenceDeviation=0.8, navigationPattern="direct-to-transfer")
    samples["S05"].append(transfer(c, s, rnd_amt(5_000_000, 40_000_000, 500_000), {"accountId": f"ACC-ATO-{i:03d}", "bankName": random.choice(BANKS), "name": person(), "accountAgeDays": random.randint(2, 40)}))

    # S06 copy-pasted account number to a new payee
    c = customer("S06", i); s = session("S06", i, c, copyPasteEventsOnBeneficiaryField=random.randint(2, 5), hesitationTimeMs=random.randint(2000, 4000))
    samples["S06"].append(transfer(c, s, rnd_amt(2_000_000, 9_000_000, 250_000), {"accountId": f"ACC-CP-{i:03d}", "bankName": random.choice(BANKS), "name": person(), "accountAgeDays": random.randint(60, 900)}))

    # S07 very high value to a KNOWN payee from the usual device
    c = customer("S07", i, avg=random.choice([2_500_000, 5_000_000, 10_000_000])); s = session("S07", i, c)
    samples["S07"].append(transfer(c, s, random.choice([150_000_000, 250_000_000, 500_000_000, 1_000_000_000, 1_500_000_000, 2_500_000_000]), {"accountId": c["knownBeneficiaries"][1], "bankName": random.choice(BANKS), "name": person(), "accountAgeDays": random.randint(800, 4000)}, "INTERNET_BANKING"))

    # S08 sanctioned beneficiary name (spelling variants exercise fuzzy matching)
    c = customer("S08", i); s = session("S08", i, c)
    nm = SANCTIONED[i % len(SANCTIONED)]
    variant = [nm, nm.upper(), " ".join(reversed(nm.split())), nm.replace("i", "y", 1), f"Mr. {nm}"][i % 5]
    samples["S08"].append(transfer(c, s, rnd_amt(1_000_000, 15_000_000, 250_000), {"accountId": f"ACC-SANC-{i:03d}", "bankName": random.choice(["Bank Asing Internasional", "Global Remit Bank", "Offshore Trust Bank"]), "name": variant, "accountAgeDays": random.randint(30, 400)}))

    # S09 login attack: unknown devices abroad, many failed attempts (some from the Tor range on the demo blacklist)
    c = customer("S09", i)
    samples["S09"].append({"customerId": c["id"], "deviceId": random.choice(["Headless Chrome 118", "Python-requests/2.31", "Generic Android 10", "iPhone 15 Pro"]),
                           "ip": random.choice(["185.220.101.44", "185.220.101.7", f"45.{random.randint(10, 250)}.{random.randint(1, 250)}.{random.randint(1, 250)}"]),
                           "ipCountry": random.choice(MULE_COUNTRIES + ["RU"]), "success": random.random() < 0.3, "failedAttempts": random.randint(2, 8)})

    # S10 SIM swap / phishing: sensitive change from a new device abroad
    c = customer("S10", i)
    samples["S10"].append({"customerId": c["id"], "deviceId": random.choice(["iPhone 15 Pro", "Generic Android 11", "Xiaomi Redmi Note 8 (rooted)"]),
                           "ip": f"103.{random.randint(10, 250)}.{random.randint(1, 250)}.{random.randint(1, 250)}", "ipCountry": random.choice(["SG", "MY", "KH", "NG", "RU"]),
                           "change": random.choice(["phone", "email", "password", "pin", "phone", "device"])})

aml = [{"id": f"AML-SCN-{k + 1:02d}", "name": n, "type": "SANCTION", "country": c, "source": "Demo sanctions list (fictional)", "notes": "Fictional name for the SANCTIONED_BENEFICIARY scenario", "createdBy": "system"}
       for k, (n, c) in enumerate(zip(SANCTIONED[:4], ["RU", "KP", "IR", "SY"]))]

out = {"version": 1, "scenarios": [{"code": c, "key": k, "title": t, "endpoint": e, "expected": x} for c, k, t, e, x in SCEN],
       "customers": customers, "sessions": sessions, "network": network, "aml": aml}
(ROOT / "data/seed/scenarios.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
(ROOT / "data/seed/scenario-samples.json").write_text(json.dumps(samples, indent=1, ensure_ascii=False) + "\n")
print(f"customers {len(customers)}, sessions {len(sessions)}, mule accounts {len(network)}, aml {len(aml)}, samples {sum(len(v) for v in samples.values())}")
