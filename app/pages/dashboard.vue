<script setup lang="ts">
import { Trophy, X } from "lucide-vue-next";
import { useWindowManager } from '~/composables/useWindowManager';
import { useEscapeClose } from '~/composables/useEscapeClose';
import { formatGold } from '~/utils/formatGold';

const ProjectPage = defineAsyncComponent(() => import('~/pages/projects/[id].vue'));
const ProfilePage = defineAsyncComponent(() => import('~/pages/profile.vue'));
const ShopPage = defineAsyncComponent(() => import('~/pages/shop.vue'));
const SupportListPage = defineAsyncComponent(() => import('~/pages/support/index.vue'));
const SupportDetailPage = defineAsyncComponent(() => import('~/pages/support/[id].vue'));
const ExplorePage = defineAsyncComponent(() => import('~/pages/explore.vue'));
const AchievementsPage = defineAsyncComponent(() => import('~/pages/achievements.vue'));

const { isLoggedIn, loading, user, fetchSession } = useAuth();

// shipping is blocked server-side until non-verified users finish HCA; ineligible
// users never get here (the OAuth callback redirects them to /auth/rejected).
const hcaBannerMode = computed<
    | "pending"
    | "needs_submission"
    | "basic_info_required"
    | "document_required"
    | null
>(() => {
    const status = user.value?.hca_verification_status;
    if (!status || status === "verified") return null;
    if (status === "pending") return "pending";
    if (status === "needs_submission") return "needs_submission";
    if (status === "basic_info_required") return "basic_info_required";
    if (status === "document_required") return "document_required";
    return null;
});

definePageMeta({
    layout: false,
});

if (import.meta.client) {
    watch(
        [isLoggedIn, loading],
        ([loggedIn, isLoading]) => {
            if (!isLoading && !loggedIn) navigateTo("/");
        },
        { immediate: true },
    );
}

const route = useRoute();

// entry points that faded to black pass ?from=fade so the navigation has no white flash.
const fadeInFromBlack = ref(route.query.from === "fade");
onMounted(() => {
  if (fadeInFromBlack.value) {
    requestAnimationFrame(() => {
      fadeInFromBlack.value = false;
    });
  }
});

const activeProjectId = ref<number | null>(null);
const showProfileModal = ref(false);
// query-driven modals open in onMounted, never in setup: SSR-rendering these Teleport +
// Transition modals strands an invisible opacity-0 backdrop that swallows every click.
const showShopModal = ref(false);
const showIdeasModal = ref(false);
const showExploreModal = ref(false);
const showAchievementsModal = ref(false);

const showSupportModal = ref(false);
const supportTicketId = ref<number | null>(null);
const projects = ref<Record<string, unknown>[]>([]);

// the login route re-requests the `address` scope; the callback upserts pii_locker and
// the airtable-repair cron fills Airtable later.
const needsAddressBanner = computed<boolean>(() => {
    if (!user.value) return false;
    if (user.value.is_temp) return false;
    if (user.value.has_address) return false;
    return projects.value.length > 0;
});

// mobile has no room for the wood-framed modal, so it navigates to the route instead.
const isMobile = ref(false);
function updateIsMobile() {
  isMobile.value = window.innerWidth < 768;
}
if (import.meta.client) {
  updateIsMobile();
  window.addEventListener("resize", updateIsMobile);
  onBeforeUnmount(() => window.removeEventListener("resize", updateIsMobile));
}

const showWelcome = ref(route.query.tour === '1');

// client-only, see the SSR note on the modal refs; mobile navigates to ?openProject instead.
onMounted(() => {
    const q = route.query;
    if (q.openProject) {
        const id = Number(q.openProject);
        if (Number.isFinite(id) && id > 0) {
            if (window.innerWidth < 768) void navigateTo(`/projects/${id}`); // mobile breakpoint
            else activeProjectId.value = id;
        }
    }
    if (q.shop === "1" || q.purchaseItem) showShopModal.value = true;
    // ?ideas=1 is ignored: Idea Box disabled to stop AI-credit usage.
    if (q.achievements === "1") showAchievementsModal.value = true;
    if (q.support === "1" || q.ticketId) {
        showSupportModal.value = true;
        if (q.ticketId) supportTicketId.value = Number(q.ticketId);
    }
});

function dismissWelcome() {
  showWelcome.value = false;
}

