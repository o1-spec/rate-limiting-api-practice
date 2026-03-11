import { useEffect, useState } from "react";
import { Globe, User, RefreshCw, AlertTriangle, ShieldCheck, ShieldOff, Code2 } from "lucide-react";
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

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 text-sm p-4">
      <AlertTriangle size={16} /> Failed to load rules: {error}
    </div>
  );
  if (!rules) return (
    <div className="flex items-center gap-2 text-slate-400 text-sm p-4">
      <RefreshCw size={14} className="animate-spin" /> Loading rules…
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Global policies */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Global Policies</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: "globalIp",   label: "Global IP",   Icon: Globe, iconColor: "text-blue-400",  bg: "bg-blue-500/10",  desc: "Applies to every request regardless of route or user." },
            { key: "globalUser", label: "Global User", Icon: User,  iconColor: "text-violet-400", bg: "bg-violet-500/10", desc: "Applies when x-user-id header is present. Skipped for anonymous traffic." },
          ].map(({ key, label, Icon, iconColor, bg, desc }) => {
            const p = rules[key];
            if (!p) return null;
            return (
              <div key={key} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${bg}`}>
                    <Icon size={15} className={iconColor} strokeWidth={2} />
                  </div>
                  <span className="text-sm font-medium text-slate-200">{label}</span>
                  <Badge label={ALGO_LABEL[p.algorithm] ?? p.algorithm} variant={ALGO_VARIANT[p.algorithm] ?? "default"} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                  <div className="bg-slate-900/60 rounded-lg px-3 py-2.5">
                    <div className="text-slate-500 mb-1">Max requests</div>
                    <div className="text-slate-100 font-mono font-bold text-base">{p.max}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg px-3 py-2.5">
                    <div className="text-slate-500 mb-1">Window</div>
                    <div className="text-slate-100 font-mono font-bold text-base">{fmt(p.windowMs)}</div>
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Route policies */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Code2 size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Route Policies</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-800">
                <th className="text-left pb-3 pr-6 font-medium">Route</th>
                <th className="text-left pb-3 pr-6 font-medium">Algorithm</th>
                <th className="text-right pb-3 pr-4 font-medium">Limit</th>
                <th className="text-right pb-3 pr-6 font-medium">Window</th>
                <th className="text-left pb-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {Object.entries(rules.routes ?? {}).map(([key, p]) => (
                <tr key={key} className="text-slate-300 hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 pr-6 font-mono text-xs text-blue-400">
                    /{key.replace(/_/g, "/")}
                  </td>
                  <td className="py-3 pr-6">
                    <Badge label={ALGO_LABEL[p.algorithm] ?? p.algorithm} variant={ALGO_VARIANT[p.algorithm] ?? "default"} />
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums">{p.capacity ?? p.max}</td>
                  <td className="py-3 pr-6 text-right font-mono tabular-nums text-slate-400">{fmt(p.windowMs)}</td>
                  <td className="py-3 text-xs text-slate-500 max-w-xs leading-relaxed">{ALGO_DESC[p.algorithm]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Failure mode */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Redis Failure Behavior</h3>
        <div className="flex items-start gap-4">
          <div className={`flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 ${
            rules.redisFailureMode === "closed" ? "bg-red-500/10" : "bg-green-500/10"
          }`}>
            {rules.redisFailureMode === "closed"
              ? <ShieldOff  size={18} className="text-red-400"   />
              : <ShieldCheck size={18} className="text-green-400" />}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge
                label={rules.redisFailureMode === "closed" ? "Fail Closed" : "Fail Open"}
                variant={rules.redisFailureMode === "closed" ? "red" : "green"}
              />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              {rules.redisFailureMode === "closed"
                ? "If Redis is unreachable, all traffic is blocked with 503. Protection wins."
                : "If Redis is unreachable, traffic is allowed through. Availability wins."}
            </p>
            <p className="text-xs text-slate-600 mt-1.5">
              Controlled by the <code className="font-mono text-slate-500 bg-slate-800 px-1 py-0.5 rounded">REDIS_FAILURE_MODE</code> env var on the gateway.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
