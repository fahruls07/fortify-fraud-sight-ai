// The banking app / simulator runs on a separate origin and calls the fraud channel: /api/transactions/*,
// /api/events/* and /api/flows/*. All three need CORS headers, otherwise the browser blocks the request
// (the events/login preflight used to fail with "Request header field content-type is not allowed").
//
// Shortcut: wildcard origin. Pin it to the banking app's real origin(s) before an internet-facing launch,
// e.g. value: "https://ib.example.co.id". Origins are read from CORS_ORIGINS (comma-separated) so the same
// build works in demo and production.
const CHANNEL = ["/api/transactions/:path*", "/api/events/:path*", "/api/flows/:path*"];

const corsHeaders = () => [
  { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS ?? "*" },
  { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type,X-API-Key,X-Fortify-Signature" },
  { key: "Access-Control-Max-Age", value: "86400" },
];

export default {
  async headers() {
    return CHANNEL.map((source) => ({ source, headers: corsHeaders() }));
  },
};
