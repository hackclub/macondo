import { nightBlendForHour, localHourInZone, lerpHex } from "~/utils/nightBlend";

export type NightModeChoice = "day" | "auto" | "night";

const STORAGE_KEY = "macondo_night_mode";

// So the minute ticker is set up once app-wide, however many components call this.
let bootstrapped = false;

export function useNightMode() {
  const { user } = useAuth();
  const mode = useState<NightModeChoice>("night_mode", () => "auto");
  // Blend reports day until this flips after mount, so SSR and hydration agree.
  const ready = useState<boolean>("night_mode_ready", () => false);
  // Coarse clock; bumped once a minute so Auto transitions live.
  const now = useState<number>("night_mode_now", () => 0);

  const blend = computed(() => {
    if (!ready.value) return 0;
    if (mode.value === "day") return 0;
    if (mode.value === "night") return 1;
    return nightBlendForHour(localHourInZone(new Date(now.value || Date.now()), user.value?.timezone ?? undefined));
  });

  const navbarBg = computed(() => lerpHex("#684D3A", "#241A38", blend.value));

  function setMode(next: NightModeChoice) {
    mode.value = next;
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage can be blocked (private mode); the in-memory choice still works.
      }
    }
  }

  if (import.meta.client) {
    // onMounted, not rAF (paused in background tabs); it runs after hydration so
    // the first client render still matches SSR.
    onMounted(() => {
      if (ready.value) return;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "day" || saved === "auto" || saved === "night") mode.value = saved;
      } catch {
        // Ignore unreadable storage; default stays "auto".
      }
      now.value = Date.now();
      ready.value = true;
    });

    if (!bootstrapped) {
      bootstrapped = true;
      window.setInterval(() => {
        if (document.visibilityState === "visible") now.value = Date.now();
      }, 60_000); // refresh the clock once a minute
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") now.value = Date.now();
      });
    }
  }

  return { mode, setMode, blend, navbarBg };
}