useEscapeClose(
  () =>
    showWelcome.value ||
    showSupportModal.value ||
    showShopModal.value ||
    showProfileModal.value ||
    showIdeasModal.value ||
    showAchievementsModal.value ||
    activeProjectId.value !== null,
  () => {
    if (showWelcome.value) { showWelcome.value = false; return; }
    if (showSupportModal.value) { showSupportModal.value = false; return; }
    if (showShopModal.value) { showShopModal.value = false; return; }
    if (showProfileModal.value) { showProfileModal.value = false; return; }
    if (showIdeasModal.value) { showIdeasModal.value = false; return; }
    if (showAchievementsModal.value) { showAchievementsModal.value = false; return; }
    if (activeProjectId.value !== null) { activeProjectId.value = null; return; }
  },
);

function handleOpenProfile() {
  if (isMobile.value) {
    void navigateTo("/profile");
    return;
  }
  showProfileModal.value = true;
}

function handleOpenShop() {
  if (isMobile.value) {
    void navigateTo("/shop");
    return;
  }
  showShopModal.value = true;
}

function handleOpenExplore() {
  if (isMobile.value) {
    void navigateTo("/explore");
    return;
  }
  showExploreModal.value = true;
}

function handleOpenProject(project: { id: number }) {
  if (isMobile.value) {
    void navigateTo(`/projects/${project.id}`);
    return;
  }
  activeProjectId.value = project.id;
}

// shortcuts are ignored while typing, while a modal is open, or with a modifier held.
const showShortcutsHelp = ref(false);
const anyModalOpen = computed(
  () =>
    showWelcome.value ||
    showSupportModal.value ||
    showShopModal.value ||
    showProfileModal.value ||
    showIdeasModal.value ||
    showExploreModal.value ||
    showAchievementsModal.value ||
    activeProjectId.value !== null,
);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function onDashboardKeydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  if (event.key === "?") {
    showShortcutsHelp.value = !showShortcutsHelp.value;
    event.preventDefault();
    return;
  }
  if (showShortcutsHelp.value) {
    if (event.key === "Escape") {
      showShortcutsHelp.value = false;
      event.preventDefault();
    }
    return;
  }
  // Farm-only: while a modal is open let it own the keyboard.
  if (anyModalOpen.value) return;

  switch (event.key) {
    case "s":
      handleOpenShop();
      event.preventDefault();
      break;
    case "p":
      handleOpenProfile();
      event.preventDefault();
      break;
    case "e":
      handleOpenExplore();
      event.preventDefault();
      break;
    default: {
      if (/^[1-9]$/.test(event.key)) {
        const id = projects.value[Number(event.key) - 1]?.id;
        if (typeof id === "number") {
          handleOpenProject({ id });
          event.preventDefault();
        }
      }
    }
  }
}

onMounted(() => {
  window.addEventListener("keydown", onDashboardKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onDashboardKeydown);
});

function closeShopModal() {
  showShopModal.value = false;

  if (route.query.shop === "1" || route.query.purchaseItem || route.query.view) {
    const nextQuery = { ...route.query };
    delete nextQuery.shop;
    delete nextQuery.purchaseItem;
    delete nextQuery.view;
    void navigateTo({ path: route.path, query: nextQuery }, { replace: true });
  }
}

function closeSupportModal() {
    showSupportModal.value = false;
    supportTicketId.value = null;
    if (route.query.support || route.query.ticketId) {
        const nextQuery = { ...route.query };
        delete nextQuery.support;
        delete nextQuery.ticketId;
        void navigateTo({ path: route.path, query: nextQuery }, { replace: true });
    }
}

function openSupportTicket(id: number) {
    supportTicketId.value = id;
    showSupportModal.value = true;
    void navigateTo(
        { path: route.path, query: { ...route.query, support: "1", ticketId: String(id) } },
        { replace: true },
    );
}

function backToSupportList() {
    supportTicketId.value = null;
    const nextQuery = { ...route.query, support: "1" } as Record<string, string>;
    delete nextQuery.ticketId;
    void navigateTo({ path: route.path, query: nextQuery }, { replace: true });
}

// not immediate: initial query state is applied in onMounted so modals never open during SSR.
watch(
    () => [route.query.shop, route.query.purchaseItem],
    ([shopQuery, purchaseItem]) => {
        showShopModal.value = shopQuery === "1" || !!purchaseItem;
    },
);

watch(
    () => [route.query.support, route.query.ticketId],
    ([supportQuery, tid]) => {
        showSupportModal.value = supportQuery === "1" || !!tid;
        supportTicketId.value = tid ? Number(tid) : null;
    },
);

// catches SPA navigations to ?openProject; onMounted only handles the first load.
watch(
    () => route.query.openProject,
    (raw) => {
        const id = raw ? Number(raw) : NaN;
        if (!Number.isFinite(id) || id <= 0) return;
        if (import.meta.client && window.innerWidth < 768) { // mobile breakpoint
            void navigateTo(`/projects/${id}`);
        } else {
            activeProjectId.value = id;
        }
    },
);

