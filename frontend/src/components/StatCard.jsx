export default function StatCard({ label, value, sub, color = "blue", icon }) {
  const border = {
    blue:   "border-blue-500/30 bg-blue-500/5",
    green:  "border-green-500/30 bg-green-500/5",
    red:    "border-red-500/30 bg-red-500/5",
    yellow: "border-yellow-500/30 bg-yellow-500/5",
  };
  const text = {
    blue:   "text-blue-400",
    green:  "text-green-400",
    red:    "text-red-400",
    yellow: "text-yellow-400",
  };

  return (
    <div className={`rounded-xl border p-5 ${border[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className={`text-3xl font-bold ${text[color]}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
