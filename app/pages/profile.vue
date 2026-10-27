<script setup lang="ts">
import { AlertTriangle, Award, ChevronDown, KeyRound, Lock, RotateCw, UserCheck, Users } from "lucide-vue-next";
import { useFocusTrap } from "~/composables/useFocusTrap";
import { useModalAnimation } from "~/composables/useModalAnimation";
import StreakCalendar from "~/components/StreakCalendar.vue";
import StreakTrends from "~/components/StreakTrends.vue";

definePageMeta({
    layout: false,
});

const { user, isLoggedIn, loading, signOut, fetchSession } = useAuth();

interface ProjectStreakRow {
  id: number;
  name: string | null;
  project_streak_days: number;
  last_worked_date: string | null;
  worked_today: boolean;
  auto_use_streak_freezes: boolean;
}
interface ProjectStreaksResponse {
  current_streak: number;
  streak_freezes_remaining: number;
  worked_today: boolean;
  today_seconds_logged: number;
  daily_goal_seconds: number;
  projects: ProjectStreakRow[];
}
// getCachedData paints last known data while refreshing; lazy keeps the first open from blocking Suspense.
const { data: streaksData, status: streaksStatus } = useLazyFetch<ProjectStreaksResponse>(
    "/api/profile/streaks",
    {
        key: "profile-streaks",
        default: () => ({ current_streak: 0, streak_freezes_remaining: 0, worked_today: false, today_seconds_logged: 0, daily_goal_seconds: 3600, projects: [] }),
        getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
    },
);
// the empty default payload looks like real zeros while pending or errored, so gate the section on status.
const streaksLoading = computed(() => streaksStatus.value === "pending");
const streaksErrored = computed(() => streaksStatus.value === "error");
const streakFreezes = computed(() => streaksData.value?.streak_freezes_remaining ?? 0);
const workedToday = computed(() => streaksData.value?.worked_today ?? false);
const projectStreaks = computed(() => streaksData.value?.projects ?? []);
// same uncached source as the HUD; the 30s-cached streaks payload lagged it right after a sync.
const currentStreak = computed(
    () => user.value?.longest_current_streak ?? streaksData.value?.current_streak ?? 0,
);
const calendarOpen = ref(false);
const trendsOpen = ref(true);
const tiersOpen = ref(false);

const todaySeconds = computed(() => streaksData.value?.today_seconds_logged ?? 0);
const dailyGoalSeconds = computed(() => streaksData.value?.daily_goal_seconds ?? 3600);
const todayMinutes = computed(() => Math.floor(todaySeconds.value / 60));
const goalMinutes = computed(() => Math.round(dailyGoalSeconds.value / 60));
const todayProgress = computed(() =>
    dailyGoalSeconds.value > 0 ? Math.min(1, todaySeconds.value / dailyGoalSeconds.value) : 1,
);
const minutesLeft = computed(() => Math.max(0, goalMinutes.value - todayMinutes.value));

// manual refresh, since the hackatime sync cron only runs every 24 hours.
const streakCalendarRef = ref<{ refresh: () => Promise<void> } | null>(null);
const refreshingStreaks = ref(false);

const fruitIcons = [
    "/images/fruits/avocado/icon_exterior.webp",
    "/images/fruits/mango/icon.webp",
    "/images/fruits/papaya/icon_exterior.webp",
    "/images/fruits/guava/icon_exterior.webp",
    "/images/fruits/pineapple/icon.webp",
    "/images/fruits/cocoa/icon_exterior.webp",
    "/images/fruits/coco/icon_exterior.webp",
];

// filled after mount: random positions during SSR cause hydration mismatches that freeze <Transition>.
const scatteredFruits = ref<Array<{
    src: string;
    top: string;
    left: string;
    rotation: number;
    size: number;
}>>([]);

onMounted(() => {
    scatteredFruits.value = Array.from({ length: 15 }, (_, i) => ({
        src: fruitIcons[i % fruitIcons.length]!,
        top: `${Math.random() * 90 + 2}%`,
        left: `${Math.random() * 90 + 2}%`,
        rotation: Math.random() * 360,
        size: 24 + Math.random() * 20,
    }));
    void loadNotifPrefs();
    // Nuxt's scrollBehavior fires before async data settles; the timeouts run after any router scroll.
    const hash = window.location.hash;
    if (hash) {
        const target = () => document.querySelector(hash);
        const scroll = () => target()?.scrollIntoView({ behavior: "smooth", block: "start" });
        void nextTick(scroll);
        setTimeout(scroll, 50);
        setTimeout(scroll, 250);
    }
});

function handleLogout() {
    void signOut();
}

if (import.meta.client) {
    watch(
        [isLoggedIn, loading],
        ([loggedIn, isLoading]) => {
            if (!isLoading && !loggedIn) navigateTo("/");
        },
        { immediate: true },
    );
}

