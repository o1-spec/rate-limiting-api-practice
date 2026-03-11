export default function StatusDot({ status }) {
  const color =
    status === "healthy" ? "bg-green-400 shadow-green-400/50" :
    status === "degraded" ? "bg-yellow-400 shadow-yellow-400/50" :
    "bg-red-400 shadow-red-400/50";
  return (
    <span className={`inline-block w-2 h-2 rounded-full shadow-lg animate-pulse ${color}`} />
  );
}
