export const DEV_FAKE_HACKATIME_TOKEN = "macondo-dev-fake-hackatime-token";
export const DEV_FAKE_HACKATIME_USER_ID = 42424242;

const FAKE_PROJECTS = [
  {
    name: "macondo-dev-app",
    lifetimeSeconds: 33 * 3600,
    windowSeconds: 9 * 3600 + 24 * 60,
    todaySeconds: 2 * 3600 + 12 * 60,
    languages: ["TypeScript", "Vue", "CSS"],
    repo: "https://github.com/hackclub/macondo-dev-app",
  },
  {
    name: "macondo-dev-api",
    lifetimeSeconds: 21 * 3600 + 30 * 60,
    windowSeconds: 5 * 3600 + 42 * 60,
    todaySeconds: 56 * 60,
    languages: ["TypeScript", "SQL"],
    repo: "https://github.com/hackclub/macondo-dev-api",
  },
  {
    name: "macondo-dev-cad",
    lifetimeSeconds: 14 * 3600 + 15 * 60,
    windowSeconds: 3 * 3600 + 36 * 60,
    todaySeconds: 38 * 60,
    languages: ["CAD", "Markdown"],
    repo: "https://cad.onshape.com/documents/macondo-dev-cad",
  },
] as const;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dayMs(day: string) {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function secondsForStartDate(
  project: (typeof FAKE_PROJECTS)[number],
  startDate?: string,
) {
  if (!startDate) return project.lifetimeSeconds;

  const startMs = dayMs(startDate);
  const todayMs = dayMs(todayKey());
  if (startMs == null || todayMs == null) return project.windowSeconds;
  if (startMs > todayMs) return 0;

  const days = Math.max(1, Math.floor((todayMs - startMs) / 86_400_000) + 1);
  const secondsPerOlderDay = Math.max(
    12 * 60,
    Math.floor((project.windowSeconds - project.todaySeconds) / 18),
  );
  return Math.min(
    project.windowSeconds,
    project.todaySeconds + Math.max(0, days - 1) * secondsPerOlderDay,
  );
}

export function isDevFakeHackatimeToken(accessToken: string | null | undefined) {
  return accessToken === DEV_FAKE_HACKATIME_TOKEN;
}

export function getFakeHackatimeProjects(options?: { startDate?: string }) {
  const now = new Date().toISOString();
  return {
    projects: FAKE_PROJECTS.map((project) => ({
      name: project.name,
      total_seconds: secondsForStartDate(project, options?.startDate),
      most_recent_heartbeat: now,
      languages: [...project.languages],
      archived: false,
    })),
  };
}

export function getFakeHackatimeHours(options?: { startDate?: string }) {
  const projects = getFakeHackatimeProjects(options).projects;
  return {
    start_date: options?.startDate ?? "2026-04-15",
    end_date: todayKey(),
    total_seconds: projects.reduce(
      (sum, project) => sum + project.total_seconds,
      0,
    ),
  };
}

export function getFakeHackatimeMe() {
  return {
    id: DEV_FAKE_HACKATIME_USER_ID,
    emails: ["dev-hackatime@example.com"],
    slack_id: "UDEVHACKATIME",
    github_username: "macondo-dev",
  };
}

export function getFakeLatestHeartbeat() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    id: 9000001,
    created_at: new Date(nowSeconds * 1000).toISOString(),
    time: nowSeconds,
    category: "coding",
    project: FAKE_PROJECTS[0].name,
    language: "TypeScript",
    editor: "VS Code",
    operating_system: "macOS",
    machine: "dev-laptop",
    entity: "/Users/dev/macondo-dev-app/app/pages/dashboard.vue",
  };
}
