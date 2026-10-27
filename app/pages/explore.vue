<script setup lang="ts">
import { ChevronDown, Search } from "lucide-vue-next";
import { fruits as fruitDefs } from "~/data/fruitLevels";
import ProjectExploreCard, { type ProjectExploreItem } from "~/components/ProjectExploreCard.vue";
import PersonExploreCard, { type PersonExploreItem } from "~/components/PersonExploreCard.vue";

const ProjectPage = defineAsyncComponent(() => import("~/pages/projects/[id].vue"));
const PublicProfilePage = defineAsyncComponent(() => import("~/pages/u/[username].vue"));

// gsap + Flip load on demand to keep the bundle light; Flip is registered on first load.
let gsapBundle: Promise<{
  gsap: typeof import("gsap").gsap;
  Flip: typeof import("gsap/Flip").Flip;
}> | null = null;
function loadGsap() {
  if (!gsapBundle) {
    gsapBundle = Promise.all([
      import("gsap"),
      import("gsap/Flip"),
    ]).then(([gsapMod, flipMod]) => {
      gsapMod.gsap.registerPlugin(flipMod.Flip);
      return { gsap: gsapMod.gsap, Flip: flipMod.Flip };
    });
  }
  return gsapBundle;
}

definePageMeta({
    layout: false,
});

const props = defineProps<{
    embeddedWindowed?: boolean;
}>();

const emit = defineEmits<{
    close: [];
    'open-project': [id: number];
    'open-person': [usernameOrId: string];
}>();

const route = useRoute();
const { user, isLoggedIn, signIn } = useAuth();
const { t } = useI18n();

const isWindowed = computed(() => !!props.embeddedWindowed || route.query.windowed === "1");

function closeModal() {
    if (props.embeddedWindowed) {
        emit("close");
    } else if (import.meta.client) {
        window.parent.postMessage({ type: "close-modal" }, "*");
    }
}

const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

type Tab = "events" | "projects" | "people" | "leaderboard";
type ProjectSort = "popularity" | "newest" | "recently_updated" | "streak";
type PeopleSort = "popularity" | "newest" | "recently_active" | "streak";
type LeaderboardType = "upvotes" | "hours" | "ships" | "gold" | "referrals";

const tab = ref<Tab>("events");
const leaderboardType = ref<LeaderboardType>("upvotes");

interface LeaderboardRow {
    rank: number;
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
    created_at: string | Date | null;
    metric: number;
    project_count: number;
}

function leaderboardSlackUrl(slackId: string | null): string | null {
    return slackId ? `https://hackclub.slack.com/team/${slackId}` : null;
}

function leaderboardMemberSince(date: string | Date | null): string {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
}

const projectSort = ref<ProjectSort>("recently_updated");
const projectStatusFilter = ref<"shipped" | "all" | "in_progress">("shipped");
const projectTypeFilter = ref<"all" | "software" | "hardware">("all");
const projectFruitFilter = ref<string>("");
const projectLevelFilter = ref<"" | "1" | "2" | "3" | "4">("");
const projectSearch = ref<string>("");

const peopleSort = ref<PeopleSort>("recently_active");
const peopleSearch = ref<string>("");

const PROJECT_TYPE_OPTIONS = ["all", "software", "hardware"] as const;
const PROJECT_STATUS_OPTIONS = ["all", "shipped", "in_progress"] as const;
const LEADERBOARD_TYPE_OPTIONS: LeaderboardType[] = [
    "upvotes",
    "hours",
    "ships",
    "gold",
    "referrals",
];

// the per-type payload cache makes toggling between leaderboard types instant.
const leaderboardItems = ref<LeaderboardRow[]>([]);
const leaderboardLoading = ref(false);
let leaderboardRequestId = 0;

async function loadLeaderboard() {
    const requestId = ++leaderboardRequestId;
    leaderboardLoading.value = true;
    try {
        const key = `explore:leaderboard:${leaderboardType.value}`;
        const cached = useNuxtApp().payload.data?.[key] as
            | { type: string; items: LeaderboardRow[] }
            | undefined;
        if (cached) {
            leaderboardItems.value = cached.items;
            return;
        }
        const data = await $fetch<{ type: string; items: LeaderboardRow[] }>(
            "/api/explore/leaderboard",
            { query: { type: leaderboardType.value, limit: 50 } },
        );
        if (requestId !== leaderboardRequestId) return;
        useNuxtApp().payload.data![key] = data;
        // FLIP so a real-time refresh slides rows into their new ranks.
        await captureFlipAndApply(() => {
            leaderboardItems.value = data.items;
        });
    } catch (err) {
        console.error("[explore] leaderboard fetch failed", err);
    } finally {
        leaderboardLoading.value = false;
    }
}

watch(leaderboardType, () => {
    if (isHydrating) return;
    if (tab.value === "leaderboard") void loadLeaderboard();
});

const PODIUM_STYLES = [
    { tint: "text-yellow-500", border: "border-yellow-600", label: "1st" },
    { tint: "text-zinc-400", border: "border-zinc-500", label: "2nd" },
    { tint: "text-orange-700", border: "border-orange-700", label: "3rd" },
];

function formatMetric(value: number, type: LeaderboardType): string {
    if (type === "hours") return `${Math.round(value).toLocaleString()}h`;
    if (type === "gold") return Math.round(value).toLocaleString();
    return Math.round(value).toLocaleString();
}

function metricLabel(type: LeaderboardType): string {
    if (type === "hours") return t("leaderboard.metric.hours");
    if (type === "ships") return t("leaderboard.metric.ships");
    if (type === "gold") return t("leaderboard.metric.gold");
    if (type === "referrals") return t("leaderboard.metric.referrals");
    return t("leaderboard.metric.upvotes");
}

