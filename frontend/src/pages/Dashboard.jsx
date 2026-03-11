import { useEffect, useState, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import {
  Activity, CheckCircle2, XCircle, TrendingUp,
  Database, Server, AlertTriangle, RefreshCw, Settings2, Pause, Play,
} from "lucide-react";
import { fetchStats, fetchHealth } from "../lib/api";
import StatCard from "../components/StatCard";
import Badge from "../components/Badge";
import StatusDot from "../components/StatusDot";

const ALGO_VARIANT = { slidingWindow: "sliding", tokenBucket: "token", fixedWindow: "fixed" };
const ALGO_LABEL   = { slidingWindow: "Sliding Window", tokenBucket: "Token Bucket", fixedWindow: "Fixed Window" };

const TIP_STYLE = {
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#94a3b8",
};

export default function Dashboard() {
  const [stats,       setStats]       = useState(null);
  const [health,      setHealth]      = useState(null);
  const [history,     setHistory]     = useState([]);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [paused,      setPaused]      = useState(false);
  const intervalRef = useRef(null);

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
            time:    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
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

  // Start / stop interval based on paused state
  useEffect(() => {
    if (paused) {
      clearInterval(intervalRef.current);
      return;
    }
    load();
    intervalRef.current = setInterval(load, 5000);
    return () => clearInterval(intervalRef.current);
  }, [load, paused]);

  // Pause polling when the browser tab is hidden
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(intervalRef.current);
      } else if (!paused) {
        load();
        intervalRef.current = setInterval(load, 5000);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load, paused]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <AlertTriangle size={36} className="text-red-400 mx-auto" strokeWidth={1.5} />
          <div className="text-red-400 font-medium">Gateway unreachable</div>
          <div className="text-slate-500 text-sm">{error}</div>
          <div className="text-slate-600 text-xs">Make sure the gateway is running on port 4000</div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-slate-400">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Connecting to gateway…</span>
        </div>
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
        <div className="flex items-center gap-2.5">
          <StatusDot status={health?.status} />
          <span className="text-sm font-medium text-slate-300">
            Gateway <span className="text-slate-400 font-normal">{health?.status ?? "unknown"}</span>
          </span>
          {health?.uptime && (
            <span className="text-xs text-slate-600 bg-slate-800/60 px-2 py-0.5 rounded-md">
              up {health.uptime}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-slate-600">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={load}
            title="Refresh now"
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume polling" : "Pause polling"}
            className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
              paused
                ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                : "bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            {paused ? <Play size={11} /> : <Pause size={11} />}
          </button>
          <span className="text-xs text-slate-600 bg-slate-800/60 px-2 py-0.5 rounded-md">
            {paused ? "paused" : "5s"}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Requests" value={stats.totalRequests.toLocaleString()}  icon={Activity}     color="blue"   />
        <StatCard label="Allowed"        value={stats.allowedRequests.toLocaleString()} icon={CheckCircle2} color="green"  />
        <StatCard label="Blocked"        value={stats.blockedRequests.toLocaleString()} icon={XCircle}      color="red"    />
        <StatCard label="Block Rate"     value={stats.blockRate ?? "0%"}                icon={TrendingUp}   color="yellow" sub="of all requests" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Requests Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
              <Tooltip contentStyle={TIP_STYLE} />
              <Line type="monotone" dataKey="allowed" stroke="#22c55e" strokeWidth={2} dot={false} name="Allowed" />
              <Line type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} dot={false} name="Blocked" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">By Scope</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={scopeData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="scope" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
              <Tooltip contentStyle={TIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "#64748b", paddingTop: "8px" }} />
              <Bar dataKey="allowed" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="blocked" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Route breakdown */}
      {routeRows.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Route Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-800">
                  <th className="text-left pb-3 pr-4 font-medium">Route</th>
                  <th className="text-left pb-3 pr-4 font-medium">Algorithm</th>
                  <th className="text-right pb-3 pr-4 font-medium">Allowed</th>
                  <th className="text-right pb-3 pr-4 font-medium">Blocked</th>
                  <th className="text-right pb-3 font-medium">Block %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {routeRows.map(([route, v]) => {
                  const total = v.allowed + v.blocked;
                  const pct   = total > 0 ? ((v.blocked / total) * 100).toFixed(1) : "0.0";
                  const algo  = stats.rules?.[route]?.algorithm ?? "fixedWindow";
                  const pctVal = parseFloat(pct);
                  return (
                    <tr key={route} className="text-slate-300 hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs text-blue-400">{route}</td>
                      <td className="py-3 pr-4">
                        <Badge label={ALGO_LABEL[algo] ?? algo} variant={ALGO_VARIANT[algo] ?? "default"} />
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-green-400">{v.allowed.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-red-400">{v.blocked.toLocaleString()}</td>
                      <td className={`py-3 text-right tabular-nums font-medium ${
                        pctVal > 20 ? "text-red-400" : pctVal > 5 ? "text-yellow-400" : "text-slate-500"
                      }`}>{pct}%</td>
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
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Infrastructure</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800">
                <Database size={16} className={health.redis === "ok" ? "text-green-400" : "text-red-400"} />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-200">Redis</div>
                <div className={`text-xs ${health.redis === "ok" ? "text-green-400" : "text-red-400"}`}>
                  {health.redis === "ok" ? "Connected" : "Unreachable"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800">
                <Server size={16} className="text-blue-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-200">Backend</div>
                <div className="text-xs text-slate-500 font-mono">{health.backend}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800">
                <Settings2 size={16} className="text-slate-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-200">Failure Mode</div>
                <div className={`text-xs font-medium ${health.redisFailureMode === "closed" ? "text-red-400" : "text-green-400"}`}>
                  {health.redisFailureMode === "closed" ? "Fail Closed" : "Fail Open"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
