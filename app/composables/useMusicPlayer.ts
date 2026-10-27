// The audio element is module-scoped so playback survives route changes.
// See public/music/README.md to add or replace tracks.

export interface MusicTrack {
  src: string;
  title: string;
  artist: string;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { src: "/music/Mixdown.mp3", title: "Mixdown", artist: "Sojo" },
];

const VOLUME_KEY = "macondo-music-volume";
const WANTS_KEY = "macondo-music-wants";
const INDEX_KEY = "macondo-music-index";

let audioEl: HTMLAudioElement | null = null;
let prefsLoaded = false;
let autoplayArmed = false;
let flagFetched = false;

export const useMusicPlayer = () => {
  const trackIndex = useState<number>("music_track_index", () => 0);
  const isPlaying = useState<boolean>("music_is_playing", () => false);
  const volume = useState<number>("music_volume", () => 0.5);
  const isMuted = useState<boolean>("music_is_muted", () => false);
  const currentTime = useState<number>("music_current_time", () => 0);
  const duration = useState<number>("music_duration", () => 0);
  const wantsPlayback = useState<boolean>("music_wants_playback", () => false);
  // current track is missing or can't be decoded
  const unavailable = useState<boolean>("music_unavailable", () => false);
  const enabled = useState<boolean>("music_enabled_flag", () => false);

  const currentTrack = computed(
    () => MUSIC_TRACKS[trackIndex.value] ?? MUSIC_TRACKS[0],
  );

  function persist(key: string, value: string): void {
    if (!import.meta.client) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage may be unavailable (private mode, quota). Non-fatal.
    }
  }

  function readPref(key: string): string | null {
    if (!import.meta.client) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function loadPrefs(): void {
    if (prefsLoaded || !import.meta.client) return;
    prefsLoaded = true;

    const storedVolume = readPref(VOLUME_KEY);
    if (storedVolume !== null) {
      const n = Number(storedVolume);
      if (Number.isFinite(n)) volume.value = Math.min(1, Math.max(0, n));
    }

    const storedIndex = readPref(INDEX_KEY);
    if (storedIndex !== null) {
      const n = Number(storedIndex);
      if (Number.isInteger(n) && n >= 0 && n < MUSIC_TRACKS.length) {
        trackIndex.value = n;
      }
    }

    const storedWants = readPref(WANTS_KEY);
    if (storedWants !== null) wantsPlayback.value = storedWants === "true";
  }

  function ensureAudio(): HTMLAudioElement | null {
    if (!import.meta.client) return null;
    if (audioEl) return audioEl;

    const el = new Audio();
    // Don't fetch the 2.5MB file on every dashboard mount, only on play.
    el.preload = "none";
    el.src = currentTrack.value.src;
    el.volume = isMuted.value ? 0 : volume.value;

    el.addEventListener("loadedmetadata", () => {
      duration.value = Number.isFinite(el.duration) ? el.duration : 0;
    });
    el.addEventListener("durationchange", () => {
      duration.value = Number.isFinite(el.duration) ? el.duration : 0;
    });
    el.addEventListener("timeupdate", () => {
      currentTime.value = el.currentTime;
    });
    el.addEventListener("play", () => {
      isPlaying.value = true;
      unavailable.value = false;
    });
    el.addEventListener("pause", () => {
      isPlaying.value = false;
    });
    el.addEventListener("ended", () => {
      next();
    });
    el.addEventListener("error", () => {
      unavailable.value = true;
      isPlaying.value = false;
    });

    audioEl = el;
    return audioEl;
  }

  // Browsers block play() until the user interacts, so retry on the first gesture.
  function armAutoplay(): void {
    if (!import.meta.client || autoplayArmed) return;
    autoplayArmed = true;
    const events = ["pointerdown", "keydown", "touchend"];
    const handler = (): void => {
      events.forEach((e) => document.removeEventListener(e, handler));
      autoplayArmed = false;
      if (wantsPlayback.value) void play();
    };
    events.forEach((e) =>
      document.addEventListener(e, handler, { passive: true }),
    );
  }

  async function play(): Promise<void> {
    const el = ensureAudio();
    if (!el) return;
    if (!el.src) el.src = currentTrack.value.src;
    el.volume = isMuted.value ? 0 : volume.value;
    wantsPlayback.value = true;
    persist(WANTS_KEY, "true");
    try {
      await el.play();
    } catch (err) {
      // NotAllowedError is the autoplay block; anything else means the file won't play.
      if ((err as DOMException)?.name === "NotAllowedError") {
        armAutoplay();
      } else {
        unavailable.value = true;
      }
    }
  }

  function pause(): void {
    wantsPlayback.value = false;
    persist(WANTS_KEY, "false");
    audioEl?.pause();
  }

  function toggle(): void {
    if (isPlaying.value) pause();
    else void play();
  }

  function loadTrack(autoplay: boolean): void {
    const el = ensureAudio();
    if (!el) return;
    unavailable.value = false;
    el.src = currentTrack.value.src;
    currentTime.value = 0;
    duration.value = 0;
    persist(INDEX_KEY, String(trackIndex.value));
    if (autoplay) void play();
  }

  function next(): void {
    trackIndex.value = (trackIndex.value + 1) % MUSIC_TRACKS.length;
    loadTrack(wantsPlayback.value || isPlaying.value);
  }

  function prev(): void {
    trackIndex.value =
      (trackIndex.value - 1 + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    loadTrack(wantsPlayback.value || isPlaying.value);
  }

  function seek(seconds: number): void {
    const el = ensureAudio();
    if (!el || !Number.isFinite(seconds)) return;
    el.currentTime = seconds;
    currentTime.value = seconds;
  }

  function setVolume(value: number): void {
    const v = Math.min(1, Math.max(0, value));
    volume.value = v;
    if (v > 0) isMuted.value = false;
    if (audioEl) audioEl.volume = isMuted.value ? 0 : v;
    persist(VOLUME_KEY, String(v));
  }

  function toggleMute(): void {
    isMuted.value = !isMuted.value;
    if (audioEl) audioEl.volume = isMuted.value ? 0 : volume.value;
  }

  async function fetchEnabled(): Promise<void> {
    if (flagFetched || !import.meta.client) return;
    flagFetched = true;
    try {
      enabled.value = (await $fetch<{ enabled: boolean }>("/api/music/enabled")).enabled === true;
      if (!enabled.value) pause();
    } catch {
      // Keep the default on a transient failure.
    }
  }

  // Never auto-starts playback: the first play() comes from a user click (autoplay policy).
  function init(): void {
    if (!import.meta.client) return;
    loadPrefs();
    ensureAudio();
    void fetchEnabled();
  }

  return {
    MUSIC_TRACKS,
    trackIndex,
    isPlaying,
    volume,
    isMuted,
    currentTime,
    duration,
    wantsPlayback,
    unavailable,
    enabled,
    currentTrack,
    init,
    play,
    pause,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
  };
};