const props = defineProps<{
  embeddedWindowed?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const isWindowed = computed(() => props.embeddedWindowed || route.query.windowed === '1');

function closeModal() {
  if (props.embeddedWindowed) {
    emit('close');
  } else if (import.meta.client) {
    window.parent.postMessage({ type: 'close-modal' }, '*');
  }
}

const { data: projects } = useLazyFetch<Record<string, unknown>[]>("/api/projects", {
    key: "profile-projects",
    default: () => [],
    getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
});

interface PendingGoldProject {
    project_id: number;
    project_name: string | null;
    project_thumbnail_url: string | null;
    total_gold: number;
}

const { data: pendingGold } = useLazyFetch<{ projects: PendingGoldProject[] }>(
    "/api/users/fruits/pending",
    {
        key: "profile-pending-gold",
        default: () => ({ projects: [] }),
        getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
    },
);

interface CertificateProgress {
    eligible_hours: number;
    threshold: number;
    remaining: number;
    event_invite_purchased: boolean;
    has_certificate: boolean;
    eligible: boolean;
    code: string | null;
}
const { data: certProgress } = useLazyFetch<CertificateProgress>(
    "/api/profile/certificate",
    {
        key: "profile-certificate",
        default: () => ({
            eligible_hours: 0,
            threshold: 20,
            remaining: 20,
            event_invite_purchased: false,
            has_certificate: false,
            eligible: false,
            code: null,
        }),
        getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
    },
);
const certProgressPct = computed(() => {
    const c = certProgress.value;
    if (!c || !c.threshold) return 0;
    return Math.min(100, Math.round((c.eligible_hours / c.threshold) * 100));
});

// MAX of own journal and hackatime hours per project, never the sum, so a session isn't counted twice.
const totalHours = computed(() => {
    let sum = 0;
    for (const p of projects.value) {
        const row = p as {
            journals_hours_sum?: number | string | null;
            hackatime_hours_sum?: number | string | null;
        };
        const journal = Number(row.journals_hours_sum ?? 0);
        const hackatime = Number(row.hackatime_hours_sum ?? 0);
        sum += Math.max(
            Number.isFinite(journal) ? journal : 0,
            Number.isFinite(hackatime) ? hackatime : 0,
        );
    }
    return Math.round(sum * 10) / 10;
});

const memberSince = computed(() => {
    if (!user.value?.created_at) return "";
    return new Date(user.value.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" });
});

function linkHackatime() {
    const url = "/api/auth/hackatime/login?return_to=/profile";
    if (isWindowed.value) {
        window.location.href = url;
    } else {
        window.location.href = url;
    }
}

function linkHackClub() {
    const url = "/api/auth/login?return_to=/profile";
    if (isWindowed.value) {
        window.location.href = url;
    } else {
        window.location.href = url;
    }
}

const unlinking = ref("");
const { showAlert, showConfirm } = useAlertDialog();
const { t, te, locale } = useI18n();

function translateTierTitle(tier: { tier: number; title: string }): string {
  const key = `profile.referrals.tiers.${tier.tier}`;
  return te(key) ? t(key) : tier.title;
}

const providerLabels: Record<string, string> = {
    hackclub: "Hack Club Auth",
    hackatime: "Hackatime",
    github: "GitHub",
};

async function unlinkProvider(provider: string) {
    const label = providerLabels[provider] ?? provider;
    if (!(await showConfirm({
        title: t("profile.unlink_confirm_title", { provider: label }),
        message: t("profile.unlink_confirm_message", { provider: label }),
        confirmLabel: t("profile.unlink"),
        tone: "warning",
        destructive: true,
    }))) return;
    unlinking.value = provider;
    try {
        await $fetch("/api/auth/unlink", { method: "POST", body: { provider } });
        await fetchSession();
    } catch (e: unknown) {
        await showAlert({ tone: "error", message: (e as { data?: { statusMessage?: string } })?.data?.statusMessage || "Failed to unlink" });
    } finally {
        unlinking.value = "";
    }
}

function linkGithub() {
    const url = "/api/auth/github/login?return_to=/profile";
    if (isWindowed.value) {
        window.location.href = url;
    } else {
        window.location.href = url;
    }
}

interface ReferralTierView {
    tier: number;
    requiredCount: number;
    title: string;
    goldAmount: number;
    rewardSummary: string;
    claimed: boolean;
    unlocked: boolean;
}
interface ReferralPayload {
    code: string;
    validReferralCount: number;
    pendingReferralCount: number;
    tiers: ReferralTierView[];
}

const { data: referral, refresh: refreshReferral } = useLazyFetch<ReferralPayload>(
    "/api/referrals/me",
    {
        key: "profile-referral",
        default: () => null,
        getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
    },
);

const referralShareUrl = computed(() => {
    if (!referral.value?.code) return "";
    if (import.meta.client) {
        return `${window.location.origin}/?ref=${referral.value.code}`;
    }
    return `/?ref=${referral.value.code}`;
});

const copyState = ref<"idle" | "copied">("idle");
async function copyReferralLink() {
    if (!referralShareUrl.value) return;
    try {
        await navigator.clipboard.writeText(referralShareUrl.value);
        copyState.value = "copied";
        setTimeout(() => { copyState.value = "idle"; }, 1500);
    } catch {
        await showAlert({ tone: "error", message: "Could not copy to clipboard" });
    }
}

const redeemingTier = ref<number | null>(null);
async function redeemTier(tierNum: number) {
    redeemingTier.value = tierNum;
    try {
        const res = await $fetch<{ ok: boolean; rewardSummary: string }>(
            "/api/referrals/redeem",
            { method: "POST", body: { tier: tierNum } },
        );
        await Promise.all([refreshReferral(), fetchSession()]);
        await showAlert({
            tone: "success",
            message: `Redeemed: ${res.rewardSummary}`,
        });
    } catch (e: unknown) {
        await showAlert({
            tone: "error",
            message: (e as { data?: { statusMessage?: string } })?.data?.statusMessage || "Failed to redeem",
        });
    } finally {
        redeemingTier.value = null;
    }
}

// people farmed tiers by cold-DMing strangers, so the code stays behind a one-time disclosure.
const REFERRAL_DISCLOSURE_KEY = "referral_disclosure_acked_v1";
const REFERRAL_DISCLOSURE_WAIT_SECONDS = 5;
const referralDisclosureAcked = ref(false);
const showDisclosureModal = ref(false);
const disclosureChecked = ref(false);
const disclosureSecondsRemaining = ref(REFERRAL_DISCLOSURE_WAIT_SECONDS);
const disclosureDialogEl = ref<HTMLElement | null>(null);
let disclosureTimer: ReturnType<typeof setInterval> | null = null;
const { onBackdropEnter: onDisclosureBackdropEnter, onBackdropLeave: onDisclosureBackdropLeave, onPanelEnter: onDisclosurePanelEnter, onPanelLeave: onDisclosurePanelLeave } = useModalAnimation();
useFocusTrap(() => showDisclosureModal.value, disclosureDialogEl);

onMounted(() => {
    if (import.meta.client) {
        try {
            referralDisclosureAcked.value =
                localStorage.getItem(REFERRAL_DISCLOSURE_KEY) === "1";
        } catch {
            referralDisclosureAcked.value = false;
        }
    }
});

function openDisclosureModal() {
    disclosureChecked.value = false;
    disclosureSecondsRemaining.value = REFERRAL_DISCLOSURE_WAIT_SECONDS;
    showDisclosureModal.value = true;
    if (disclosureTimer) clearInterval(disclosureTimer);
    disclosureTimer = setInterval(() => {
        if (disclosureSecondsRemaining.value > 0) {
            disclosureSecondsRemaining.value -= 1;
        }
        if (disclosureSecondsRemaining.value <= 0 && disclosureTimer) {
            clearInterval(disclosureTimer);
            disclosureTimer = null;
        }
    }, 1000);
}

function closeDisclosureModal() {
    showDisclosureModal.value = false;
    if (disclosureTimer) {
        clearInterval(disclosureTimer);
        disclosureTimer = null;
    }
}

function confirmDisclosure() {
    if (!disclosureChecked.value || disclosureSecondsRemaining.value > 0) return;
    if (import.meta.client) {
        try {
            localStorage.setItem(REFERRAL_DISCLOSURE_KEY, "1");
        } catch {
            // Private mode / quota — still let them see the code this session.
        }
    }
    referralDisclosureAcked.value = true;
    closeDisclosureModal();
}

onBeforeUnmount(() => {
    if (disclosureTimer) {
        clearInterval(disclosureTimer);
        disclosureTimer = null;
    }
});

type NotifChannel = "slack" | "email";
type NotifCategory = "ship_decisions" | "payouts" | "tickets" | "events";
type NotifPrefs = Record<NotifCategory, Record<NotifChannel, boolean>>;

const NOTIF_CATEGORIES: NotifCategory[] = ["ship_decisions", "payouts", "tickets", "events"];
const NOTIF_DEFAULT: NotifPrefs = {
    ship_decisions: { slack: true, email: true },
    payouts: { slack: true, email: true },
    tickets: { slack: true, email: true },
    events: { slack: true, email: true },
};

const notifPrefs = ref<NotifPrefs>(structuredClone(NOTIF_DEFAULT));
const savingNotifs = ref(false);
const notifsSavedAt = ref<number | null>(null);

// last server-confirmed prefs; Save only shows when the live state diverges.
const savedNotifPrefsSnapshot = ref<NotifPrefs | null>(null);
const notifPrefsDirty = computed(() => {
    if (!savedNotifPrefsSnapshot.value) return false;
    return JSON.stringify(notifPrefs.value) !== JSON.stringify(savedNotifPrefsSnapshot.value);
});

let savedToastTimer: ReturnType<typeof setTimeout> | null = null;

async function loadNotifPrefs(): Promise<void> {
    try {
        const res = await $fetch<{ preferences: Partial<Record<NotifCategory, Partial<Record<string, boolean>>>> }>(
            "/api/notifications/preferences",
        );
        const merged = structuredClone(NOTIF_DEFAULT);
        for (const cat of NOTIF_CATEGORIES) {
            const fromServer = res.preferences?.[cat];
            if (!fromServer) continue;
            for (const ch of ["slack", "email"] as NotifChannel[]) {
                if (typeof fromServer[ch] === "boolean") {
                    merged[cat][ch] = fromServer[ch] as boolean;
                }
            }
        }
        notifPrefs.value = merged;
        savedNotifPrefsSnapshot.value = structuredClone(merged);
    } catch (err) {
        console.error("[profile notif prefs] load failed", err);
    }
}

async function saveNotifPrefs(): Promise<void> {
    savingNotifs.value = true;
    try {
        await $fetch("/api/notifications/preferences", {
            method: "PATCH",
            body: { preferences: notifPrefs.value },
        });
        // JSON round-trip: no shared references, and structuredClone throws on Vue proxies.
        savedNotifPrefsSnapshot.value = JSON.parse(JSON.stringify(notifPrefs.value));
        notifsSavedAt.value = Date.now();
        if (savedToastTimer) clearTimeout(savedToastTimer);
        savedToastTimer = setTimeout(() => {
            notifsSavedAt.value = null;
        }, 2500);
    } catch (err) {
        console.error("[profile notif prefs] save failed", err);
        await showAlert({ tone: "error", message: t("profile.notifications.save_failed") });
    } finally {
        savingNotifs.value = false;
    }
}

// the stored N (reminder_hours_before_day_end) fires at local hour 24 - N; the picker uses local hours.
const streakReminderEnabled = ref<boolean>(true);
const reminderLocalHours = ref<number[]>([20]);
const reminderSaving = ref(false);

// out-of-range or missing legacy values fall back to the 8 PM default.
function reminderHourFromN(n: number | null | undefined): number {
    const N = Math.floor(n ?? 4);
    if (!Number.isFinite(N) || N < 1 || N > 23) return 20;
    return 24 - N;
}

function formatClockHour(h: number): string {
    return new Intl.DateTimeFormat(locale.value, {
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(2000, 0, 1, h, 0, 0)); // arbitrary date, only the hour matters
}

// midnight is the day boundary itself, so it is excluded.
const reminderHourOptions = computed(() =>
    Array.from({ length: 23 }, (_, i) => i + 1).map((h) => ({
        value: h,
        label: formatClockHour(h),
    })),
);

const reminderTimesLabel = computed(() =>
    [...reminderLocalHours.value]
        .sort((a, b) => a - b)
        .map(formatClockHour)
        .join(", "),
);

watch(
    () => user.value?.streak_slack_notifications,
    (v) => {
        if (typeof v === "boolean") streakReminderEnabled.value = v;
    },
    { immediate: true },
);
// legacy single-field fallback for sessions that predate the multi-time column.
watch(
    () =>
        [
            user.value?.reminder_local_hours,
            user.value?.reminder_hours_before_day_end,
        ] as const,
    ([arr, single]) => {
        reminderLocalHours.value =
            Array.isArray(arr) && arr.length > 0
                ? [...arr].sort((a, b) => a - b)
                : [reminderHourFromN(single)];
    },
    { immediate: true },
);

async function saveStreakReminder(): Promise<void> {
    if (reminderSaving.value) return;
    // The endpoint requires at least one time; never PATCH an empty set.
    if (reminderLocalHours.value.length === 0) return;
    reminderSaving.value = true;
    const prevEnabled = user.value?.streak_slack_notifications ?? true;
    const prevHours = [...reminderLocalHours.value];
    try {
        await $fetch("/api/profile/reminder-settings", {
            method: "PATCH",
            body: {
                streak_slack_notifications: streakReminderEnabled.value,
                reminder_local_hours: [...reminderLocalHours.value].sort(
                    (a, b) => a - b,
                ),
            },
        });
        await fetchSession();
    } catch (err) {
        console.error("[profile streak reminder] save failed", err);
        streakReminderEnabled.value = prevEnabled;
        reminderLocalHours.value = prevHours;
        await showAlert({
            tone: "error",
            message: t("profile.project_streaks.reminder_save_failed"),
        });
    } finally {
        reminderSaving.value = false;
    }
}

// debounced so several toggles collapse into one PATCH.
let reminderSaveTimer: ReturnType<typeof setTimeout> | null = null;
function onReminderHoursChange(hours: number[]): void {
    if (hours.length === 0) return;
    reminderLocalHours.value = hours;
    if (reminderSaveTimer) clearTimeout(reminderSaveTimer);
    reminderSaveTimer = setTimeout(() => {
        void saveStreakReminder();
    }, 500);
}

async function refreshStreaks(): Promise<void> {
    if (refreshingStreaks.value) return;
    refreshingStreaks.value = true;
    // ok:true even when hackatime is down (journals carry the streak), so only a failed POST is an error.
    type SyncResp = {
        ok: true;
        journal_recomputed: boolean;
        hackatime:
            | { linked: false; reason: "not_linked" }
            | { linked: true; reason: "debounced" | "fetch_failed" | "token_dead" }
            | {
                  linked: true;
                  total_hours: number;
                  delta_hours: number;
                  delta_seconds: number;
                  extended_streak: boolean;
              };
    };
    let syncError: unknown = null;
    try {
        await $fetch<SyncResp>("/api/users/sync-hackatime?manual=1", {
            method: "POST",
        });
    } catch (err) {
        syncError = err;
        console.error("[profile streak refresh] sync failed", err);
    }
    try {
        await refreshNuxtData("profile-streaks");
        await streakCalendarRef.value?.refresh();
    } catch (err) {
        console.error("[profile streak refresh] local refetch failed", err);
    }
    refreshingStreaks.value = false;

    if (syncError) {
        await showAlert({
            tone: "error",
            message: t("profile.project_streaks.refresh_failed"),
        });
        return;
    }
}

onBeforeUnmount(() => {
    if (savedToastTimer) clearTimeout(savedToastTimer);
    if (reminderSaveTimer) clearTimeout(reminderSaveTimer);
});
</script>

<template>
    <div :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'" class="relative overflow-hidden">
        <div
            v-for="(fruit, i) in scatteredFruits"
            :key="'profile-fruit-' + i"
            class="absolute pointer-events-none opacity-20"
            :style="{
                top: fruit.top,
                left: fruit.left,
                transform: `rotate(${fruit.rotation}deg)`,
            }"
        >
            <img
                :src="fruit.src"
                :style="{ width: fruit.size + 'px', height: fruit.size + 'px' }"
                class="object-contain"
                alt=""
            >
        </div>
        <div class="relative z-10 max-w-4xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-6">
            <div v-if="isWindowed" class="flex items-center justify-between gap-4 w-full flex-wrap">
                <button
                    class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
                    @click="closeModal"
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                    </svg>
                    {{ $t("profile.back_to_farm") }}
                </button>
                <a
                    href="/profile"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
                >
                    {{ $t("profile.open_in_new_tab") }}
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                </a>
            </div>
            <NuxtLink
                v-else
                to="/dashboard"
                class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t("profile.back_to_farm") }}
            </NuxtLink>

            <component :is="'div'">
                <div class="flex items-center gap-5" :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <div class="w-16 h-16 min-w-[4rem] max-w-[4rem] min-h-[4rem] max-h-[4rem] rounded-full overflow-hidden border-[3px] border-ds-brown shrink-0">
                        <img
                            v-if="user?.image"
                            :src="user.image"
                            class="w-16 h-16 object-cover"
                            alt="avatar"
                        >
                        <div
                            v-else
                            class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-2xl font-bold text-ds-brown"
                        >
                            {{ (user?.name || "?").charAt(0).toUpperCase() }}
                        </div>
                    </div>
                    <div class="flex-1 flex flex-col gap-1">
                        <div class="flex items-center justify-between">
                            <h2 class="text-2xl font-bold text-ds-brown">{{ user?.username || user?.name || $t("profile.farmer_fallback") }}</h2>
                            <button
                                class="text-xs font-bold text-ds-danger hover:text-ds-danger/80 transition-colors"
                                @click="handleLogout"
                            >
                                {{ $t("profile.log_out") }}
                            </button>
                        </div>
                        <p class="text-xs text-ds-brown/40">{{ $t("profile.member_since_long", { date: memberSince }) }}</p>
                    </div>
                </div>
            </component>

            <component :is="'div'">
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <h2 class="text-lg font-bold text-ds-brown mb-4">{{ $t("profile.linked_accounts") }}</h2>
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center justify-between bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3">
                            <div class="flex items-center gap-3">
                                <img src="https://assets.hackclub.com/icon-square.svg" class="w-8 h-8 rounded" alt="Hack Club">
                                <div class="flex flex-col">
                                    <span class="text-sm font-semibold text-ds-brown">{{ $t("profile.provider_hackclub") }}</span>
                                    <span v-if="user?.has_hackclub" class="text-xs text-ds-brown/50">{{ $t("profile.connected") }}{{ user.slack_id ? ` (${user.slack_id})` : '' }}</span>
                                    <span v-else class="text-xs text-ds-brown/50">{{ $t("profile.not_connected") }}</span>
                                </div>
                            </div>
                            <button
                                v-if="!user?.has_hackclub"
                                class="ds-btn-primary text-xs !px-4 !py-1.5"
                                @click="linkHackClub"
                            >
                                {{ $t("profile.link") }}
                            </button>
                            <!-- identity anchor: unlinking would orphan ships, journals and grants; the server rejects it too -->
                            <span
                                v-else
                                class="text-xs font-semibold text-ds-brown/50"
                            >
                                {{ $t("profile.linked_permanently") }}
                            </span>
                        </div>

                        <div class="flex items-center justify-between bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 bg-[#ec3750] rounded flex items-center justify-center">
                                    <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/>
                                    </svg>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm font-semibold text-ds-brown">Hackatime</span>
                                    <span v-if="user?.has_hackatime" class="text-xs text-ds-brown/50">{{ $t("profile.connected") }}</span>
                                    <span v-else class="text-xs text-ds-brown/50">{{ $t("profile.not_connected") }}</span>
                                </div>
                            </div>
                            <button
                                v-if="!user?.has_hackatime"
                                class="ds-btn-primary text-xs !px-4 !py-1.5"
                                @click="linkHackatime"
                            >
                                {{ $t("profile.link") }}
                            </button>
                            <!-- unlink-relink cycles kept resetting streaks; the server rejects unlinking (409) -->
                            <span
                                v-else
                                class="text-xs font-semibold text-ds-brown/50"
                            >
                                {{ $t("profile.linked_permanently") }}
                            </span>
                        </div>

                        <div class="flex items-center justify-between bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 bg-gray-800 rounded flex items-center justify-center">
                                    <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                                    </svg>
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm font-semibold text-ds-brown">GitHub</span>
                                    <span v-if="user?.has_github" class="text-xs text-ds-brown/50">{{ $t("profile.connected") }}</span>
                                    <span v-else class="text-xs text-ds-brown/50">{{ $t("profile.not_connected") }}</span>
                                </div>
                            </div>
                            <button
                                v-if="!user?.has_github"
                                class="ds-btn-primary text-xs !px-4 !py-1.5"
                                @click="linkGithub"
                            >
                                {{ $t("profile.link") }}
                            </button>
                            <button
                                v-else
                                class="text-xs font-semibold text-ds-danger/60 hover:text-ds-danger transition-colors"
                                :disabled="unlinking === 'github'"
                                @click="unlinkProvider('github')"
                            >
                                {{ unlinking === 'github' ? $t("profile.unlinking") : $t("profile.unlink") }}
                            </button>
                        </div>

                        <div class="flex items-center justify-between bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 bg-ds-brown flex items-center justify-center">
                                    <KeyRound :size="18" class="text-parchment" />
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm font-semibold text-ds-brown">{{ $t("profile.api_keys") }}</span>
                                    <span class="text-xs text-ds-brown/50">{{ $t("profile.api_keys_desc") }}</span>
                                </div>
                            </div>
                            <NuxtLink to="/settings/api-keys" target="_blank" class="ds-btn-primary text-xs !px-4 !py-1.5">
                                {{ $t("profile.manage") }}
                            </NuxtLink>
                        </div>
                    </div>
                </div>
            </component>

            <!-- the claim gate is buying the Event-Invite ticket, not the hours total (server/lib/certificates.ts) -->
            <component :is="'div'">
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <h2 class="text-lg font-bold text-ds-brown mb-3 flex items-center gap-2">
                        <Award
                            class="w-5 h-5"
                            :class="certProgress.has_certificate ? 'text-ds-success' : 'text-ds-brown'"
                        />
                        {{ $t("certificate.progress.heading") }}
                    </h2>

                    <p class="text-sm text-ds-brown/70 mb-3">
                        {{ $t("certificate.progress.about") }}
                    </p>

                    <!-- The certificate requires the Event Invite AND showing
                         up: staff confirm attendance after the event. -->
                    <p class="text-xs text-ds-brown/70 mb-3 font-semibold bg-ds-brown/5 border-2 border-ds-brown/15 px-3 py-2">
                        {{ $t("certificate.progress.ticket_note") }}
                    </p>

                    <template v-if="certProgress.has_certificate">
                        <p class="text-sm text-ds-brown/80 mb-3">{{ $t("certificate.progress.earned_title") }}</p>
                        <NuxtLink
                            :to="`/certificate/${certProgress.code}`"
                            class="ds-btn-primary text-sm inline-flex items-center gap-2"
                        >
                            <Award class="w-4 h-4" /> {{ $t("certificate.progress.view_cta") }}
                        </NuxtLink>
                    </template>

                    <template v-else>
                        <p class="text-sm text-ds-brown/70 mb-2">
                            {{ $t("certificate.progress.remaining", { count: certProgress.remaining }) }}
                        </p>
                        <div class="w-full h-4 bg-ds-brown/10 border-2 border-ds-brown/20">
                            <div
                                class="h-full bg-ds-brown transition-[width] duration-500"
                                :style="{ width: certProgressPct + '%' }"
                            />
                        </div>
                        <p class="text-xs text-ds-brown/50 mt-1 tabular-nums">
                            {{ $t("certificate.progress.hours_of", { current: certProgress.eligible_hours, total: certProgress.threshold }) }}
                        </p>
                        <p class="text-xs text-ds-brown/50 mt-1">{{ $t("certificate.progress.eligible_note") }}</p>

                        <div class="mt-4 pt-4 border-t-2 border-ds-brown/15">
                            <template v-if="certProgress.eligible">
                                <p class="text-sm text-ds-brown/80 mb-3">{{ $t("certificate.progress.ready_claim") }}</p>
                                <NuxtLink to="/certificate" class="ds-btn-primary text-sm inline-flex items-center gap-2">
                                    <Award class="w-4 h-4" /> {{ $t("certificate.progress.claim_cta") }}
                                </NuxtLink>
                            </template>
                            <template v-else-if="certProgress.event_invite_purchased">
                                <p class="text-sm text-ds-brown/70 mb-3">{{ $t("certificate.progress.awaiting_attendance") }}</p>
                            </template>
                            <template v-else>
                                <p class="text-sm text-ds-brown/70 mb-3">{{ $t("certificate.progress.needs_invite") }}</p>
                                <NuxtLink to="/shop" class="ds-btn-primary text-sm inline-flex items-center gap-2">
                                    {{ $t("certificate.progress.get_invite_cta") }}
                                </NuxtLink>
                            </template>
                        </div>
                    </template>

                    <div class="mt-4 pt-4 border-t-2 border-ds-brown/15 flex flex-col items-center gap-2">
                        <p class="text-[11px] tracking-widest font-bold uppercase text-ds-brown/50">
                            {{ $t("certificate.landing.recognized_by") }}
                        </p>
                        <SponsorLogoRow variant="dark" />
                    </div>
                </div>
            </component>

            <component :is="'div'" v-if="referral">
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <h2 class="text-lg font-bold text-ds-brown mb-1">{{ $t("profile.referrals.heading") }}</h2>
                    <p class="text-xs text-ds-brown/60 mb-4">
                        {{ $t("profile.referrals.intro") }}
                    </p>

                    <div v-if="referralDisclosureAcked" class="flex flex-col sm:flex-row items-stretch gap-3 mb-4">
                        <div class="flex-1 flex items-center justify-between bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3">
                            <div class="flex flex-col">
                                <span class="text-xs text-ds-brown/50">{{ $t("profile.referrals.your_code") }}</span>
                                <span class="text-2xl font-mono font-bold text-ds-brown tracking-widest">{{ referral.code }}</span>
                            </div>
                            <div class="flex flex-col items-end">
                                <span class="text-xs text-ds-brown/50">{{ $t("profile.referrals.friends_joined") }}</span>
                                <span class="text-2xl font-bold text-ds-brown">{{ referral.validReferralCount }}</span>
                                <span
                                    v-if="referral.pendingReferralCount > 0"
                                    class="text-[11px] text-ds-brown/60 mt-0.5"
                                    :title="$t('profile.referrals.pending_hint')"
                                >
                                    {{ $t("profile.referrals.pending_count", referral.pendingReferralCount, { count: referral.pendingReferralCount }) }}
                                </span>
                            </div>
                        </div>
                        <button
                            class="ds-btn-primary text-sm whitespace-nowrap"
                            @click="copyReferralLink"
                        >
                            {{ copyState === 'copied' ? $t("profile.referrals.copied") : $t("profile.referrals.copy_link") }}
                        </button>
                    </div>

                    <div
                        v-else
                        class="flex flex-col sm:flex-row items-stretch gap-3 mb-4"
                    >
                        <div class="flex-1 flex items-center gap-3 bg-ds-brown/5 border-2 border-dashed border-ds-brown/30 px-4 py-3">
                            <Lock :size="22" class="shrink-0 text-ds-brown/60" />
                            <p class="text-sm text-ds-brown/70">
                                {{ $t("profile.referrals.hidden_blurb") }}
                            </p>
                        </div>
                        <button
                            class="ds-btn-primary text-sm whitespace-nowrap"
                            @click="openDisclosureModal"
                        >
                            {{ $t("profile.referrals.reveal_cta") }}
                        </button>
                    </div>

                    <button
                        type="button"
                        class="flex items-center justify-between w-full text-sm font-semibold text-ds-brown hover:opacity-80 mt-1"
                        :aria-expanded="tiersOpen"
                        @click="tiersOpen = !tiersOpen"
                    >
                        <span>{{ $t("profile.referrals.tiers_heading") }}</span>
                        <ChevronDown
                            :size="18"
                            :class="['transition-transform duration-200', tiersOpen && 'rotate-180']"
                        />
                    </button>
                    <div v-if="tiersOpen" class="flex flex-col gap-2 mt-3">
                        <div
                            v-for="t in referral.tiers"
                            :key="t.tier"
                            class="flex items-center gap-3 bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3"
                            :class="t.claimed && 'opacity-60'"
                        >
                            <div
                                class="w-10 h-10 shrink-0 flex items-center justify-center border-2 border-ds-brown/30 font-bold text-ds-brown"
                                :class="t.claimed ? 'bg-ds-success/30' : t.unlocked ? 'bg-ds-warning/30' : 'bg-ds-brown/10'"
                            >
                                <span v-if="t.claimed">✓</span>
                                <span v-else>{{ t.tier }}</span>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-baseline gap-2 flex-wrap">
                                    <span class="text-sm font-semibold text-ds-brown">{{ translateTierTitle(t) }}</span>
                                    <span class="text-xs text-ds-brown/60">{{ $t("profile.referrals.friend_count", t.requiredCount, { count: t.requiredCount }) }}</span>
                                </div>
                                <p class="text-xs text-ds-brown/70">{{ $t("profile.referrals.gold_reward", { count: t.goldAmount }) }}</p>
                            </div>
                            <button
                                v-if="t.claimed"
                                class="text-xs font-semibold text-ds-brown/50"
                                disabled
                            >
                                {{ $t("profile.referrals.claimed") }}
                            </button>
                            <button
                                v-else-if="t.unlocked"
                                class="ds-btn-primary text-xs !px-4 !py-1.5"
                                :disabled="redeemingTier === t.tier"
                                @click="redeemTier(t.tier)"
                            >
                                {{ redeemingTier === t.tier ? $t("profile.referrals.redeeming") : $t("profile.referrals.redeem") }}
                            </button>
                            <span
                                v-else
                                class="text-xs font-semibold text-ds-brown/40"
                            >
                                {{ $t("profile.referrals.locked") }}
                            </span>
                        </div>
                    </div>

                </div>
            </component>

            <component :is="'div'" id="streak">
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
                        <h2 class="text-lg font-bold text-ds-brown">{{ $t("profile.project_streaks.heading") }}</h2>
                        <button
                            type="button"
                            class="flex items-center gap-1.5 px-3 py-1 text-sm font-semibold text-ds-brown border-[3px] border-ds-brown hover:bg-ds-brown/10 disabled:opacity-40 disabled:cursor-not-allowed"
                            :disabled="refreshingStreaks"
                            :title="$t('profile.project_streaks.refresh_description')"
                            :aria-label="$t('profile.project_streaks.refresh_description')"
                            @click="refreshStreaks"
                        >
                            <RotateCw :size="14" :class="['flex-shrink-0', refreshingStreaks && 'animate-spin']" />
                            <span>{{ refreshingStreaks ? $t("profile.project_streaks.refresh_loading") : $t("profile.project_streaks.refresh_label") }}</span>
                        </button>
                    </div>

                    <div v-if="streaksLoading" class="flex flex-col gap-5" aria-hidden="true">
                        <div class="mb-5 pb-4 border-b-2 border-ds-brown/15">
                            <div class="h-4 w-40 bg-ds-brown/10 animate-pulse mb-2" />
                            <div class="h-3 w-full bg-ds-brown/10 animate-pulse" />
                        </div>
                        <div class="mb-5 pb-4 border-b-2 border-ds-brown/15">
                            <div class="h-10 w-36 bg-ds-brown/10 animate-pulse" />
                        </div>
                        <div class="h-12 w-full bg-ds-brown/10 animate-pulse" />
                    </div>

                    <div v-if="!streaksLoading" class="mb-5 pb-4 border-b-2 border-ds-brown/15 flex items-center gap-3">
                        <StreakFlame :dim="currentStreak < 1" class="w-8 h-8 flex-shrink-0" />
                        <div>
                            <div class="text-3xl font-bold text-ds-brown leading-none">{{ currentStreak }}</div>
                            <div class="text-sm font-semibold text-ds-brown/65 mt-1">{{ $t("profile.project_streaks.current_streak_label") }}</div>
                        </div>
                    </div>

                    <div v-if="!streaksLoading" class="mb-5 pb-4 border-b-2 border-ds-brown/15">
                        <div class="flex items-center justify-between gap-2 mb-1.5">
                            <span class="text-sm font-bold text-ds-brown flex items-center gap-1.5">
                                <StreakFlame :dim="todayProgress < 1" class="w-4 h-4" />
                                {{ $t("profile.streak_progress.today_label") }}
                            </span>
                            <span class="text-sm font-bold text-ds-brown">
                                {{ $t("profile.streak_progress.minutes_of_goal", { minutes: todayMinutes, goal: goalMinutes }) }}
                            </span>
                        </div>
                        <div class="h-3 bg-ds-brown/15 overflow-hidden border border-ds-brown/20">
                            <div
                                class="h-full transition-[width] duration-500"
                                :class="todayProgress >= 1 ? 'bg-ds-success' : 'bg-orange-500'"
                                :style="{ width: `${Math.round(todayProgress * 100)}%` }"
                            />
                        </div>
                        <p class="mt-1.5 text-xs font-semibold text-ds-brown/65">
                            <span v-if="todayProgress >= 1">{{ $t("profile.streak_progress.goal_reached") }}</span>
                            <span v-else>{{ $t("profile.streak_progress.minutes_left", { minutes: minutesLeft }) }}</span>
                        </p>
                    </div>

                    <div v-if="!streaksLoading" class="mb-5 pb-4 border-b-2 border-ds-brown/15">
                        <div class="flex items-start gap-4 flex-wrap">
                            <div class="flex items-center gap-2 px-3 py-2 bg-cyan-50 border-2 border-cyan-700/40 text-cyan-900">
                                <StreakFlame frozen class="w-5 h-5" />
                                <span class="text-2xl font-bold">{{ streakFreezes }}</span>
                                <span class="text-sm font-semibold">{{ $t("profile.project_streaks.freezes_label") }}</span>
                            </div>
                            <p class="flex-1 min-w-[240px] text-xs text-ds-brown/70 leading-relaxed">
                                {{ $t("profile.project_streaks.freeze_rule") }}
                            </p>
                        </div>
                    </div>

                    <div v-if="!streaksLoading && streaksErrored" class="text-sm text-ds-danger italic">
                        {{ $t("profile.project_streaks.load_error") }}
                    </div>
                    <div v-else-if="!streaksLoading && projectStreaks.length === 0" class="text-sm text-ds-brown/60 italic">
                        {{ $t("profile.project_streaks.empty") }}
                    </div>
                    <ul v-else-if="!streaksLoading" class="flex flex-col gap-2">
                        <li
                            v-for="proj in projectStreaks"
                            :key="proj.id"
                            class="flex items-center gap-3 px-3 py-2 bg-ds-brown/5 border-2 border-ds-brown/20"
                        >
                            <StreakFlame :dim="!workedToday" class="w-6 h-6 flex-shrink-0" />
                            <span class="flex-1 min-w-0 text-sm font-semibold text-ds-brown truncate">
                                {{ proj.name || $t("profile.project_streaks.untitled") }}
                            </span>
                            <span class="text-2xl font-bold text-ds-brown">{{ proj.project_streak_days }}</span>
                            <span class="text-xs text-ds-brown/60">{{ $t("profile.project_streaks.day_label") }}</span>
                        </li>
                    </ul>

                    <div class="mt-5 pt-4 border-t-2 border-ds-brown/15">
                        <button
                            type="button"
                            class="flex items-center justify-between w-full text-sm font-semibold text-ds-brown hover:opacity-80"
                            :aria-expanded="trendsOpen"
                            @click="trendsOpen = !trendsOpen"
                        >
                            <span>{{ $t("profile.streak_trends.heading") }}</span>
                            <ChevronDown
                                :size="18"
                                :class="['transition-transform duration-200', trendsOpen && 'rotate-180']"
                            />
                        </button>
                        <div v-if="trendsOpen" class="mt-4">
                            <StreakTrends />
                        </div>
                    </div>

                    <div class="mt-5 pt-4 border-t-2 border-ds-brown/15">
                        <button
                            type="button"
                            class="flex items-center justify-between w-full text-sm font-semibold text-ds-brown hover:opacity-80"
                            :aria-expanded="calendarOpen"
                            @click="calendarOpen = !calendarOpen"
                        >
                            <span>{{ $t("profile.streak_calendar.heading") }}</span>
                            <ChevronDown
                                :size="18"
                                :class="['transition-transform duration-200', calendarOpen && 'rotate-180']"
                            />
                        </button>
                        <div v-if="calendarOpen" class="mt-4">
                            <StreakCalendar ref="streakCalendarRef" />
                        </div>
                    </div>
                </div>
            </component>

            <component :is="'div'">
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <h2 class="text-lg font-bold text-ds-brown mb-2">{{ $t("profile.notifications.heading") }}</h2>
                    <p class="text-sm text-ds-brown/70 mb-4">{{ $t("profile.notifications.description") }}</p>
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-left text-ds-brown/60">
                                <th class="pb-2 pr-4 font-medium">{{ $t("profile.notifications.column_category") }}</th>
                                <th class="pb-2 px-2 font-medium text-center">{{ $t("profile.notifications.column_slack") }}</th>
                                <th class="pb-2 px-2 font-medium text-center">{{ $t("profile.notifications.column_email") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="cat in NOTIF_CATEGORIES"
                                :key="cat"
                                class="border-t border-ds-brown/15"
                            >
                                <td class="py-3 pr-4 text-ds-brown">{{ $t(`profile.notifications.category_${cat}`) }}</td>
                                <td class="py-3 px-2 text-center">
                                    <input
                                        v-model="notifPrefs[cat].slack"
                                        type="checkbox"
                                        class="w-4 h-4 accent-ds-brown"
                                    >
                                </td>
                                <td class="py-3 px-2 text-center">
                                    <input
                                        v-model="notifPrefs[cat].email"
                                        type="checkbox"
                                        class="w-4 h-4 accent-ds-brown"
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <!-- out-in so the chip never sits beside the fading button and shifts the layout -->
                    <div class="mt-4 flex items-center gap-3 min-h-[32px]">
                        <Transition name="notif-save" mode="out-in">
                            <button
                                v-if="notifPrefsDirty || savingNotifs"
                                key="button"
                                class="ds-btn-primary text-sm"
                                :disabled="savingNotifs"
                                @click="saveNotifPrefs"
                            >
                                {{ savingNotifs ? $t("profile.notifications.saving") : $t("profile.notifications.save") }}
                            </button>
                            <span
                                v-else-if="notifsSavedAt"
                                key="saved"
                                class="text-xs text-ds-brown/60"
                            >{{ $t("profile.notifications.saved") }}</span>
                            <span v-else key="empty" aria-hidden="true" />
                        </Transition>
                    </div>

                    <div class="mt-5 pt-4 border-t-2 border-ds-brown/15">
                        <h3 class="text-sm font-bold text-ds-brown mb-1">{{ $t("profile.project_streaks.reminder_heading") }}</h3>
                        <p class="text-xs text-ds-brown/60 mb-3">{{ $t("profile.project_streaks.reminder_description") }}</p>
                        <label class="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                v-model="streakReminderEnabled"
                                type="checkbox"
                                class="w-4 h-4 accent-ds-brown"
                                :disabled="reminderSaving"
                                @change="saveStreakReminder"
                            >
                            <span class="text-sm text-ds-brown font-semibold">{{ $t("profile.project_streaks.reminder_enable_label") }}</span>
                        </label>
                        <div v-if="streakReminderEnabled" class="flex items-center gap-2 flex-wrap mt-3">
                            <label class="text-sm font-semibold text-ds-brown">
                                {{ $t("profile.project_streaks.reminder_time_label") }}
                            </label>
                            <MultiSelectDropdown
                                :model-value="reminderLocalHours"
                                :options="reminderHourOptions"
                                :disabled="reminderSaving"
                                :placeholder="$t('profile.project_streaks.reminder_time_label')"
                                @update:model-value="onReminderHoursChange"
                            />
                        </div>
                        <p v-if="streakReminderEnabled" class="text-xs text-ds-brown/60 mt-2">
                            {{ $t("profile.project_streaks.reminder_time_help", { time: reminderTimesLabel }) }}
                        </p>
                        <p v-if="streakReminderEnabled && !user?.slack_id" class="text-xs text-ds-brown/70 font-semibold italic mt-2">
                            {{ $t("profile.project_streaks.reminder_needs_slack") }}
                        </p>
                    </div>
                </div>
            </component>

            <component :is="'div'">
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <h2 class="text-lg font-bold text-ds-brown mb-4">{{ $t("profile.stats_heading_short") }}</h2>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div class="flex flex-col items-center gap-1 bg-ds-brown/5 border-2 border-ds-brown/20 p-4">
                            <span class="text-3xl font-bold text-ds-brown">{{ projects.length }}</span>
                            <span class="text-xs text-ds-brown/50">{{ $t("profile.stat_projects") }}</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 bg-ds-brown/5 border-2 border-ds-brown/20 p-4">
                            <span class="text-3xl font-bold text-ds-brown">{{ totalHours }}</span>
                            <span class="text-xs text-ds-brown/50">{{ $t("profile.stat_hours") }}</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 bg-ds-brown/5 border-2 border-ds-brown/20 p-4">
                            <span class="text-3xl font-bold text-ds-brown">0</span>
                            <span class="text-xs text-ds-brown/50">{{ $t("profile.stat_reviews") }}</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 bg-ds-brown/5 border-2 border-ds-brown/20 p-4">
                            <span class="text-3xl font-bold text-ds-brown">0</span>
                            <span class="text-xs text-ds-brown/50">{{ $t("profile.stat_gold") }}</span>
                        </div>
                    </div>
                </div>
            </component>

            <component
                :is="'div'"
                v-if="pendingGold && pendingGold.projects.length > 0"
            >
                <div :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
                    <h2 class="text-lg font-bold text-ds-brown mb-2">Pending gold</h2>
                    <p class="text-sm text-ds-brown/70 mb-4">
                        Finish building these hardware projects and submit a build-complete ship to claim the pending gold.
                    </p>
                    <div class="flex flex-col gap-3">
                        <NuxtLink
                            v-for="group in pendingGold.projects"
                            :key="group.project_id"
                            :to="`/projects/${group.project_id}`"
                            class="flex items-center gap-4 bg-ds-brown/5 border-2 border-ds-brown/20 p-3 hover:bg-ds-brown/10 transition-colors"
                        >
                            <img
                                v-if="group.project_thumbnail_url"
                                :src="group.project_thumbnail_url"
                                :alt="group.project_name ?? 'project'"
                                class="w-14 h-14 object-cover border-2 border-ds-brown/20"
                            >
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-semibold text-ds-brown truncate">
                                    {{ group.project_name ?? 'Project #' + group.project_id }}
                                </div>
                                <div class="text-xs text-ds-brown/60">Awaiting build proof</div>
                            </div>
                            <div
                                class="flex items-center gap-1 opacity-70"
                                :title="`Finish building this project and submit a build-complete ship to claim this gold.`"
                            >
                                <img
                                    src="/images/icons/money.webp"
                                    alt="gold"
                                    class="w-7 h-7"
                                >
                                <span class="text-sm font-bold text-ds-brown/70">
                                    {{ Math.floor(group.total_gold) }}
                                </span>
                            </div>
                        </NuxtLink>
                    </div>
                </div>
            </component>

            <component :is="'div'">
                <div>
                    <h2 class="text-lg font-bold text-ds-brown mb-4">{{ $t("profile.my_projects") }}</h2>
                    <div v-if="projects.length === 0" class="text-sm text-ds-brown/50 text-center py-6">
                        {{ $t("profile.no_projects") }}
                    </div>
                    <div v-else class="flex flex-col gap-2">
                        <NuxtLink
                            v-for="p in projects"
                            :key="(p.id as string)"
                            :to="`/projects/${p.id}`"
                            class="group relative min-h-20 overflow-hidden border-2 border-ds-brown/20 bg-ds-brown/5 px-4 py-3 transition-colors hover:border-ds-brown/40"
                        >
                            <img
                                v-if="(p.thumbnail_url as string)"
                                :src="(p.thumbnail_url as string)"
                                class="absolute inset-0 h-full w-full object-cover opacity-40 transition-opacity group-hover:opacity-50"
                                alt=""
                            >
                            <div class="absolute inset-0 bg-parchment/45" />
                            <div
                                v-if="user?.id && (p.user_id as string | null) && (p.user_id as string) !== user.id"
                                class="absolute top-1.5 right-1.5 z-20 w-6 h-6 flex items-center justify-center bg-parchment border-2 border-ds-brown text-ds-brown shadow-sm"
                                :title="$t('group_projects.shared_badge')"
                                :aria-label="$t('group_projects.shared_badge')"
                            >
                                <Users :size="12" />
                            </div>
                            <div class="relative z-10 flex h-full items-center gap-3">
                                <div class="flex-1 min-w-0">
                                    <span class="text-sm font-semibold text-ds-brown block truncate">{{ p.name || $t("profile.untitled_project") }}</span>
                                    <span class="text-xs text-ds-brown/60">{{ p.fruit || $t("profile.no_fruit") }} - {{ $t("profile.stage") }} {{ p.stage || 1 }}</span>
                                </div>
                                <svg class="w-4 h-4 text-ds-brown/35 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        </NuxtLink>
                    </div>
                </div>
            </component>
        </div>

        <Teleport to="body">
            <Transition :css="false" appear @enter="onDisclosureBackdropEnter" @leave="onDisclosureBackdropLeave">
                <div
                    v-if="showDisclosureModal"
                    class="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm"
                    @click="closeDisclosureModal"
                />
            </Transition>
            <Transition :css="false" appear @enter="onDisclosurePanelEnter" @leave="onDisclosurePanelLeave">
                <div
                    v-if="showDisclosureModal"
                    ref="disclosureDialogEl"
                    role="dialog"
                    aria-modal="true"
                    class="fixed inset-0 z-[401] flex items-center justify-center p-4 pointer-events-none"
                >
                    <WoodFrame class="w-full max-w-lg pointer-events-auto">
                        <div class="p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
                            <div class="flex items-start gap-3">
                                <AlertTriangle :size="28" class="shrink-0 text-tuscan-sun-500 mt-0.5" />
                                <div class="flex-1 min-w-0">
                                    <h2 class="text-lg font-bold text-ds-brown">
                                        {{ $t("profile.referrals.disclosure.title") }}
                                    </h2>
                                    <p class="text-sm text-ds-brown/80 mt-1">
                                        {{ $t("profile.referrals.disclosure.intro") }}
                                    </p>
                                </div>
                            </div>

                            <div class="flex items-start gap-3 bg-ds-danger/10 border-2 border-ds-danger/30 px-4 py-3">
                                <AlertTriangle :size="20" class="shrink-0 text-ds-danger mt-0.5" />
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-semibold text-ds-brown">
                                        {{ $t("profile.referrals.disclosure.rule1_title") }}
                                    </p>
                                    <p class="text-xs text-ds-brown/80 mt-1 leading-relaxed">
                                        {{ $t("profile.referrals.disclosure.rule1_body") }}
                                    </p>
                                </div>
                            </div>

                            <div class="flex items-start gap-3 bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3">
                                <UserCheck :size="20" class="shrink-0 text-ds-brown mt-0.5" />
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-semibold text-ds-brown">
                                        {{ $t("profile.referrals.disclosure.rule2_title") }}
                                    </p>
                                    <p class="text-xs text-ds-brown/80 mt-1 leading-relaxed">
                                        {{ $t("profile.referrals.disclosure.rule2_body") }}
                                    </p>
                                </div>
                            </div>

                            <label
                                class="flex items-start gap-3 px-1 select-none"
                                :class="disclosureSecondsRemaining > 0 ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
                            >
                                <input
                                    v-model="disclosureChecked"
                                    type="checkbox"
                                    :disabled="disclosureSecondsRemaining > 0"
                                    class="mt-0.5 w-5 h-5 accent-ds-brown shrink-0 disabled:cursor-not-allowed"
                                />
                                <span class="text-sm font-semibold text-ds-brown">
                                    {{ $t("profile.referrals.disclosure.checkbox_label") }}
                                </span>
                            </label>

                            <p
                                v-if="disclosureSecondsRemaining > 0"
                                class="text-xs text-ds-brown/60 -mt-2 px-1"
                            >
                                {{ $t("profile.referrals.disclosure.wait_hint", { seconds: disclosureSecondsRemaining }) }}
                            </p>

                            <div class="flex justify-between gap-2 pt-1">
                                <button
                                    class="ds-btn-ghost text-sm"
                                    @click="closeDisclosureModal"
                                >
                                    {{ $t("profile.referrals.disclosure.cancel") }}
                                </button>
                                <button
                                    class="ds-btn-primary text-sm"
                                    :disabled="!disclosureChecked || disclosureSecondsRemaining > 0"
                                    @click="confirmDisclosure"
                                >
                                    {{ $t("profile.referrals.disclosure.confirm") }}
                                </button>
                            </div>
                        </div>
                    </WoodFrame>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<style scoped>
.notif-save-enter-active,
.notif-save-leave-active {
    transition: opacity 0.25s ease;
}
.notif-save-enter-from,
.notif-save-leave-to {
    opacity: 0;
}
</style>
