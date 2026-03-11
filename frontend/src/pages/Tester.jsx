import { useState, useRef } from "react";
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

function QuotaBar({ used, limit }) {
  const remaining    = Math.max(0, limit - used);
  const remainingPct = limit > 0 ? Math.min(100, (remaining / limit) * 100) : 100;
  const barColor     =
    remainingPct < 20 ? "bg-red-500" :
    remainingPct < 50 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">Requests used</span>
        <span className="text-slate-300 font-mono">{remaining} / {limit} remaining</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${remainingPct}%` }} />
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

  const latest      = results[0];
  const limit       = parseInt(latest?.headers?.limit     ?? "0");
  const remaining   = parseInt(latest?.headers?.remaining ?? "0");
  const used        = limit - remaining;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* ── Left: controls ── */}
      <div className="space-y-5">

        {/* Presets */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Quick Presets</h3>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Request builder */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
          <h3 className="text-sm font-medium text-slate-300">Request Builder</h3>

          <div className="flex gap-3">
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
              {["GET","POST","PATCH","PUT","DELETE"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <input value={route} onChange={(e) => setRoute(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500"
              placeholder="/auth/login" />
          </div>

          <input value={userId} onChange={(e) => setUserId(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500"
            placeholder="x-user-id (optional — enables per-user rate limiting)" />

          {!["GET","HEAD"].includes(method) && (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder='{"key": "value"}' />
          )}

          {/* Buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={fire} disabled={firing}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              Fire Request
            </button>

            <div className="flex items-center gap-2">
              <button onClick={fireBurst} disabled={firing}
                className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                Fire {burstCount}×
              </button>
              <input type="number" value={burstCount} min={1} max={50}
                onChange={(e) => setBurstCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-sm text-slate-200 text-center focus:outline-none focus:border-blue-500" />
            </div>

            {firing && (
              <button onClick={() => { abortRef.current = true; setFiring(false); }}
                className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors">
                Stop
              </button>
            )}
            {results.length > 0 && (
              <button onClick={() => setResults([])}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Quota bar */}
        {latest && limit > 0 && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
            <h3 className="text-sm font-medium text-slate-300">Rate Limit Quota</h3>
            <QuotaBar used={used} limit={limit} />
            {latest.headers.reset && (
              <div className="text-xs text-slate-500">
                Resets at {new Date(parseInt(latest.headers.reset) * 1000).toLocaleTimeString()}
                {latest.headers.retryAfter && (
                  <span className="ml-2 text-red-400">· retry after {latest.headers.retryAfter}s</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: response log ── */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-300">Response Log</h3>
          <span className="text-xs text-slate-500">{results.length} request{results.length !== 1 ? "s" : ""}</span>
        </div>

        {results.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-600 text-sm">
            Fire a request to see responses here
          </div>
        ) : (
          <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
            {results.map((r, i) => (
              <div key={i}
                className={`rounded-lg border p-4 text-sm ${
                  r.status === 429 ? "border-red-500/30 bg-red-500/5" :
                  r.ok             ? "border-green-500/30 bg-green-500/5" :
                                     "border-yellow-500/30 bg-yellow-500/5"
                }`}>

                {/* Status row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold font-mono ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-slate-400 font-mono text-xs">{r.method} {r.route}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">{r.duration}ms</span>
                    {r.status === 429 ? <Badge label="BLOCKED" variant="red" /> :
                     r.ok             ? <Badge label="ALLOWED" variant="green" /> :
                                        <Badge label="ERROR"   variant="yellow" />}
                  </div>
                </div>

                {/* Rate-limit headers */}
                {r.headers.limit && (
                  <div className="flex flex-wrap gap-3 mb-2">
                    <span className="text-xs font-mono text-slate-500">
                      limit: <span className="text-slate-300">{r.headers.limit}</span>
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      remaining: <span className={parseInt(r.headers.remaining) === 0 ? "text-red-400" : "text-slate-300"}>
                        {r.headers.remaining}
                      </span>
                    </span>
                    {r.headers.retryAfter && (
                      <span className="text-xs font-mono text-red-400">retry-after: {r.headers.retryAfter}s</span>
                    )}
                  </div>
                )}

                {/* Response body */}
                <pre className="text-xs text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(r.data, null, 2)}
                </pre>

                <div className="text-xs text-slate-600 mt-2">
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
