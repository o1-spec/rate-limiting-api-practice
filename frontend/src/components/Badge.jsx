export default function Badge({ label, variant = "default" }) {
  const styles = {
    default:  "bg-slate-700 text-slate-300",
    green:    "bg-green-500/20 text-green-400 border border-green-500/30",
    red:      "bg-red-500/20 text-red-400 border border-red-500/30",
    blue:     "bg-blue-500/20 text-blue-400 border border-blue-500/30",
    yellow:   "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    sliding:  "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30",
    token:    "bg-orange-500/20 text-orange-400 border border-orange-500/30",
    fixed:    "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[variant] ?? styles.default}`}>
      {label}
    </span>
  );
}