// fetched in parallel; the SSR session lookup enables the farm-flash redirect below,
// since the auth middleware bails out on the server.
type SessionPayload = {
    id?: string;
    onboarding_step?: string | null;
    [key: string]: unknown;
} | null;
// reuse payload/static data from a previous hydration instead of re-hitting the API;
// cast through `unknown` to match the per-call T useFetch infers.
const nuxtApp = useNuxtApp();
function reuseCachedData<T>(key: string) {
    return ((_k: string, app: typeof nuxtApp): T | undefined => {
        return ((app.payload.data?.[key] ?? app.static.data?.[key]) ?? undefined) as T | undefined;
    }) as unknown as (key: string, app: typeof nuxtApp, ctx: { cause: string }) => T | undefined;
}

const [projectsResult, balanceResult, starfruitResult, sessionResult] = await Promise.all([
    useFetch("/api/projects", {
        key: "dash-projects",
        default: () => [],
        getCachedData: reuseCachedData("dash-projects") as never,
    }),
    useFetch<{ balance: number }>("/api/users/balance", {
        key: "dash-balance",
        default: () => ({ balance: 0 }),
        getCachedData: reuseCachedData<{ balance: number }>("dash-balance"),
    }),
    useFetch<{ balance: number }>("/api/users/starfruit", {
        key: "dash-starfruit",
        default: () => ({ balance: 0 }),
        getCachedData: reuseCachedData<{ balance: number }>("dash-starfruit"),
    }),
    useFetch<SessionPayload>("/api/auth/me", {
        key: "dash-me",
        default: () => null,
        getCachedData: reuseCachedData<SessionPayload>("dash-me"),
    }),
]);
const fetchedProjects = projectsResult.data;
const balanceData = balanceResult.data;
const starfruitData = starfruitResult.data;
if (fetchedProjects.value) {
    projects.value = fetchedProjects.value as Record<string, unknown>[];
}

// seeds the shared balance so anything awarding or spending gold updates the HUD without a reload.
const { balance: sharedGoldBalance, setBalance: setSharedGoldBalance } = useGoldBalance();
if (balanceData.value) {
    setSharedGoldBalance(balanceData.value.balance);
}
watch(
    () => balanceData.value?.balance,
    (next) => {
        if (typeof next === "number") setSharedGoldBalance(next);
    },
);
const gold = computed(() => sharedGoldBalance.value);

const { data: earningRateData } = useLazyFetch<{
  has_shipped: boolean;
  gold_per_hour: number | null;
  fruit_per_hour: number | null;
}>("/api/users/earning-rate", {
  server: false,
  default: () => ({ has_shipped: false, gold_per_hour: null, fruit_per_hour: null }),
});
const earningRate = computed(() => earningRateData.value);

const { balance: sharedStarfruitBalance, setBalance: setSharedStarfruitBalance } = useStarfruitBalance();
if (starfruitData.value) {
    setSharedStarfruitBalance(starfruitData.value.balance);
}
watch(
    () => starfruitData.value?.balance,
    (next) => {
        if (typeof next === "number") setSharedStarfruitBalance(next);
    },
);
const starfruit = computed(() => sharedStarfruitBalance.value);

// seed auth from SSR so the first paint has a user and skips the loading spinner.
if (sessionResult.data.value) {
    user.value = sessionResult.data.value as typeof user.value;
    loading.value = false;
}

// redirect before any farm HTML streams; "tutorial" is an exit hatch, mirroring the
// middleware's canExitToDashboard.
{
    const step = sessionResult.data.value?.onboarding_step;
    if (
        !!step &&
        step !== "complete" &&
        step !== "tutorial"
    ) {
        await navigateTo("/onboarding", { replace: true });
    }
}

// Auto-sync hackatime so today's hours feed the streak (debounced on the server side)
onMounted(async () => {
    // stale non-verified users bounce through OAuth, whose callback refreshes their HCA status.
    const hcaStatus = user.value?.hca_verification_status;
    const lastLoginMs = user.value?.last_login_at
        ? new Date(user.value.last_login_at).getTime()
        : null;
    const hcaNonVerified =
        hcaStatus === "pending" ||
        hcaStatus === "needs_submission" ||
        hcaStatus === "basic_info_required" ||
        hcaStatus === "document_required";
    const hcaStale =
        lastLoginMs === null ||
        Date.now() - lastLoginMs > 10 * 60 * 1000; // hca auto-refresh cooldown
    if (hcaNonVerified && hcaStale) {
        window.location.href = "/api/auth/login?return_to=/dashboard";
        return;
    }

    if (!user.value?.has_hackatime) return;
    try {
        // extended_streak lives under the `hackatime` sub-result; refetch so the streak HUD updates.
        const result = await $fetch<{
            ok: boolean;
            hackatime?: { extended_streak?: boolean };
        }>("/api/users/sync-hackatime", { method: "POST" });
        if (result?.hackatime?.extended_streak) await fetchSession();
    } catch (err) {
        console.error("auto sync-hackatime failed", err);
    }
});

