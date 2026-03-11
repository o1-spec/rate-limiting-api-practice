import { useState, useRef } from "react";
import {
  Send, Zap, Square, Trash2, ChevronRight, Clock,
  CheckCircle2, XCircle, AlertCircle, Gauge,
} from "lucide-react";
import { fireRequest } from "../lib/api";
import Badge from "../components/Badge";

const PRESETS = [
  { label: "POST /auth/login",    route: "/auth/login",    method: "POST", body: '{\n  "email": "alice@example.com",\n  "password": "password123"\n}' },
  { label: "POST /auth/register", route: "/auth/register", method: "POST", body: '{\n  "name": "Test User",\n  "email": "test@test.com",\n  "password": "123456"\n}' },
  { label: "GET /api/data",       route: "/api/data",      method: "GET",  body: "" },
  { label: "GET /api/data/:id",   route: "/api/data/d1",   method: "GET",  body: "" },
  { label: "GET /users",          route: "/users",         method: "GET",  body: "" },
  { label: "GET /users/:id",      route: "/users/u1",      method: "GET",  body: "" },
];

function statusColor(s) {
  if (s >= 200 && s < 300) return "text-green-400";
  if (s === 429)            return "text-red-400";
  if (s >= 400)             return "text-yellow-400";
  return "text-slate-400";
}

function StatusIcon({ status, size = 14 }) {
  if (status >= 200 && status < 300) return <CheckCircle2 size={size} className="text-green-400" />;
  if (status === 429)                 return <XCircle      size={size} className="text-red-400"   />;
  return                                     <AlertCircle  size={size} className="text-yellow-400" />;
}

function QuotaBar({ used, limit }) {
  const remaining    = Math.max(0, limit - used);
  const remainingPct = limit > 0 ? Math.min(100, (remaining / limit) * 100) : 100;
  const barColor =
    remainingPct < 20 ? "bg-red-500" :
    remainingPct < 50 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">Quota remaining</span>
        <span className="text-slate-200 font-mono font-medium">{remaining} / {limit}</span>
      </div>
      <div className="h-1.5 bg-slate-700/80 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>0</span>
        <span>{Math.round(remainingPct)}% remaining</span>
        <span>{limit}</span>
      </div>
    </div>
  );
}