function openTopPerson(id: string) {
    if (isWindowed.value) {
        pushNav({ kind: "profile", handle: id });
    } else {
        void navigateTo(`/u/${id}`);
    }
}

const projectItems = ref<ProjectExploreItem[]>([]);
const peopleItems = ref<PersonExploreItem[]>([]);
const projectNextCursor = ref<number | null>(null);
const peopleNextCursor = ref<number | null>(null);
const projectLoading = ref(false);
const peopleLoading = ref(false);
const projectError = ref<string | null>(null);
const peopleError = ref<string | null>(null);

interface EventExploreItem {
    id: number;
    title: string;
    description: string | null;
    image_url: string | null;
    rsvp_url: string | null;
    starts_at: string | null;
    ends_at: string | null;
    timezone: string | null;
    attendee_count: number;
    rsvp_status: string | null;
}
const eventItems = ref<EventExploreItem[]>([]);
const eventNextCursor = ref<number | null>(null);
const eventLoading = ref(false);
const eventRsvpBusy = ref<number | null>(null);
// event cards link here for discussion unless the event has its own rsvp_url.
const MACONDO_CHANNEL_URL = "https://hackclub.slack.com/archives/C0AUZ1LAMH6";

const fruitOptions = computed(() => fruitDefs.map((f) => f.name));

function projectQueryParams(cursor: number | null): Record<string, string | number> {
    const params: Record<string, string | number> = {
        sort: projectSort.value,
        status: projectStatusFilter.value,
        limit: 24,
    };
    if (projectTypeFilter.value !== "all") params.type = projectTypeFilter.value;
    if (projectFruitFilter.value) params.fruit = projectFruitFilter.value;
    if (projectLevelFilter.value) params.level = projectLevelFilter.value;
    if (projectSearch.value.trim()) params.search = projectSearch.value.trim();
    if (cursor != null) params.cursor = cursor;
    return params;
}

function peopleQueryParams(cursor: number | null): Record<string, string | number> {
    const params: Record<string, string | number> = {
        sort: peopleSort.value,
        limit: 24,
    };
    if (peopleSearch.value.trim()) params.search = peopleSearch.value.trim();
    if (cursor != null) params.cursor = cursor;
    return params;
}

const gridRef = ref<HTMLElement | null>(null);
const projectSentinel = ref<HTMLElement | null>(null);
const peopleSentinel = ref<HTMLElement | null>(null);

async function captureFlipAndApply<T>(mutate: () => T): Promise<T> {
    if (!import.meta.client || prefersReducedMotion()) return mutate();
    const grid = gridRef.value;
    if (!grid) return mutate();
    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-card-id]"));
    if (cards.length === 0) return mutate();
    for (const el of cards) {
        el.style.transition = "none";
        el.style.transform = "none";
    }
    const { Flip, gsap } = await loadGsap();
    const state = Flip.getState(cards);
    const result = mutate();
    await nextTick();
    Flip.from(state, {
        duration: 0.4,
        ease: "power2.inOut",
        onEnter: (els) =>
            gsap.fromTo(
                els,
                { opacity: 0, scale: 0.94 },
                { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" },
            ),
        onLeave: (els) =>
            gsap.to(els, { opacity: 0, scale: 0.94, duration: 0.25 }),
        onComplete: () => {
            const after = grid
                ? Array.from(grid.querySelectorAll<HTMLElement>("[data-card-id]"))
                : [];
            for (const el of after) {
                el.style.transition = "";
                el.style.transform = "";
            }
        },
    });
    return result;
}

let projectsRequestId = 0;
async function loadProjects(opts: { append?: boolean } = {}) {
    // only appends dedupe; other calls must bump the generation so the latest filters win.
    if (opts.append && projectLoading.value) return;
    const requestId = ++projectsRequestId;
    projectLoading.value = true;
    projectError.value = null;
    try {
        const cursor = opts.append ? projectNextCursor.value : null;
        if (opts.append && cursor == null) {
            return;
        }
        const data = await $fetch<{ items: ProjectExploreItem[]; next_cursor: number | null }>(
            "/api/explore/projects",
            { query: projectQueryParams(cursor) },
        );
        if (requestId !== projectsRequestId) return;
        if (opts.append) {
            await captureFlipAndApply(() => {
                projectItems.value = [...projectItems.value, ...data.items];
            });
        } else {
            await captureFlipAndApply(() => {
                projectItems.value = data.items;
            });
        }
        projectNextCursor.value = data.next_cursor;
    } catch (err) {
        if (requestId !== projectsRequestId) return;
        console.error("[explore] project fetch failed", err);
        projectError.value = "load_failed";
    } finally {
        if (requestId === projectsRequestId) {
            projectLoading.value = false;
        }
    }
}

let peopleRequestId = 0;
async function loadPeople(opts: { append?: boolean } = {}) {
    if (opts.append && peopleLoading.value) return;
    const requestId = ++peopleRequestId;
    peopleLoading.value = true;
    peopleError.value = null;
    try {
        const cursor = opts.append ? peopleNextCursor.value : null;
        if (opts.append && cursor == null) {
            return;
        }
        const data = await $fetch<{ items: PersonExploreItem[]; next_cursor: number | null }>(
            "/api/explore/people",
            { query: peopleQueryParams(cursor) },
        );
        if (requestId !== peopleRequestId) return;
        if (opts.append) {
            await captureFlipAndApply(() => {
                peopleItems.value = [...peopleItems.value, ...data.items];
            });
        } else {
            await captureFlipAndApply(() => {
                peopleItems.value = data.items;
            });
        }
        peopleNextCursor.value = data.next_cursor;
    } catch (err) {
        if (requestId !== peopleRequestId) return;
        console.error("[explore] people fetch failed", err);
        peopleError.value = "load_failed";
    } finally {
        if (requestId === peopleRequestId) {
            peopleLoading.value = false;
        }
    }
}

