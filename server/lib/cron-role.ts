// The event is closed: background jobs and external syncs are off by default.
// Only an explicit worker deployment should run the scheduled jobs.
export function shouldRunCronPlugins(): boolean {
  return (process.env.MACONDO_ROLE ?? "").trim().toLowerCase() === "worker";
}
