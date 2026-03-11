const styles = {
  blue:   { border: "border-blue-500/20", bg: "bg-blue-500/5",   icon: "bg-blue-500/15 text-blue-400",   value: "text-blue-400"   },
  green:  { border: "border-green-500/20", bg: "bg-green-500/5",  icon: "bg-green-500/15 text-green-400",  value: "text-green-400"  },
  red:    { border: "border-red-500/20",   bg: "bg-red-500/5",    icon: "bg-red-500/15 text-red-400",      value: "text-red-400"    },
  yellow: { border: "border-yellow-500/20",bg: "bg-yellow-500/5", icon: "bg-yellow-500/15 text-yellow-400",value: "text-yellow-400" },
};

export default function StatCard({ label, value, sub, color = "blue", icon: Icon }) {
  const s = styles[color] ?? styles.blue;
  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-5`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider leading-tight">{label}</span>
        {Icon && (
          <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.icon}`}>
            <Icon size={16} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className={`text-3xl font-bold tabular-nums ${s.value}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
