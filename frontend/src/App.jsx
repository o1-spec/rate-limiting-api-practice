import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import Tester from "./pages/Tester";
import Rules from "./pages/Rules";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "tester",    label: "Tester",    icon: "🔬" },
  { id: "rules",     label: "Rules",     icon: "📋" },
];

export default function App() {
  const [active, setActive] = useState("dashboard");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">Rate Limiting Gateway</h1>
            <p className="text-xs text-slate-500">localhost:4000</p>
          </div>
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  active === tab.id
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {active === "dashboard" && <Dashboard />}
        {active === "tester"    && <Tester />}
        {active === "rules"     && <Rules />}
      </main>
    </div>
  );
}
