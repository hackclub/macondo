// never log a raw token; call sites pass tail4() of any secret

export function tail4(secret: string | null | undefined): string {
  if (!secret) return "(none)";
  return `…${secret.slice(-4)}`;
}

export function mlog(
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[mcp:${scope}] ${message}${suffix}`);
}