let eventsRequestId = 0;
async function loadEvents(opts: { append?: boolean } = {}) {
    if (opts.append && eventLoading.value) return;
    const requestId = ++eventsRequestId;
    eventLoading.value = true;
    try {
        const cursor = opts.append ? eventNextCursor.value : null;
        if (opts.append && cursor == null) return;
        const params: Record<string, string | number> = { limit: 24 };
        if (cursor != null) params.cursor = cursor;
        const data = await $fetch<{ items: EventExploreItem[]; next_cursor: number | null }>(
            "/api/explore/events",
            { query: params },
        );
        if (requestId !== eventsRequestId) return;
        eventItems.value = opts.append ? [...eventItems.value, ...data.items] : data.items;
        eventNextCursor.value = data.next_cursor;
    } catch (err) {
        if (requestId !== eventsRequestId) return;
        console.error("[explore] events fetch failed", err);
    } finally {
        if (requestId === eventsRequestId) eventLoading.value = false;
    }
}

async function rsvpEvent(item: EventExploreItem) {
    if (!isLoggedIn.value) {
        signIn();
        return;
    }
    if (eventRsvpBusy.value === item.id) return;
    const wasInterested = item.rsvp_status === "interested";
    const next = wasInterested ? "not_interested" : "interested";
    eventRsvpBusy.value = item.id;
    try {
        await $fetch(`/api/events/${item.id}/rsvp`, {
            method: "POST",
            body: { status: next },
        });
        item.rsvp_status = next;
        item.attendee_count = Math.max(0, item.attendee_count + (wasInterested ? -1 : 1));
    } catch (err) {
        console.error("[explore] rsvp failed", err);
    } finally {
        eventRsvpBusy.value = null;
    }
}

function formatEventWhen(item: EventExploreItem): string {
    if (!item.starts_at) return "";
    const d = new Date(item.starts_at);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

let projectSearchTimer: ReturnType<typeof setTimeout> | null = null;
let peopleSearchTimer: ReturnType<typeof setTimeout> | null = null;

watch(projectSearch, () => {
    if (isHydrating) return;
    if (projectSearchTimer) clearTimeout(projectSearchTimer);
    projectSearchTimer = setTimeout(() => {
        if (tab.value === "projects") void loadProjects();
    }, 300);
});

watch(peopleSearch, () => {
    if (isHydrating) return;
    if (peopleSearchTimer) clearTimeout(peopleSearchTimer);
    peopleSearchTimer = setTimeout(() => {
        if (tab.value === "people") void loadPeople();
    }, 300);
});

watch([projectSort, projectStatusFilter, projectTypeFilter, projectFruitFilter, projectLevelFilter], () => {
    if (isHydrating) return;
    if (tab.value === "projects") void loadProjects();
});

watch(peopleSort, () => {
    if (isHydrating) return;
    if (tab.value === "people") void loadPeople();
});

watch(tab, (next) => {
    if (isHydrating) return;
    if (next === "events" && eventItems.value.length === 0) void loadEvents();
    if (next === "projects" && projectItems.value.length === 0) void loadProjects();
    if (next === "people" && peopleItems.value.length === 0) void loadPeople();
    if (next === "leaderboard" && leaderboardItems.value.length === 0) void loadLeaderboard();
});

// loads the next page when a sentinel below the active grid gets within 600px.
let infiniteObserver: IntersectionObserver | null = null;

function attachInfiniteScroll() {
    if (!import.meta.client) return;
    infiniteObserver?.disconnect();
    infiniteObserver = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                if (tab.value === "projects" && projectNextCursor.value != null && !projectLoading.value) {
                    void loadProjects({ append: true });
                }
                if (tab.value === "people" && peopleNextCursor.value != null && !peopleLoading.value) {
                    void loadPeople({ append: true });
                }
            }
        },
        { rootMargin: "600px 0px" },
    );
    if (projectSentinel.value) infiniteObserver.observe(projectSentinel.value);
    if (peopleSentinel.value) infiniteObserver.observe(peopleSentinel.value);
}

onMounted(() => {
    attachInfiniteScroll();
});
onBeforeUnmount(() => {
    infiniteObserver?.disconnect();
    infiniteObserver = null;
});

// sentinels live inside v-if branches, so re-attach whenever the tab changes.
watch(tab, async () => {
    await nextTick();
    attachInfiniteScroll();
});

// the server publishes coarse "explore" events; refetch the visible tab, debounced so bursts
// collapse into one, and once on reconnect to catch anything missed.
let refreshDebounce: ReturnType<typeof setTimeout> | null = null;

function refetchActiveTab() {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (currentView.value.kind !== "grid") return;
    if (tab.value === "projects") void loadProjects();
    else if (tab.value === "people") void loadPeople();
    else if (tab.value === "leaderboard") void loadLeaderboard();
    else if (tab.value === "events") void loadEvents();
}

function scheduleRefetch() {
    if (refreshDebounce) clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(refetchActiveTab, 600);
}

// sessionStorage, not query params: explore runs as a modal inside the dashboard route,
// whose query keys drive other modals.
const FILTER_STORAGE_KEY = "explore.filters.v1";

