export const getHealth = (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "rate-limited-api-backend",
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
};
