import { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import { fetchStats, fetchHealth } from "../lib/api";
import StatCard from "../components/StatCard";
import Badge from "../components/Badge";
import StatusDot from "../components/StatusDot";

const ALGO_VARIANT = { slidingWindow: "sliding", tokenBucket: "token", fixedWindow: "fixed" };
const ALGO_LABEL   = { slidingWindow: "Sliding Window", tokenBucket: "Token Bucket", fixedWindow: "Fixed Window" };

const TIP_STYLE = {
  background: "#1e2130",
  border: "1px solid #334155",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function Dashboard() {
  const [stats,       setStats]       = useState(null);
  const [health,      setHealth]      = useState(null);
  const [history,     setHistory]     = useState([]);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetchStats(), fetchHealth()]);
      setStats(s);
      setHealth(h);
      setLastUpdated(new Date());
      setError(null);
      setHistory((prev) => {
        const next = [
          ...prev,
          {
            time:    new Date().toLocaleTimeString(),
            allowed: s.allowedRequests,
            blocked: s.blockedRequests,
          },
        ];
        return next.slice(-20);
      });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [load]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-red-400 text-4xl mb-3">⚠</div>
          <div className="text-red-400 font-medium">Gateway unreachable</div>
          <div className="text-slate-500 text-sm mt-1">{error}</div>
          <div className="text-slate-600 text-xs mt-2">Make sure the gateway is running on port 4000</div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 animate-pulse">Connecting to gateway…</div>
      </div>
    );
  }

  const routeRows = Object.entries(stats.byRoute ?? {}).filter(
    ([, v]) => v.allowed + v.blocked > 0
  );

  const scopeData = Object.entries(stats.byScope ?? {}).map(([scope, v]) => ({
    scope: scope.replace("_", " "),
    allowed: v.allowed,
    blocked: v.blocked,
  }));

  return (
    <div className="space-y-6">

      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusDot status={health?.status} />
          <span className="text-sm text-slate-400">Gateway {health?.status ?? "unknown"}</span>
          {health?.uptime && (
            <span className="text-xs text-slate-600">up {health.uptime}</span>
          )}
        </div>
        <span className="text-xs text-slate-600">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "—"}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Requests"  value={stats.totalRequests.toLocaleString()}   icon="📊" color="blue"   />
        <StatCard label="Allowed"         value={stats.allowedRequests.toLocaleString()}  icon="✅" color="green"  />
        <StatCard label="Blocked"         value={stats.blockedRequests.toLocaleString()}  icon="🚫" color="red"    />
        <StatCard label="Block Rate"      value={stats.blockRate ?? "0%"}                 icon="📈" color="yellow" sub="of all requests" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-4">Requests Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
              <YAxis                tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
              <Tooltip contentStyle={TIP_STYLE} />
              <Line type="monotone" dataKey="allowed" stroke="#22c55e" strokeWidth={2} dot={false} name="Allowed" />
              <Line type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} dot={false} name="Blocked" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-4">By Scope</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={scopeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="scope" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
              <YAxis                tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
              <Tooltip contentStyle={TIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
              <Bar dataKey="allowed" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="blocked" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Route breakdown */}
      {routeRows.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-4">Route Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                  <th className="text-left pb-3 pr-4">Route</th>
                  <th className="text-left pb-3 pr-4">Algorithm</th>
                  <th className="text-right pb-3 pr-4">Allowed</th>
                  <th className="text-right pb-3 pr-4">Blocked</th>
                  <th className="text-right pb-3">Block %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {routeRows.map(([route, v]) => {
                  const total = v.allowed + v.blocked;
                  const pct   = total > 0 ? ((v.blocked / total) * 100).toFixed(1) : "0.0";
                  const algo  = stats.rules?.[route]?.algorithm ?? "fixedWindow";
                  return (
                    <tr key={route} className="text-slate-300 hover:bg-slate-700/20">
                      <td className="py-3 pr-4 font-mono text-xs">{route}</td>
                      <td className="py-3 pr-4">
                        <Badge label={ALGO_LABEL[algo] ?? algo} variant={ALGO_VARIANT[algo] ?? "default"} />
                      </td>
                      <td className="py-3 pr-4 text-right text-green-400">{v.allowed.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right text-red-400">{v.blocked.toLocaleString()}</td>
                      <td className={`py-3 text-right ${parseFloat(pct) > 20 ? "text-red-400" : parseFloat(pct) > 5 ? "text-yellow-400" : "text-slate-400"}`}>
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Infrastructure */}
      {health && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Infrastructure</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-3">
              <StatusDot status={health.redis === "ok" ? "healthy" : "down"} />
              <div>
                <div className="text-slate-300 font-medium">Redis</div>
                <div className="text-xs text-slate-500">{health.redis === "ok" ? "Connected" : "Unreachable"}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusDot status="healthy" />
              <div>
                <div className="text-slate-300 font-medium">Backend</div>
                <div className="text-xs text-slate-500 font-mono">{health.backend}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-400">⚙</span>
              <div>
                <div className="text-slate-300 font-medium">Failure Mode</div>
                <div className="text-xs text-slate-500">{health.redisFailureMode ?? "open"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