// suppresses load-triggering watchers during hydration so they don't race the onMounted dispatch.
let isHydrating = false;
// Set when hydrateFiltersFromStorage restored an explicit tab choice, so the
// no-upcoming-events fallback below only overrides the fresh default.
let restoredTabFromStorage = false;
// keeps the no-events auto-switch to Projects from being remembered as a user choice.
let isAutoDefaulting = false;

interface StoredFilters {
    tab?: Tab;
    projectSort?: ProjectSort;
    projectStatusFilter?: "shipped" | "all" | "in_progress";
    projectTypeFilter?: "all" | "software" | "hardware";
    projectFruitFilter?: string;
    projectLevelFilter?: "" | "1" | "2" | "3" | "4";
    projectSearch?: string;
    peopleSort?: PeopleSort;
    peopleSearch?: string;
    leaderboardType?: LeaderboardType;
}

function hydrateFiltersFromStorage() {
    if (!import.meta.client) return;
    isHydrating = true;
    try {
        const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as StoredFilters;
        if (stored.tab && (stored.tab === "events" || stored.tab === "projects" || stored.tab === "people" || stored.tab === "leaderboard")) {
            tab.value = stored.tab;
            restoredTabFromStorage = true;
        }
        if (stored.projectSort) projectSort.value = stored.projectSort;
        if (stored.projectStatusFilter) projectStatusFilter.value = stored.projectStatusFilter;
        if (stored.projectTypeFilter) projectTypeFilter.value = stored.projectTypeFilter;
        if (typeof stored.projectFruitFilter === "string") projectFruitFilter.value = stored.projectFruitFilter;
        if (stored.projectLevelFilter !== undefined) projectLevelFilter.value = stored.projectLevelFilter;
        if (typeof stored.projectSearch === "string") projectSearch.value = stored.projectSearch;
        if (stored.peopleSort) peopleSort.value = stored.peopleSort;
        if (typeof stored.peopleSearch === "string") peopleSearch.value = stored.peopleSearch;
        if (stored.leaderboardType) leaderboardType.value = stored.leaderboardType;
    } catch {
        // Corrupt storage entry; ignore and proceed with defaults.
    } finally {
        // nextTick runs after the pre-flush watcher batch, so each queued watcher still sees isHydrating.
        void nextTick(() => {
            isHydrating = false;
        });
    }
}

function persistFiltersToStorage() {
    if (!import.meta.client) return;
    if (isAutoDefaulting) return;
    try {
        const payload: StoredFilters = {
            tab: tab.value,
            projectSort: projectSort.value,
            projectStatusFilter: projectStatusFilter.value,
            projectTypeFilter: projectTypeFilter.value,
            projectFruitFilter: projectFruitFilter.value,
            projectLevelFilter: projectLevelFilter.value,
            projectSearch: projectSearch.value,
            peopleSort: peopleSort.value,
            peopleSearch: peopleSearch.value,
            leaderboardType: leaderboardType.value,
        };
        sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // sessionStorage may be unavailable (private mode, quota); ignore.
    }
}

watch(
    [
        tab,
        projectSort,
        projectStatusFilter,
        projectTypeFilter,
        projectFruitFilter,
        projectLevelFilter,
        projectSearch,
        peopleSort,
        peopleSearch,
        leaderboardType,
    ],
    () => persistFiltersToStorage(),
);

onMounted(() => {
    // watchers are suppressed during hydration, so dispatch the loader explicitly.
    hydrateFiltersFromStorage();
    if (tab.value === "events") {
        // fall back to Projects when there are no upcoming events, unless Events was restored from storage.
        void (async () => {
            await loadEvents();
            if (!restoredTabFromStorage && eventItems.value.length === 0) {
                isAutoDefaulting = true;
                tab.value = "projects";
                await nextTick();
                isAutoDefaulting = false;
            }
        })();
    } else if (tab.value === "projects") void loadProjects();
    else if (tab.value === "people") void loadPeople();
    else if (tab.value === "leaderboard") void loadLeaderboard();
    if (!import.meta.client) return;
    const rt = useRealtime();
    const offSubscribe = rt.subscribe("explore", () => scheduleRefetch());
    const offReconnect = rt.onReconnect(() => scheduleRefetch());
    onBeforeUnmount(() => {
        if (refreshDebounce) clearTimeout(refreshDebounce);
        offSubscribe();
        offReconnect();
    });
});

const upvoteDisabledReason = computed<string | null>(() => {
    if (!isLoggedIn.value) return t("explore.upvote.login_required");
    if (user.value?.hca_verification_status !== "verified") {
        return t("explore.upvote.verify_required");
    }
    return null;
});

const canUpvote = computed(() => upvoteDisabledReason.value == null);