const htmlGuideCompleted = computed(() =>
    (user.value as Record<string, unknown>)?.completed_guides
        ? ((user.value as Record<string, unknown>).completed_guides as string[]).includes("html")
        : false
);

// set when the user left the tutorial via Back to farm; hidden once the html guide is done.
const tutorialInProgress = computed(
  () => user.value?.onboarding_step === "tutorial" && !htmlGuideCompleted.value,
);

function continueTutorial() {
    // legacy onboarding_step kept so the pill shows; the guide lives at /guides/html now.
    navigateTo("/guides/html");
}

const { windows, closeWindow, focusWindow, updatePosition, updateSize } = useWindowManager();

const isDev = import.meta.dev;
const nuking = ref(false);
const { showAlert } = useAlertDialog();

type DevDebugFlagKey =
  | "ignoreAddressChecks"
  | "ignoreShipPolicies"
  | "ignoreEditPolicies"
  | "ignoreReviewerOwnershipPolicies"
  | "fakeHackatime";

type DevDebugFlags = Record<DevDebugFlagKey, boolean>;

type DevDebugFlagsResponse = {
  available: boolean;
  enabled: boolean;
  flags: DevDebugFlags;
};

const defaultDevDebugFlags: DevDebugFlags = {
  ignoreAddressChecks: false,
  ignoreShipPolicies: false,
  ignoreEditPolicies: false,
  ignoreReviewerOwnershipPolicies: false,
  fakeHackatime: false,
};

const devDebugFlagOptions: Array<{
  key: DevDebugFlagKey;
  label: string;
  title: string;
}> = [
  {
    key: "ignoreAddressChecks",
    label: "Address",
    title: "Ignore development shipping-address checks for the current session.",
  },
  {
    key: "ignoreShipPolicies",
    label: "Ship policy",
    title: "Ignore development project readiness, hour, demo, repo, and duplicate checks.",
  },
  {
    key: "ignoreEditPolicies",
    label: "Edit locks",
    title: "Ignore development project edit locks while a ship is under review.",
  },
  {
    key: "ignoreReviewerOwnershipPolicies",
    label: "Own reviews",
    title: "Ignore development reviewer ownership guards for your own projects and ships.",
  },
  {
    key: "fakeHackatime",
    label: "Hackatime",
    title: "Pretend the current development session has linked Hackatime with fake projects, hours, and heartbeats.",
  },
];

const devDebugFlags = ref<DevDebugFlags>({ ...defaultDevDebugFlags });
const devDebugFlagsLoading = ref(false);
const devDebugFlagsSaving = ref<DevDebugFlagKey | null>(null);

function normalizeDevDebugFlags(flags: Partial<DevDebugFlags> | null | undefined): DevDebugFlags {
  return { ...defaultDevDebugFlags, ...(flags ?? {}) };
}

async function loadDevDebugFlags() {
    if (!isDev) return;
    devDebugFlagsLoading.value = true;
    try {
        devDebugFlags.value = normalizeDevDebugFlags((await $fetch<DevDebugFlagsResponse>("/api/dev/debug-flags")).flags);
    } catch (err) {
        console.error("[dashboard] failed to load dev debug flags", err);
    } finally {
        devDebugFlagsLoading.value = false;
    }
}

async function toggleDevDebugFlag(key: DevDebugFlagKey) {
    if (devDebugFlagsSaving.value) return;
    devDebugFlagsSaving.value = key;
    try {
        const res = await $fetch<DevDebugFlagsResponse>("/api/dev/debug-flags", {
            method: "PATCH",
            body: { [key]: !devDebugFlags.value[key] },
        });
        devDebugFlags.value = normalizeDevDebugFlags(res.flags);
        await fetchSession();
    } catch (err) {
        console.error("[dashboard] failed to update dev debug flag", err);
        await showAlert({ tone: "error", message: "Failed to update dev debug flag" });
    } finally {
        devDebugFlagsSaving.value = null;
    }
}

onMounted(() => {
    void loadDevDebugFlags();
});