export default function Tester() {
  const [route,      setRoute]      = useState("/auth/login");
  const [method,     setMethod]     = useState("POST");
  const [body,       setBody]       = useState('{\n  "email": "alice@example.com",\n  "password": "password123"\n}');
  const [userId,     setUserId]     = useState("");
  const [results,    setResults]    = useState([]);
  const [firing,     setFiring]     = useState(false);
  const [burstCount, setBurstCount] = useState(7);
  const abortRef = useRef(false);

  function applyPreset(p) {
    setRoute(p.route);
    setMethod(p.method);
    setBody(p.body);
  }

  async function fire() {
    setFiring(true);
    const r = await fireRequest({ route, method, body, userId });
    setResults((prev) => [r, ...prev].slice(0, 50));
    setFiring(false);
  }

  async function fireBurst() {
    setFiring(true);
    abortRef.current = false;
    for (let i = 0; i < burstCount; i++) {
      if (abortRef.current) break;
      const r = await fireRequest({ route, method, body, userId });
      setResults((prev) => [r, ...prev].slice(0, 50));
      await new Promise((res) => setTimeout(res, 120));
    }
    setFiring(false);
  }

  const latest    = results[0];
  const limit     = parseInt(latest?.headers?.limit     ?? "0");
  const remaining = parseInt(latest?.headers?.remaining ?? "0");
  const used      = limit - remaining;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* ── Left: controls ── */}
      <div className="space-y-4">

        {/* Presets */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Presets</h3>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/50 hover:border-slate-600 transition-all"
              >
                <ChevronRight size={11} className="text-slate-500" />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Request builder */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Request Builder</h3>

          {/* Method + Route */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
            >
              {["GET","POST","PATCH","PUT","DELETE"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <input
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              placeholder="/auth/login"
            />
          </div>

          {/* User ID */}
          <div className="relative">
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-3 pr-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              placeholder="x-user-id (optional — enables per-user limiting)"
            />
          </div>

          {/* Body */}
          {!["GET","HEAD"].includes(method) && (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors resize-none"
              placeholder='{"key": "value"}'
            />
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              onClick={fire}
              disabled={firing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium transition-all"
            >
              <Send size={14} />
              Fire Request
            </button>

            <div className="flex items-center gap-1.5">
              <button
                onClick={fireBurst}
                disabled={firing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-medium transition-all"
              >
                <Zap size={14} />
                Fire {burstCount}×
              </button>
              <input
                type="number"
                value={burstCount}
                min={1}
                max={50}
                onChange={(e) => setBurstCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-14 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200 text-center focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {firing && (
              <button
                onClick={() => { abortRef.current = true; setFiring(false); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-all"
              >
                <Square size={12} />
                Stop
              </button>
            )}

            {results.length > 0 && (
              <button
                onClick={() => setResults([])}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 text-sm transition-all ml-auto"
              >
                <Trash2 size={13} />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Quota bar */}
        {latest && limit > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Gauge size={14} className="text-slate-400" />
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Rate Limit Quota</h3>
            </div>
            <QuotaBar used={used} limit={limit} />
            {latest.headers.reset && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock size={11} />
                <span>Resets at {new Date(parseInt(latest.headers.reset) * 1000).toLocaleTimeString()}</span>
                {latest.headers.retryAfter && (
                  <span className="ml-1 text-red-400 font-medium">· retry in {latest.headers.retryAfter}s</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: response log ── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Response Log</h3>
          <span className="text-xs text-slate-600 bg-slate-800/60 px-2 py-0.5 rounded-md">
            {results.length} / 50
          </span>
        </div>

        {results.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600 h-48">
            <Send size={24} strokeWidth={1.5} />
            <span className="text-sm">Fire a request to see responses here</span>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {results.map((r, i) => (
              <div
                key={i}
                className={`rounded-lg border p-4 text-sm transition-colors ${
                  r.status === 429 ? "border-red-500/20 bg-red-500/5" :
                  r.ok             ? "border-green-500/20 bg-green-500/5" :
                                     "border-yellow-500/20 bg-yellow-500/5"
                }`}
              >
                {/* Status row */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={r.status} />
                    <span className={`font-bold font-mono text-sm ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-slate-500 font-mono text-xs">{r.method} {r.route}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 font-mono">{r.duration}ms</span>
                    {r.status === 429 ? <Badge label="BLOCKED" variant="red" /> :
                     r.ok             ? <Badge label="OK"      variant="green" /> :
                                        <Badge label="ERROR"   variant="yellow" />}
                  </div>
                </div>

                {/* Rate-limit headers */}
                {r.headers.limit && (
                  <div className="flex flex-wrap gap-3 mb-2.5 py-2 border-y border-slate-700/30">
                    <span className="text-xs font-mono text-slate-500">
                      limit <span className="text-slate-300 font-semibold">{r.headers.limit}</span>
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      remaining <span className={`font-semibold ${parseInt(r.headers.remaining) === 0 ? "text-red-400" : "text-slate-300"}`}>
                        {r.headers.remaining}
                      </span>
                    </span>
                    {r.headers.retryAfter && (
                      <span className="text-xs font-mono text-red-400 font-semibold">retry-after {r.headers.retryAfter}s</span>
                    )}
                  </div>
                )}

                {/* Response body */}
                <pre className="text-xs text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
                  {JSON.stringify(r.data, null, 2)}
                </pre>

                {/* Timestamp */}
                <div className="flex items-center gap-1 text-xs text-slate-600 mt-2">
                  <Clock size={10} />
                  {new Date(r.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
