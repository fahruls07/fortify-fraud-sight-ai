# 🎯 PROMPT: Build AQUA Dashboard

Kamu adalah senior frontend developer. Bangun dashboard admin **AQUA** sesuai spesifikasi berikut. Output harus berupa kode lengkap (bukan stub), bisa langsung dijalankan dengan `npm run dev`.

---

## 🛠️ Tech Stack
- **Vite + React + TypeScript**
- **Tailwind CSS** (via @tailwindcss/vite)
- **Redux Toolkit + React-Redux** (state management)
- **Recharts** (chart)
- **Lucide React** (ikon)
- **Font**: Inter (Google Fonts)

---

##  Design System

| Token | Value |
|-------|-------|
| Primary | `#6B46C1` (violet-600) |
| Primary Light | `#EDE9FE` |
| Background | `#F3F4F6` |
| Sidebar BG | `#FFFFFF` |
| Dark Banner | `linear-gradient(135deg, #1a1a2e, #2d2d44)` |
| Teal Accent | `#14B8A6 → #06B6D4` |
| Blue-Teal | `#3B82F6 → #14B8A6` |
| Success | `#10B981` |
| Danger | `#EF4444` |
| Radius Card | `rounded-xl` |
| Radius Button | `rounded-lg` |
| Shadow | `shadow-sm`, hover `shadow-md` |

---

##  Redux Store

### `appConfigSlice`
```ts
{
  appName: "AQUA",
  appLogo: "wave",          // "wave" | "shield" | "zap" | "droplet" | "flame" | URL
  primaryColor: "#6B46C1",
  darkMode: false
}
// Actions: updateAppName, updateAppLogo, updatePrimaryColor, toggleDarkMode, resetToDefault

// sidebarSlice
{
  activeMenu: "Command Center",
  isCollapsed: false
}
// Actions: setActiveMenu, toggleSidebar

// analyticsSlice
{
  fyData: [{year, value, change, trend}],
  monthlyData: [{month, revenue, cost}],
  stats: {server, traffic, email, pageViews},
  expenses: 7523,
  clients: 512,
  revenueToday: "$154.5 K"
}