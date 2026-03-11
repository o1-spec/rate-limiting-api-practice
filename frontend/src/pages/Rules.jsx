import { useEffect, useState } from "react";
import { fetchRules } from "../lib/api";
import Badge from "../components/Badge";

const ALGO_VARIANT = { slidingWindow: "sliding", tokenBucket: "token", fixedWindow: "fixed" };
const ALGO_LABEL   = { slidingWindow: "Sliding Window", tokenBucket: "Token Bucket", fixedWindow: "Fixed Window" };
const ALGO_DESC    = {
  slidingWindow: "Redis sorted set — tracks exact timestamps, no boundary burst exploit.",
  tokenBucket:   "Redis hash — tokens refill at a steady rate, allows controlled bursts.",
  fixedWindow:   "Redis INCR + PEXPIRE — simplest and lowest overhead, resets every window.",
};

function fmt(ms) {
  if (!ms) return "—";
  if (ms >= 60000) return `${ms / 60000}m`;
  if (ms >= 1000)  return `${ms / 1000}s`;
  return `${ms}ms`;
}

export default function Rules() {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchRules().then(setRules).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-red-400 text-sm p-4">Failed to load rules: {error}</div>;
  if (!rules) return <div className="text-slate-400 animate-pulse text-sm p-4">Loading rules…</div>;

  return (
    <div className="space-y-6">

      {/* Global policies */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Global Policies</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: "globalIp",   label: "Global IP",   icon: "🌐", desc: "Applies to every request regardless of route or user." },
            { key: "globalUser", label: "Global User", icon: "👤", desc: "Applies when the x-user-id header is present. Skipped for anonymous traffic." },
          ].map(({ key, label, icon, desc }) => {
            const p = rules[key];
            if (!p) return null;
            return (
              <div key={key} className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span>{icon}</span>
                  <span className="text-sm font-medium text-slate-200">{label}</span>
                  <Badge label={ALGO_LABEL[p.algorithm] ?? p.algorithm} variant={ALGO_VARIANT[p.algorithm] ?? "default"} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                  <div>
                    <div className="text-slate-500 mb-0.5">Max requests</div>
                    <div className="text-slate-200 font-mono font-bold">{p.max}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Window</div>
                    <div className="text-slate-200 font-mono font-bold">{fmt(p.windowMs)}</div>
                  </div>
                </div>
                <p className="text-xs text-slate-500">{desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Route policies */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Route Policies</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                <th className="text-left pb-3 pr-6">Route</th>
                <th className="text-left pb-3 pr-6">Algorithm</th>
                <th className="text-right pb-3 pr-4">Limit</th>
                <th className="text-right pb-3 pr-6">Window</th>
                <th className="text-left pb-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {Object.entries(rules.routes ?? {}).map(([key, p]) => (
                <tr key={key} className="text-slate-300 hover:bg-slate-700/20 transition-colors">
                  <td className="py-3 pr-6 font-mono text-xs text-blue-400">
                    /{key.replace(/_/g, "/")}
                  </td>
                  <td className="py-3 pr-6">
                    <Badge label={ALGO_LABEL[p.algorithm] ?? p.algorithm} variant={ALGO_VARIANT[p.algorithm] ?? "default"} />
                  </td>
                  <td className="py-3 pr-4 text-right font-mono">{p.capacity ?? p.max}</td>
                  <td className="py-3 pr-6 text-right font-mono text-slate-400">{fmt(p.windowMs)}</td>
                  <td className="py-3 text-xs text-slate-500 max-w-xs">{ALGO_DESC[p.algorithm]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Failure mode */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Redis Failure Behavior</h3>
        <div className="flex items-center gap-3">
          <Badge
            label={rules.redisFailureMode === "closed" ? "Fail Closed" : "Fail Open"}
            variant={rules.redisFailureMode === "closed" ? "red" : "green"}
          />
          <span className="text-xs text-slate-400">
            {rules.redisFailureMode === "closed"
              ? "If Redis is unreachable, all traffic is blocked with 503. Protection wins."
              : "If Redis is unreachable, traffic is allowed through. Availability wins."}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Controlled by the <span className="font-mono text-slate-500">REDIS_FAILURE_MODE</span> env var on the gateway.
        </p>
      </div>
    </div>
  );
}
