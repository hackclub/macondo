// Tab titles for pages that set none; pages with their own title are left unmapped so theirs wins.
export default defineNuxtPlugin(() => {
  const route = useRoute();

  const TITLES: Array<[RegExp, string]> = [
    [/^\/dashboard\b/, "Dashboard"],
    [/^\/shop\b/, "Shop"],
    [/^\/profile\b/, "Profile"],
    [/^\/achievements\b/, "Achievements"],
    [/^\/notifications\b/, "Notifications"],
    [/^\/explore\b/, "Explore"],
    [/^\/leaderboard\b/, "Leaderboard"],
    [/^\/ideas\b/, "Idea Box"],
    [/^\/projects\//, "Project"],
    [/^\/currency\b/, "Currency"],
    [/^\/exchange\b/, "Currency"],
    [/^\/support\b/, "Support"],
    [/^\/settings\b/, "Settings"],
    [/^\/u\//, "Profile"],
  ];

  function titleFor(path: string): string | undefined {
    for (const [re, label] of TITLES) {
      if (re.test(path)) return `${label} · Macondo`;
    }
    return undefined;
  }

  useHead({
    title: () => titleFor(route.path),
  });
});
