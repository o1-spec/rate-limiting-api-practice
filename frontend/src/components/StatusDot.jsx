export default function StatusDot({ status, size = "sm" }) {
  const dot =
    status === "healthy"  ? "bg-green-400"  :
    status === "degraded" ? "bg-yellow-400" :
    "bg-red-400";
  const ring =
    status === "healthy"  ? "ring-green-400/30"  :
    status === "degraded" ? "ring-yellow-400/30" :
    "ring-red-400/30";
  const sz = size === "lg" ? "w-3 h-3" : "w-2 h-2";
  return (
    <span className={`inline-block ${sz} rounded-full ring-4 ${ring} ${dot} animate-pulse`} />
  );
}
