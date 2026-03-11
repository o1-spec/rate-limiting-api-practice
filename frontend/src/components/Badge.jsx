export default function Badge({ label, variant = "default" }) {
  const styles = {
    default:  "bg-slate-700/80 text-slate-300 border border-slate-600/50",
    green:    "bg-green-500/15 text-green-400 border border-green-500/30",
    red:      "bg-red-500/15 text-red-400 border border-red-500/30",
    blue:     "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    yellow:   "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
    sliding:  "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30",
    token:    "bg-orange-500/15 text-orange-400 border border-orange-500/30",
    fixed:    "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md tracking-wide ${styles[variant] ?? styles.default}`}>
      {label}
    </span>
  );
}
