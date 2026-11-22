import { useEffect, useRef } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { useAuth, useList, useValue } from "./hooks";
import { notify, requestNotificationPermission } from "./platform";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Recommendations from "./pages/Recommendations";
import Assistant from "./pages/Assistant";
import Reports from "./pages/Reports";
import Feeding from "./pages/Feeding";
import History from "./pages/History";
import Settings from "./pages/Settings";

// Simple line icons (24×24) for the navigation bar.
const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  care: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z",
  chat: "M4 5h16v11H8l-4 4z",
  feed: "M6 3v8a3 3 0 0 0 6 0V3M9 3v18M16 3c-1.5 2-2 4-2 6s1 3 2 3v9",
  history: "M4 19h16M7 16V10M12 16V6M17 16v-4",
  report: "M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L5.8 7.3 4 7l-1 3 2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z",
};
const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const NAV = [
  ["/", "Dashboard", "Home", "home"],
  ["/recommendations", "AI Care", "AI Care", "care"],
  ["/assistant", "Assistant", "Ask AI", "chat"],
  ["/feeding", "Feeding", "Feed", "feed"],
  ["/history", "History", "History", "history"],
  ["/reports", "Reports", "Reports", "report"],
  ["/settings", "Settings", "Settings", "settings"],
];

/** Shows a notification for new unresolved alerts while the app is open. */
function AlertNotifier() {
  const alerts = useList("alerts", { limit: 5 });
  const settings = useValue("settings");
  const seen = useRef(null);
  const enabled = settings?.notifications?.browser !== false;

  useEffect(() => { if (enabled) requestNotificationPermission(); }, [enabled]);

  useEffect(() => {
    if (!alerts) return;
    const ids = new Set(alerts.map((a) => a.id));
    if (seen.current === null) { seen.current = ids; return; } // ignore alerts that existed on load
    alerts
      .filter((a) => !seen.current.has(a.id) && !a.resolved)
      .forEach((a) => { if (enabled) notify(`SmartTank ${a.level?.toUpperCase() || "ALERT"}`, a.message); });
    seen.current = ids;
  }, [alerts, enabled]);
  return null;
}

export default function App() {
  const user = useAuth();
  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icons/icon-192.png" alt="" width="28" height="28" className="brand-logo" /> SmartTank
        </div>
        <nav className="mainnav" aria-label="Main">
          {NAV.map(([to, label, short, icon]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon d={ICONS[icon]} />
              <span className="nav-long">{label}</span>
              <span className="nav-short">{short}</span>
            </NavLink>
          ))}
        </nav>
        <button className="ghost small" onClick={() => signOut(auth)}>
          Log out
        </button>
      </header>
      <AlertNotifier />
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recommendations" element={<Recommendations />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/feeding" element={<Feeding />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
