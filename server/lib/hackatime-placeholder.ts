// Hackatime files project-less heartbeats under `<<LAST_PROJECT>>`, so that time is unattributable.
// Kept dependency-free so tests can import it without module mocks.

// Case-insensitive to mirror ARI's check.
export function isHackatimePlaceholderProjectName(name: string): boolean {
  return name.trim().toUpperCase() === "<<LAST_PROJECT>>";
}

// Applied in getAuthenticatedProjects so every hour consumer skips it, even for already-linked projects.
export function stripHackatimePlaceholderProjects<T extends { name: string }>(
  projects: readonly T[] | null | undefined,
): T[] {
  return (projects ?? []).filter(
    (p) => !isHackatimePlaceholderProjectName(p?.name ?? ""),
  );
}
