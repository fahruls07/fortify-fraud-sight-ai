// Option lists safe to import from client components (lib/settings.ts uses node:fs).
export const TIMEZONES = { "Asia/Jakarta": "WIB (UTC+7)", "Asia/Makassar": "WITA (UTC+8)", "Asia/Jayapura": "WIT (UTC+9)" } as const;
export const LANGUAGES = { en: "English" } as const;

// Endpoints the internet-banking / mobile channel calls for fraud detection (shown in Settings → API Configuration).
export const IB_ENDPOINTS = [
  { method: "POST", path: "/api/flows/{slug}", auth: "X-API-Key", desc: "Run a published workflow: the workflow decides. Transfers → ALLOW / REVIEW (held) / CHALLENGE (OTP sent) / BLOCK (declined); logins & account changes → ALLOW / CHALLENGE / DENY. Body = the transfer or event payload below. Inactive endpoints answer 423.",
    example: `{ "customerId": "CUST-0005", "sessionId": "SES-A0001", "amount": 25000000, "beneficiary": { "accountId": "ACC-BEN-7781", "bankName": "Bank Nusantara Digital", "name": "Rizky Pratama", "accountAgeDays": 9 } }` },
  { method: "POST", path: "/api/transactions/score", auth: "X-API-Key", desc: "Score a transfer before money moves. Decided by the built-in pipeline (baseline + amount escalation + watchlists + AML + active rules) or by the workflow set to serve this API. Returns ALLOW, HOLD (analyst review), CHALLENGE (OTP sent) or DECLINE, plus the customer message.",
    example: `{ "customerId": "CUST-0005", "sessionId": "SES-A0001", "amount": 250000, "channel": "MOBILE_APP", "beneficiary": { "accountId": "ACC-KB-0005-1", "bankName": "CIMB Niaga", "name": "Regular", "accountAgeDays": 1200 } }` },
  { method: "GET", path: "/api/transactions/{transactionId}/status", auth: "X-API-Key", desc: "Poll a held transfer (every 3–5 s) until it is RELEASED, DECLINED or CHALLENGE_SENT. Includes accountStatus and the customer message." },
  { method: "POST", path: "/api/transactions/{transactionId}/challenge", auth: "X-API-Key", desc: "Customer enters the OTP sent for a challenged transfer. Correct → RELEASED; too many wrong codes → stays held for an analyst.", example: `{ "otp": "123456" }` },
  { method: "POST", path: "/api/events/login", auth: "X-API-Key", desc: "Score a login attempt before granting the session. Returns ALLOW, CHALLENGE (step-up) or DENY with reasons.",
    example: `{ "customerId": "CUST-0001", "deviceId": "iPhone 15", "ip": "203.0.113.7", "ipCountry": "RU", "success": false, "failedAttempts": 2 }` },
  { method: "POST", path: "/api/events/account-update", auth: "X-API-Key", desc: "Score a sensitive account change (phone, email, password, pin, device, beneficiary_add, limit, address) before applying it.",
    example: `{ "customerId": "CUST-0001", "deviceId": "iPhone 15", "ipCountry": "ID", "change": "phone" }` },
  { method: "GET", path: "/api/openapi", auth: "Public", desc: "OpenAPI 3 contract for the two endpoints above (YAML). Import it into Postman / Swagger." },
  { method: "POST", path: "{your webhook URL}", auth: "HMAC X-Fortify-Signature", desc: "Outbound: FraudSight AI calls your system on alert created / resolved (configure below)." },
] as const;