async function nukeAccount() {
    if (!confirm("Are you sure? This will permanently delete your account and all data.")) return;
    if (!confirm("This cannot be undone. Really delete everything?")) return;
    nuking.value = true;
    try {
        await $fetch("/api/dev/nuke-account", { method: "DELETE" });
        navigateTo("/");
    } catch {
        await showAlert({ tone: "error", message: "Failed to nuke account" });
    } finally {
        nuking.value = false;
    }
}

</script>

<template>
    <div class="fixed inset-0 overflow-hidden bg-parchment">
        <!-- bg-parchment avoids a white flash during the page transition -->

        <!-- above the navbar (z-[100]) so it covers the whole screen while fading -->
        <Transition name="fade-black">
            <div v-if="fadeInFromBlack" class="fixed inset-0 z-[200] bg-black pointer-events-none" />
        </Transition>
        <!-- gate on !user so a background fetchSession() doesn't remount the whole dashboard -->
        <div v-if="loading && !user" class="w-full h-full flex justify-center items-center bg-black">
            <div
                class="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin"
            />
        </div>

        <template v-else>
            <!-- z-[110] overlays the navbar; fatal-rejected users never reach this page -->
            <div
                v-if="hcaBannerMode"
                class="absolute top-0 left-0 right-0 z-[110] pointer-events-none px-2 sm:px-4 pt-2"
            >
                <div
                    class="pointer-events-auto mx-auto max-w-3xl border-[3px] px-4 py-2 text-sm font-semibold text-center"
                    :class="hcaBannerMode === 'pending'
                        ? 'border-yellow-700 bg-yellow-100 text-yellow-900'
                        : 'border-red-700 bg-red-100 text-red-900'"
                >
                    <template v-if="hcaBannerMode === 'pending'">
                        Your Hack Club Auth verification is still under review. Shipping projects works, but the shop and grant payouts stay locked until you're verified.
                    </template>
                    <template v-else-if="hcaBannerMode === 'needs_submission'">
                        Your identity isn't verified yet, so you can't ship projects. Submit your verification documents at auth.hackclub.com to unlock shipping.
                    </template>
                    <template v-else-if="hcaBannerMode === 'basic_info_required'">
                        Finish your basic info on Hack Club Auth to unlock shipping.
                    </template>
                    <template v-else-if="hcaBannerMode === 'document_required'">
                        Hack Club Auth needs an ID document before you can ship. Upload one to continue.
                    </template>
                    <a
                        href="https://auth.hackclub.com"
                        target="_blank"
                        rel="noopener"
                        class="ml-2 underline font-bold hover:no-underline"
                    >Open auth.hackclub.com</a>
                    <a
                        href="/api/auth/login?return_to=/dashboard"
                        class="ml-2 underline font-bold hover:no-underline"
                    >Refresh status</a>
                </div>
            </div>

            <!-- the login route requests the address scope; stacks below the HCA banner -->
            <div
                v-if="needsAddressBanner"
                class="absolute left-0 right-0 z-[110] pointer-events-none px-2 sm:px-4"
                :class="hcaBannerMode ? 'top-12' : 'top-0 pt-2'"
            >
                <div
                    class="pointer-events-auto mx-auto max-w-3xl border-[3px] border-orange-700 bg-orange-100 text-orange-900 px-4 py-2 text-sm font-semibold text-center"
                >
                    Your shipping address isn't on file. Hack Club can't deliver swag, parts, or grants without it. Re-link your Hack Club Auth account so we can pull it in.
                    <a
                        href="/api/auth/login?return_to=/dashboard"
                        class="ml-2 underline font-bold hover:no-underline"
                    >Update address →</a>
                </div>
            </div>

            <!-- only for tokens revoked upstream; users Hackatime blocks don't get it since reconnecting can't help -->
            <div
                v-if="user?.hackatime_token_invalid"
                class="absolute left-0 right-0 z-[110] pointer-events-none px-2 sm:px-4"
                :class="hcaBannerMode && needsAddressBanner
                    ? 'top-24'
                    : (hcaBannerMode || needsAddressBanner) ? 'top-12' : 'top-0 pt-2'"
            >
                <div
                    class="pointer-events-auto mx-auto max-w-3xl border-[3px] border-red-700 bg-red-100 text-red-900 px-4 py-2 text-sm font-semibold text-center"
                >
                    Your Hackatime connection stopped working, so your coding hours and streak aren't being counted. Reconnect to pick up where you left off.
                    <a
                        href="/api/auth/hackatime/login?return_to=/dashboard"
                        class="ml-2 underline font-bold hover:no-underline"
                    >Reconnect Hackatime →</a>
                </div>
            </div>

            <GameWorld
                :show-store="false"
                :show-encounters="false"
                :projects="projects"
                :current-user-id="user?.id ?? null"
                @open-project="(p: any) => handleOpenProject(p)"
                @open-profile="handleOpenProfile"
                @open-shop="handleOpenShop"
                @open-explore="handleOpenExplore"
            />

            <div class="absolute top-0 left-0 right-0 z-[100] pointer-events-none">
                <div class="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 pointer-events-auto">
                    <!-- hidden on mobile to make room for the HUD -->
                    <div class="hidden sm:flex items-center gap-3">
                        <a
                            href="https://hackclub.com"
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label="Hack Club"
                            class="inline-block shrink-0"
                        >
                            <img src="https://assets.hackclub.com/flag-standalone.svg" alt="Hack Club" class="h-8">
                        </a>
                        <NuxtLink to="/" class="text-3xl font-bold text-yellow-300 font-title" style="text-shadow: 0 2px 4px rgba(0,0,0,0.4);">Macondo</NuxtLink>
                    </div>

                    <!-- flex-wrap + flex-1 min-w-0 let the strip wrap onto a second row on phones -->
                    <div class="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
                        <NightModeToggle />
                        <ClientOnly>
                            <NotificationBell v-if="user" />
                        </ClientOnly>
                        <StreakCounter />
                        <div
                            class="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown"
                        >
                            <img :src="'/images/icons/money.webp'" class="w-4 h-4 md:w-5 md:h-5 object-contain" alt="Gold">
                            <span class="text-xs sm:text-sm md:text-base font-bold text-ds-brown">{{ formatGold(gold) }}</span>
                            <span
                                v-if="earningRate?.gold_per_hour != null"
                                class="text-[10px] md:text-xs font-bold text-ds-brown/45 whitespace-nowrap"
                                :title="$t('dashboard.earning_rate_title', { n: earningRate.gold_per_hour })"
                            >~{{ earningRate.gold_per_hour }}/hr</span>
                        </div>
                        <div
                            class="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown"
                            :title="$t('dashboard.starfruit_title')"
                        >
                            <img src="/images/fruits/starfruit.webp" class="w-4 h-4 md:w-5 md:h-5 object-contain" alt="Starfruit">
                            <span class="text-xs sm:text-sm md:text-base font-bold text-ds-brown">{{ starfruit }}</span>
                        </div>
                        <div
                            v-if="tutorialInProgress"
                            class="hidden sm:flex items-center relative"
                        >
                            <button
                                class="flex items-center justify-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-tuscan-sun-400 border-[3px] border-ds-brown text-xs sm:text-sm md:text-base font-bold text-ds-brown hover:brightness-95 transition-all duration-200 animate-pulse-subtle whitespace-nowrap"
                                :title="$t('dashboard.continue_tutorial_title')"
                                @click="continueTutorial"
                            >
                                <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                                {{ $t("dashboard.back_to_tutorial") }}
                            </button>
                        </div>
                        <NuxtLink
                            to="/docs"
                            class="flex items-center justify-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown text-xs sm:text-sm md:text-base font-bold text-ds-brown hover:bg-parchment transition-colors whitespace-nowrap"
                        >
                            <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {{ $t("nav.docs") }}
                        </NuxtLink>
                    </div>
                </div>
            </div>

            <ClientOnly>
                <HelpWidget v-if="user" />
                <NpsWidget v-if="user" />
                <SubmitDeadlineWidget v-if="user" />

                <!-- desktop only; the href keeps middle-click and /achievements working -->
                <a
                    v-if="user"
                    href="/achievements"
                    class="fixed bottom-6 right-[15.5rem] md:right-[18rem] z-40 w-12 h-12 md:w-16 md:h-16 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown text-ds-brown hidden md:flex items-center justify-center shadow-xl hover:bg-parchment active:scale-95 transition-all"
                    :aria-label="$t('achievements.title')"
                    :title="$t('achievements.title')"
                    @click.prevent="showAchievementsModal = true"
                >
                    <Trophy class="w-6 h-6 md:w-8 md:h-8" />
                </a>

            </ClientOnly>

            <div class="absolute inset-0 pointer-events-none z-[100]">

                <!-- dev only; top-left so it doesn't cover the bottom HUD buttons -->
                <div v-if="isDev" class="pointer-events-auto absolute top-20 left-4 flex flex-col items-start gap-2">
                    <div class="flex max-w-[26rem] flex-wrap justify-start gap-2 border-[2px] border-zinc-700 bg-zinc-950/85 p-2 text-[11px] font-semibold text-zinc-200 shadow-xl backdrop-blur">
                        <label
                            v-for="option in devDebugFlagOptions"
                            :key="option.key"
                            class="flex items-center gap-1.5 whitespace-nowrap"
                            :title="option.title"
                        >
                            <input
                                class="sr-only"
                                type="checkbox"
                                :checked="devDebugFlags[option.key]"
                                :disabled="devDebugFlagsLoading || devDebugFlagsSaving !== null"
                                @change="toggleDevDebugFlag(option.key)"
                            >
                            <span
                                class="relative h-3.5 w-7 rounded-full border transition-colors"
                                :class="devDebugFlags[option.key]
                                    ? 'border-emerald-400 bg-emerald-500/80'
                                    : 'border-zinc-500 bg-zinc-800'"
                            >
                                <span
                                    class="absolute top-0.5 h-2 w-2 rounded-full bg-white transition-transform"
                                    :class="devDebugFlags[option.key] ? 'translate-x-4' : 'translate-x-0.5'"
                                />
                            </span>
                            <span>{{ option.label }}</span>
                        </label>
                    </div>
                    <div class="flex gap-2">
                        <button
                            class="px-3 py-1.5 bg-red-900/80 text-red-200 text-xs font-semibold rounded hover:bg-red-800 transition-colors disabled:opacity-50"
                            :disabled="nuking"
                            @click="nukeAccount"
                        >
                            {{ nuking ? 'Nuking...' : 'Nuke (Dev)' }}
                        </button>
                    </div>
                </div>
            </div>

            <Teleport v-if="showWelcome" to="body">
                <div class="fixed inset-0 z-[300]">
                    <div class="absolute inset-0 bg-black/50" @click="dismissWelcome" />
                    <div class="fixed inset-0 z-[301] flex items-center justify-center pointer-events-none">
                        <WoodFrame class="w-full max-w-md mx-4 pointer-events-auto">
                            <div class="p-6 sm:p-8 flex flex-col items-center gap-4 text-center">
                                <img :src="'/images/orpheus/orpheus_coding.webp'" class="w-32 h-32 object-contain" alt="">
                                <h2 class="text-xl font-bold text-ds-brown">{{ $t("dashboard.welcome_live_title") }}</h2>
                                <p class="text-sm text-ds-brown/70 leading-relaxed">
                                    {{ $t("dashboard.welcome_live_body1") }}
                                </p>
                                <p class="text-sm text-ds-brown/70 leading-relaxed">
                                    {{ $t("dashboard.welcome_live_body2") }}
                                </p>
                                <button class="ds-btn-primary w-full mt-2" @click="dismissWelcome">
                                    {{ $t("dashboard.welcome_live_cta") }}
                                </button>
                            </div>
                        </WoodFrame>
                    </div>
                </div>
            </Teleport>

            <GameWindow
                v-for="win in windows"
                :id="win.id"
                :key="win.id"
                :url="win.url"
                :position="win.position"
                :size="win.size"
                :z-index="win.zIndex"
                @close="closeWindow"
                @focus="focusWindow"
                @update:position="updatePosition"
                @update:size="updateSize"
            />

            <!-- v-if on Teleport would destroy the Transition before its leave animation -->
            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="activeProjectId"
                        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
                        @click="activeProjectId = null"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="activeProjectId"
                        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
                    >
                        <WoodFrame class="modal-frame relative w-full max-w-6xl mx-4 pointer-events-auto max-h-[90vh]">
                            <ProjectPage
                                :key="activeProjectId"
                                :embedded-project-id="activeProjectId"
                                :embedded-windowed="true"
                                @close="activeProjectId = null"
                            />
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="showProfileModal"
                        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
                        @click="showProfileModal = false"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="showProfileModal"
                        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
                    >
                        <WoodFrame class="modal-frame relative w-full max-w-6xl mx-4 pointer-events-auto max-h-[90vh]">
                            <ProfilePage
                                :embedded-windowed="true"
                                @close="showProfileModal = false"
                            />
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="showShortcutsHelp"
                        class="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm"
                        @click="showShortcutsHelp = false"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="showShortcutsHelp"
                        class="fixed inset-0 z-[301] flex items-center justify-center pointer-events-none p-4"
                    >
                        <WoodFrame class="relative w-full max-w-sm mx-4 pointer-events-auto">
                            <div class="flex items-center justify-between mb-4">
                                <h2 class="text-lg font-bold text-ds-brown">{{ $t("dashboard.shortcuts.title") }}</h2>
                                <button
                                    type="button"
                                    class="text-ds-brown/60 hover:text-ds-brown transition-colors"
                                    :aria-label="$t('common.close')"
                                    @click="showShortcutsHelp = false"
                                >
                                    <X :size="20" />
                                </button>
                            </div>
                            <ul class="flex flex-col gap-2 text-sm text-ds-brown">
                                <li class="flex items-center justify-between gap-3">
                                    <span>{{ $t("dashboard.shortcuts.open_shop") }}</span>
                                    <kbd class="px-2 py-0.5 border-2 border-ds-brown bg-ds-brown/10 text-xs font-bold">S</kbd>
                                </li>
                                <li class="flex items-center justify-between gap-3">
                                    <span>{{ $t("dashboard.shortcuts.open_profile") }}</span>
                                    <kbd class="px-2 py-0.5 border-2 border-ds-brown bg-ds-brown/10 text-xs font-bold">P</kbd>
                                </li>
                                <li class="flex items-center justify-between gap-3">
                                    <span>{{ $t("dashboard.shortcuts.open_explore") }}</span>
                                    <kbd class="px-2 py-0.5 border-2 border-ds-brown bg-ds-brown/10 text-xs font-bold">E</kbd>
                                </li>
                                <li class="flex items-center justify-between gap-3">
                                    <span>{{ $t("dashboard.shortcuts.open_project") }}</span>
                                    <kbd class="px-2 py-0.5 border-2 border-ds-brown bg-ds-brown/10 text-xs font-bold">1-9</kbd>
                                </li>
                            </ul>
                            <p class="mt-4 text-xs text-ds-brown/55">{{ $t("dashboard.shortcuts.hint") }}</p>
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="showShopModal"
                        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
                        @click="closeShopModal"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="showShopModal"
                        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
                    >
                        <WoodFrame class="modal-frame relative w-full max-w-6xl mx-4 pointer-events-auto max-h-[90vh]">
                            <ShopPage
                                :embedded-windowed="true"
                                @close="closeShopModal"
                            />
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="showAchievementsModal"
                        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
                        @click="showAchievementsModal = false"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="showAchievementsModal"
                        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
                    >
                        <WoodFrame class="modal-frame relative w-full max-w-4xl mx-4 pointer-events-auto max-h-[90vh]">
                            <AchievementsPage
                                :embedded-windowed="true"
                                @close="showAchievementsModal = false"
                            />
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

            <!-- project/profile clicks navigate inside this frame via ExplorePage's nav stack -->
            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="showExploreModal"
                        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
                        @click="showExploreModal = false"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="showExploreModal"
                        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
                    >
                        <WoodFrame class="modal-frame relative w-full max-w-6xl mx-4 pointer-events-auto max-h-[90vh]">
                            <ExplorePage
                                :embedded-windowed="true"
                                @close="showExploreModal = false"
                            />
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

            <Teleport to="body">
                <Transition name="backdrop" appear>
                    <div
                        v-if="showSupportModal"
                        class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm"
                        @click="closeSupportModal"
                    />
                </Transition>
                <Transition name="modal-content" appear>
                    <div
                        v-if="showSupportModal"
                        class="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
                    >
                        <WoodFrame class="modal-frame relative w-full max-w-3xl mx-4 pointer-events-auto max-h-[90vh]">
                            <SupportDetailPage
                                v-if="supportTicketId"
                                :key="supportTicketId"
                                :embedded-windowed="true"
                                :ticket-id="supportTicketId"
                                @close="closeSupportModal"
                                @back="backToSupportList"
                            />
                            <SupportListPage
                                v-else
                                :embedded-windowed="true"
                                @close="closeSupportModal"
                                @open-ticket="openSupportTicket"
                            />
                        </WoodFrame>
                    </div>
                </Transition>
            </Teleport>

        </template>


        <AnnouncementPopup />
    </div>
</template>

<style scoped>
.backdrop-enter-active {
  transition: opacity 0.25s ease-out;
}
.backdrop-leave-active {
  transition: opacity 0.2s ease-in;
}
.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}

.modal-content-enter-active {
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}
.modal-content-leave-active {
  transition: opacity 0.2s ease-in, transform 0.2s ease-in;
}
.modal-content-enter-from {
  opacity: 0;
  transform: scale(0.95);
}
.modal-content-leave-to {
  opacity: 0;
  transform: scale(0.97);
}

/* only the leave is animated; the overlay renders black on first paint */
.fade-black-leave-active {
  transition: opacity 0.18s ease;
}
.fade-black-leave-to {
  opacity: 0;
}

.modal-frame {
  height: 80vh;
  overflow: hidden;
}
</style>
