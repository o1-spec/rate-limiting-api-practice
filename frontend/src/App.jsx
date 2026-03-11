import { useState } from "react";
import { LayoutDashboard, FlaskConical, BookOpen, Shield } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Tester from "./pages/Tester";
import Rules from "./pages/Rules";

const TABS = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "tester",    label: "Tester",    Icon: FlaskConical     },
  { id: "rules",     label: "Rules",     Icon: BookOpen         },
];

export default function App() {
  const [active, setActive] = useState("dashboard");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-600">
              <Shield size={14} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <span className="text-sm font-semibold text-white tracking-tight">Rate Limiting Gateway</span>
              <span className="ml-2 text-xs text-slate-500 font-mono">:4000</span>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-1 bg-slate-800/60 rounded-xl p-1">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  active === id
                    ? "bg-slate-700 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon size={14} strokeWidth={2} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-6xl mx-auto px-5 py-7">
        {active === "dashboard" && <Dashboard />}
        {active === "tester"    && <Tester />}
        {active === "rules"     && <Rules />}
      </main>
    </div>
  );
}