async function handleUpvote(projectId: number, btnEl: HTMLElement | null, countEl: HTMLElement | null) {
    if (!isLoggedIn.value) {
        signIn();
        return;
    }
    if (!canUpvote.value) return;
    const idx = projectItems.value.findIndex((p) => p.id === projectId);
    if (idx < 0) return;
    const item = projectItems.value[idx]!;
    const prev = {
        upvoted: item.current_user_upvoted,
        count: item.upvote_count,
    };
    const optimistic = {
        upvoted: !prev.upvoted,
        count: prev.upvoted ? prev.count - 1 : prev.count + 1,
    };

    // FLIP only for popularity sort, where the card position changes with upvote_count.
    const apply = () => {
        const next = [...projectItems.value];
        next[idx] = {
            ...item,
            current_user_upvoted: optimistic.upvoted,
            upvote_count: optimistic.count,
        };
        if (projectSort.value === "popularity") {
            next.sort((a, b) => {
                if (b.upvote_count !== a.upvote_count) return b.upvote_count - a.upvote_count;
                const au = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                const bu = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                if (bu !== au) return bu - au;
                return b.id - a.id;
            });
        }
        projectItems.value = next;
    };

    if (projectSort.value === "popularity") {
        await captureFlipAndApply(apply);
    } else {
        apply();
    }

    if (import.meta.client && !prefersReducedMotion()) {
        const { gsap } = await loadGsap();
        if (countEl) {
            gsap.fromTo(
                countEl,
                { scale: 1.4, color: "#FFB774" },
                { scale: 1, color: "#684D3A", duration: 0.4, ease: "back.out(2)", clearProps: "color" },
            );
        }
        if (btnEl) {
            gsap.fromTo(
                btnEl,
                { scale: 0.85 },
                { scale: 1, duration: 0.35, ease: "back.out(1.5)" },
            );
        }
    }

    try {
        const res = await $fetch<{ upvoted: boolean; count: number }>(
            `/api/projects/${projectId}/upvote`,
            { method: "POST" },
        );
        // reconcile in case of a race or a server-suppressed self-upvote.
        const after = projectItems.value.findIndex((p) => p.id === projectId);
        if (after >= 0) {
            projectItems.value[after] = {
                ...projectItems.value[after]!,
                current_user_upvoted: res.upvoted,
                upvote_count: res.count,
            };
        }
    } catch (err) {
        console.error("[explore] upvote failed", err);
        const after = projectItems.value.findIndex((p) => p.id === projectId);
        if (after >= 0) {
            projectItems.value[after] = {
                ...projectItems.value[after]!,
                current_user_upvoted: prev.upvoted,
                upvote_count: prev.count,
            };
        }
    }
}

function isOwner(p: ProjectExploreItem): boolean {
    return !!user.value && user.value.id === p.owner.id;
}

// in the windowed modal, clicks swap the contents; the stack lets Back return to the previous view.
type NavEntry =
    | { kind: "grid" }
    | { kind: "project"; id: number }
    | { kind: "profile"; handle: string };

const navStack = ref<NavEntry[]>([{ kind: "grid" }]);
const currentView = computed(() => navStack.value[navStack.value.length - 1] ?? { kind: "grid" });

const navDirection = ref<"forward" | "backward">("forward");
const transitionName = computed(() =>
    navDirection.value === "forward" ? "slide-left" : "slide-right",
);

function viewKey(entry: NavEntry): string {
    if (entry.kind === "project") return `project-${entry.id}`;
    if (entry.kind === "profile") return `profile-${entry.handle}`;
    return "grid";
}

// the scroll container is window (standalone) or the WoodFrame's inner div (modal), so walk up to find it.
const exploreRootRef = ref<HTMLElement | null>(null);
const gridScrollSnapshot = ref<number>(0);

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
    if (!import.meta.client || !el) return window;
    let cur: HTMLElement | null = el.parentElement;
    while (cur && cur !== document.body) {
        const overflowY = window.getComputedStyle(cur).overflowY;
        if (
            (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
            cur.scrollHeight > cur.clientHeight
        ) {
            return cur;
        }
        cur = cur.parentElement;
    }
    return window;
}

function captureGridScroll() {
    if (!import.meta.client) return;
    const target = findScrollParent(exploreRootRef.value);
    gridScrollSnapshot.value =
        target === window ? window.scrollY : (target as HTMLElement).scrollTop;
}

function restoreGridScroll() {
    if (!import.meta.client) return;
    // double nextTick waits out the out-in Transition so the grid DOM is back.
    void nextTick(() => {
        void nextTick(() => {
            const target = findScrollParent(exploreRootRef.value);
            const y = gridScrollSnapshot.value;
            if (target === window) {
                window.scrollTo({ top: y });
            } else {
                (target as HTMLElement).scrollTop = y;
            }
        });
    });
}

function pushNav(entry: NavEntry) {
    if (currentView.value.kind === "grid") {
        captureGridScroll();
    }
    navDirection.value = "forward";
    navStack.value = [...navStack.value, entry];
}

function popNav() {
    if (navStack.value.length <= 1) {
        closeModal();
        return;
    }
    navDirection.value = "backward";
    navStack.value = navStack.value.slice(0, -1);
    if (currentView.value.kind === "grid") {
        restoreGridScroll();
    }
}

function handleOpenProject(id: number) {
    if (isWindowed.value) {
        pushNav({ kind: "project", id });
    } else {
        emit("open-project", id);
    }
}

function handleOpenPerson(handle: string) {
    if (isWindowed.value) {
        pushNav({ kind: "profile", handle });
    } else {
        emit("open-person", handle);
    }
}
</script>

