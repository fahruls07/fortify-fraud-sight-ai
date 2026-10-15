// The banking app is a separate origin and calls /api/transactions/*. shortcut: wildcard origin, pin to the banking app's origin before production.
export default {
  async headers() {
    return [{ source: "/api/transactions/:path*", headers: [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Content-Type" },
    ] }];
  },
};
