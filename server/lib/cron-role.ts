// The single production web instance also owns scheduled jobs and external syncs.
// MACONDO_ROLE is no longer required; development and test processes stay idle.
export function shouldRunCronPlugins(): boolean {
  return process.env.NODE_ENV === "production";
}
