export function configuredAiKey(): string | undefined {
  try {
    const config = useRuntimeConfig();
    return config.hackclubAiKey as string | undefined;
  } catch {
    return undefined;
  }
}