<template>
    <div ref="exploreRootRef" :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'" class="relative overflow-x-hidden">
        <div class="max-w-6xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-6">
            <NuxtLink
                v-if="!isWindowed"
                to="/dashboard"
                class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t("explore.back") }}
            </NuxtLink>

            <Transition :name="transitionName" mode="out-in">
                <ProjectPage
                    v-if="isWindowed && currentView.kind === 'project'"
                    :key="viewKey(currentView)"
                    :embedded-project-id="currentView.id"
                    :embedded-windowed="true"
                    @close="popNav"
                />
                <PublicProfilePage
                    v-else-if="isWindowed && currentView.kind === 'profile'"
                    :key="viewKey(currentView)"
                    :embedded-windowed="true"
                    :username="currentView.handle"
                    @close="popNav"
                    @open-project="handleOpenProject"
                />
                <div v-else key="grid" class="flex flex-col gap-6">
                    <div v-if="isWindowed" class="flex items-center justify-between gap-4 w-full flex-wrap">
                        <button
                            class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
                            @click="closeModal"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                            </svg>
                            {{ $t("explore.back") }}
                        </button>
                        <a
                            href="/explore"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
                        >
                            {{ $t("explore.open_in_new_tab") }}
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </div>
                    <div>
                        <div :class="isWindowed && 'pb-4'">
                            <h1 class="text-3xl font-bold text-ds-brown">{{ $t("explore.title") }}</h1>
                            <p class="text-sm text-ds-brown/70 mt-1">{{ $t("explore.subtitle") }}</p>

                            <div class="mt-5 flex gap-1 border-b-2 border-ds-brown/20 flex-wrap">
                                <button
                                    type="button"
                                    class="px-4 py-2 text-sm font-bold border-b-[3px] -mb-[2px] transition-colors"
                                    :class="tab === 'events' ? 'border-ds-brown text-ds-brown' : 'border-transparent text-ds-brown/60 hover:text-ds-brown'"
                                    @click="tab = 'events'"
                                >
                                    {{ $t("explore.tabs.events") }}
                                </button>
                                <button
                                    type="button"
                                    class="px-4 py-2 text-sm font-bold border-b-[3px] -mb-[2px] transition-colors"
                                    :class="tab === 'projects' ? 'border-ds-brown text-ds-brown' : 'border-transparent text-ds-brown/60 hover:text-ds-brown'"
                                    @click="tab = 'projects'"
                                >
                                    {{ $t("explore.tabs.projects") }}
                                </button>
                                <button
                                    type="button"
                                    class="px-4 py-2 text-sm font-bold border-b-[3px] -mb-[2px] transition-colors"
                                    :class="tab === 'people' ? 'border-ds-brown text-ds-brown' : 'border-transparent text-ds-brown/60 hover:text-ds-brown'"
                                    @click="tab = 'people'"
                                >
                                    {{ $t("explore.tabs.people") }}
                                </button>
                                <button
                                    type="button"
                                    class="px-4 py-2 text-sm font-bold border-b-[3px] -mb-[2px] transition-colors"
                                    :class="tab === 'leaderboard' ? 'border-ds-brown text-ds-brown' : 'border-transparent text-ds-brown/60 hover:text-ds-brown'"
                                    @click="tab = 'leaderboard'"
                                >
                                    {{ $t("explore.tabs.leaderboard") }}
                                </button>
                            </div>

                            <div v-if="tab === 'events'" class="mt-4 flex flex-col gap-4">
                                <div
                                    v-if="eventItems.length > 0"
                                    class="grid grid-cols-1 sm:grid-cols-2 gap-3"
                                >
                                    <div
                                        v-for="ev in eventItems"
                                        :key="ev.id"
                                        class="border-[3px] border-ds-brown bg-parchment flex flex-col overflow-hidden"
                                    >
                                        <img
                                            v-if="ev.image_url"
                                            :src="ev.image_url"
                                            alt=""
                                            class="w-full h-36 object-cover border-b-[3px] border-ds-brown"
                                        >
                                        <div class="p-3 flex flex-col gap-2 flex-1">
                                            <h3 class="font-bold text-ds-brown leading-tight">{{ ev.title }}</h3>
                                            <p v-if="formatEventWhen(ev)" class="text-xs font-bold text-ds-brown/80">
                                                {{ formatEventWhen(ev) }}
                                            </p>
                                            <div v-if="ev.description" class="text-xs text-ds-brown/70 max-h-40 overflow-hidden">
                                                <MarkdownContent :source="ev.description" />
                                            </div>
                                            <div class="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                                                <span class="text-xs text-ds-brown/60">
                                                    {{ ev.attendee_count }} {{ $t("explore.events.going") }}
                                                </span>
                                                <div class="flex items-center gap-2">
                                                    <a
                                                        :href="ev.rsvp_url || MACONDO_CHANNEL_URL"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        class="px-3 py-1.5 text-xs font-bold border-[3px] border-ds-brown text-ds-brown bg-parchment hover:bg-ds-brown hover:text-ds-cream transition-colors"
                                                    >
                                                        {{ ev.rsvp_url ? $t("explore.events.rsvp") : $t("explore.events.go_to_channel") }}
                                                    </a>
                                                    <button
                                                        type="button"
                                                        class="px-3 py-1.5 text-xs font-bold border-[3px] transition-colors"
                                                        :class="ev.rsvp_status === 'interested'
                                                            ? 'bg-ds-success border-ds-success text-ds-cream'
                                                            : 'bg-parchment border-ds-brown text-ds-brown hover:bg-ds-brown hover:text-ds-cream'"
                                                        :disabled="eventRsvpBusy === ev.id"
                                                        @click="rsvpEvent(ev)"
                                                    >
                                                        {{ ev.rsvp_status === 'interested' ? $t("explore.events.going_label") : $t("explore.events.interested") }}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <p v-else-if="!eventLoading" class="text-sm text-ds-brown/60 py-8 text-center">
                                    {{ $t("explore.events.empty") }}
                                </p>
                                <p v-if="eventLoading" class="text-xs text-ds-brown/50 text-center py-3">
                                    {{ $t("explore.loading") }}
                                </p>
                                <button
                                    v-if="eventNextCursor != null && !eventLoading"
                                    type="button"
                                    class="self-center px-4 py-1.5 text-xs font-bold bg-parchment border-2 border-ds-brown/30 hover:border-ds-brown text-ds-brown transition-colors"
                                    @click="loadEvents({ append: true })"
                                >
                                    {{ $t("explore.load_more") }}
                                </button>
                            </div>

                            <div v-if="tab === 'projects'" class="mt-4 flex flex-col gap-4">
                                <div class="flex flex-wrap items-center gap-2">
                                    <div class="relative flex-1 min-w-[200px]">
                                        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-brown/50 pointer-events-none" />
                                        <input
                                            v-model="projectSearch"
                                            type="search"
                                            :placeholder="$t('explore.search_projects')"
                                            class="w-full h-10 pl-8 pr-3 text-sm bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown placeholder:text-ds-brown/40"
                                        >
                                    </div>
                                    <select
                                        v-model="projectStatusFilter"
                                        class="h-10 px-3 text-sm font-bold bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown"
                                    >
                                        <option v-for="opt in PROJECT_STATUS_OPTIONS" :key="opt" :value="opt">
                                            {{ $t(`explore.filters.${opt}`) }}
                                        </option>
                                    </select>
                                    <select
                                        v-model="projectTypeFilter"
                                        class="h-10 px-3 text-sm font-bold bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown"
                                    >
                                        <option v-for="opt in PROJECT_TYPE_OPTIONS" :key="opt" :value="opt">
                                            {{ $t(`explore.filters.${opt}`) }}
                                        </option>
                                    </select>
                                    <select
                                        v-model="projectFruitFilter"
                                        class="h-10 px-3 text-sm font-bold bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown"
                                    >
                                        <option value="">{{ $t("explore.filters.any_fruit") }}</option>
                                        <option value="extra_fruity">{{ $t("explore.filters.extra_fruity") }}</option>
                                        <option v-for="f in fruitOptions" :key="f" :value="f">{{ f }}</option>
                                    </select>
                                    <select
                                        v-model="projectLevelFilter"
                                        class="h-10 px-3 text-sm font-bold bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown"
                                    >
                                        <option value="">{{ $t("explore.filters.any_level") }}</option>
                                        <option value="1">L1</option>
                                        <option value="2">L2</option>
                                        <option value="3">L3</option>
                                        <option value="4">L4</option>
                                    </select>
                                    <select
                                        v-model="projectSort"
                                        class="h-10 px-3 text-sm font-bold bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown"
                                    >
                                        <option value="recently_updated">{{ $t("explore.sort.recently_updated") }}</option>
                                        <option value="newest">{{ $t("explore.sort.newest") }}</option>
                                        <option value="popularity">{{ $t("explore.sort.popularity") }}</option>
                                        <option value="streak">{{ $t("explore.sort.streak") }}</option>
                                    </select>
                                </div>

                                <div
                                    v-if="projectItems.length > 0"
                                    ref="gridRef"
                                    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                                >
                                    <ProjectExploreCard
                                        v-for="p in projectItems"
                                        :key="p.id"
                                        :project="p"
                                        :can-upvote="canUpvote"
                                        :upvote-disabled-reason="upvoteDisabledReason"
                                        :is-owner="isOwner(p)"
                                        :as-link="!isWindowed"
                                        @open-project="handleOpenProject"
                                        @open-person="handleOpenPerson"
                                        @upvote="handleUpvote"
                                    />
                                </div>
                                <p v-else-if="!projectLoading" class="text-sm text-ds-brown/60 py-8 text-center">
                                    {{ $t("explore.empty.projects") }}
                                </p>
                                <p v-if="projectLoading" class="text-xs text-ds-brown/50 text-center py-3">
                                    {{ $t("explore.loading") }}
                                </p>
                                <div ref="projectSentinel" aria-hidden="true" class="h-px w-full" />
                                <button
                                    v-if="projectNextCursor != null && !projectLoading"
                                    type="button"
                                    class="self-center px-4 py-1.5 text-xs font-bold bg-parchment border-2 border-ds-brown/30 hover:border-ds-brown text-ds-brown transition-colors"
                                    @click="loadProjects({ append: true })"
                                >
                                    {{ $t("explore.load_more") }}
                                </button>
                            </div>

                            <div v-else-if="tab === 'people'" class="mt-4 flex flex-col gap-4">
                                <div class="flex flex-wrap items-center gap-2">
                                    <div class="relative flex-1 min-w-[200px]">
                                        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ds-brown/50 pointer-events-none" />
                                        <input
                                            v-model="peopleSearch"
                                            type="search"
                                            :placeholder="$t('explore.search_people')"
                                            class="w-full h-10 pl-8 pr-3 text-sm bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown placeholder:text-ds-brown/40"
                                        >
                                    </div>
                                    <select
                                        v-model="peopleSort"
                                        class="h-10 px-3 text-sm font-bold bg-parchment border-2 border-ds-brown/30 focus:border-ds-brown focus:outline-none text-ds-brown"
                                    >
                                        <option value="recently_active">{{ $t("explore.sort.recently_active") }}</option>
                                        <option value="newest">{{ $t("explore.sort.newest") }}</option>
                                        <option value="popularity">{{ $t("explore.sort.popularity") }}</option>
                                        <option value="streak">{{ $t("explore.sort.streak") }}</option>
                                    </select>
                                </div>

                                <div
                                    v-if="peopleItems.length > 0"
                                    ref="gridRef"
                                    class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                                >
                                    <PersonExploreCard
                                        v-for="person in peopleItems"
                                        :key="person.id"
                                        :person="person"
                                        :as-link="!isWindowed"
                                        @open-person="handleOpenPerson"
                                    />
                                </div>
                                <p v-else-if="!peopleLoading" class="text-sm text-ds-brown/60 py-8 text-center">
                                    {{ $t("explore.empty.people") }}
                                </p>
                                <p v-if="peopleLoading" class="text-xs text-ds-brown/50 text-center py-3">
                                    {{ $t("explore.loading") }}
                                </p>
                                <div ref="peopleSentinel" aria-hidden="true" class="h-px w-full" />
                                <button
                                    v-if="peopleNextCursor != null && !peopleLoading"
                                    type="button"
                                    class="self-center px-4 py-1.5 text-xs font-bold bg-parchment border-2 border-ds-brown/30 hover:border-ds-brown text-ds-brown transition-colors"
                                    @click="loadPeople({ append: true })"
                                >
                                    {{ $t("explore.load_more") }}
                                </button>
                            </div>

                            <div v-else-if="tab === 'leaderboard'" class="mt-4 flex flex-col gap-4">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <button
                                        v-for="lt in LEADERBOARD_TYPE_OPTIONS"
                                        :key="lt"
                                        type="button"
                                        class="h-9 px-3 text-xs font-bold border-2 transition-colors"
                                        :class="leaderboardType === lt ? 'bg-ds-brown text-parchment border-ds-brown' : 'bg-parchment text-ds-brown border-ds-brown/30 hover:border-ds-brown'"
                                        @click="leaderboardType = lt"
                                    >
                                        {{ $t(`leaderboard.metric.${lt}`) }}
                                    </button>
                                </div>

                                <p v-if="leaderboardLoading && leaderboardItems.length === 0" class="text-xs text-ds-brown/50 text-center py-3">
                                    {{ $t("explore.loading") }}
                                </p>

                                <!-- one gridRef wrapper so FLIP captures cards across the podium and the list -->
                                <div v-if="leaderboardItems.length > 0" ref="gridRef" class="flex flex-col gap-4">
                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <button
                                        v-for="(person, i) in leaderboardItems.slice(0, 3)"
                                        :key="person.id"
                                        type="button"
                                        :data-card-id="`lb-${person.id}`"
                                        class="flex flex-col items-center gap-2 p-4 border-[3px] bg-parchment hover:bg-ds-brown/5 transition-colors text-center"
                                        :class="PODIUM_STYLES[i]?.border"
                                        @click="openTopPerson(person.id)"
                                    >
                                        <div class="relative">
                                            <div
                                                class="w-20 h-20 rounded-full overflow-hidden border-[3px]"
                                                :class="PODIUM_STYLES[i]?.border"
                                            >
                                                <img
                                                    v-if="person.image"
                                                    :src="person.image"
                                                    :alt="person.username ?? ''"
                                                    class="w-full h-full object-cover"
                                                >
                                                <div
                                                    v-else
                                                    class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-2xl font-bold text-ds-brown"
                                                >{{ (person.username ?? "?").charAt(0).toUpperCase() }}</div>
                                            </div>
                                            <div
                                                class="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 bg-parchment"
                                                :class="[PODIUM_STYLES[i]?.border, PODIUM_STYLES[i]?.tint]"
                                            >{{ PODIUM_STYLES[i]?.label }}</div>
                                        </div>
                                        <div class="flex flex-col items-center w-full min-w-0">
                                            <span class="text-sm font-bold text-ds-brown truncate w-full">{{ person.username ?? "—" }}</span>
                                        </div>
                                        <div class="flex flex-col items-center text-ds-brown">
                                            <span class="text-xl font-bold tabular-nums">{{ formatMetric(person.metric, leaderboardType) }}</span>
                                            <span class="text-[10px] uppercase tracking-wider text-ds-brown/60">{{ metricLabel(leaderboardType) }}</span>
                                        </div>
                                    </button>
                                </div>

                                <ol v-if="leaderboardItems.length > 3" class="flex flex-col divide-y-2 divide-ds-brown/10 border-2 border-ds-brown/10">
                                    <button
                                        v-for="person in leaderboardItems.slice(3)"
                                        :key="person.id"
                                        type="button"
                                        :data-card-id="`lb-${person.id}`"
                                        class="flex items-center gap-3 px-3 py-2 hover:bg-ds-brown/5 transition-colors text-left"
                                        @click="openTopPerson(person.id)"
                                    >
                                        <span class="w-7 text-right text-xs font-bold text-ds-brown/50 tabular-nums">#{{ person.rank }}</span>
                                        <div class="w-8 h-8 rounded-full overflow-hidden border-2 border-ds-brown/30 shrink-0">
                                            <img
                                                v-if="person.image"
                                                :src="person.image"
                                                :alt="person.username ?? ''"
                                                class="w-full h-full object-cover"
                                            >
                                            <div
                                                v-else
                                                class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-xs font-bold text-ds-brown"
                                            >{{ (person.username ?? "?").charAt(0).toUpperCase() }}</div>
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <p class="text-sm font-bold text-ds-brown truncate">{{ person.username ?? "—" }}</p>
                                        </div>
                                        <span class="text-sm font-bold text-ds-brown tabular-nums shrink-0">{{ formatMetric(person.metric, leaderboardType) }}</span>
                                    </button>
                                </ol>
                                </div>

                                <p v-if="!leaderboardLoading && leaderboardItems.length === 0" class="text-sm text-ds-brown/60 py-8 text-center">
                                    {{ $t("leaderboard.empty") }}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>
        </div>
    </div>
</template>

<style scoped>
/* mirrors the shop pager swipe; out-in gives each phase its own 160ms */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
    transition:
        transform 0.16s cubic-bezier(0.22, 1, 0.36, 1),
        opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform, opacity;
}
.slide-left-enter-from {
    transform: translateX(24px);
    opacity: 0;
}
.slide-left-leave-to {
    transform: translateX(-24px);
    opacity: 0;
}
.slide-right-enter-from {
    transform: translateX(-24px);
    opacity: 0;
}
.slide-right-leave-to {
    transform: translateX(24px);
    opacity: 0;
}
</style>
