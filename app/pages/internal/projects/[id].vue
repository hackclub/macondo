<script setup lang="ts">
import HTMLSanitizer from "~/utils/sanitize";
import MarkdownIt from "markdown-it";

definePageMeta({
    layout: "internal",
});

type ProjectAuditEntry = {
    id: number;
    action: string;
    entity_id: string;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    public_message: string | null;
    change_summary: string | null;
    created_at: string | null;
    actor: {
        id: string;
        name: string;
        image: string | null;
        username: string | null;
    } | null;
};

type ProjectDetail = {
    project: {
        id: number;
        user_id: string | null;
        name: string;
        description: string;
        fruit: string | null;
        level: string | null;
        stage: number | null;
        demo_url: string | null;
        thumbnail_url: string | null;
        repository_url: string | null;
        type: "software" | "hardware" | null;
        is_fork: boolean | null;
        created_at: string | null;
        updated_at: string | null;
        hackatime_projects: string[] | null;
    };
    owner: {
        id: string;
        name: string;
        email: string | null;
        image: string | null;
        slack_id: string | null;
        username: string | null;
        hackatime_id?: string | null;
    } | null;
    ships: {
        id: number;
        status: string;
        hackatime_hours: number | null;
        override_hours: number | null;
        override_reason: string | null;
        created_at: string | null;
        reviewed_at: string | null;
        assigned_user_id: string | null;
        airtable_record_id: string | null;
        airtableLink: string | null;
        airtableHealth: {
            state: "no_record" | "ok" | "missing_fields" | "fetch_failed";
            recordId?: string;
            airtableUrl?: string;
            missing?: string[];
            error?: string;
        };
    }[];
    journals: {
        id: number;
        short_brief: string;
        long_brief: string;
        hours: number | null;
        created_at: string | null;
        approved: boolean | null;
        reviewed: boolean;
        reviewed_at: string | null;
        reviewed_by: string | null;
        decision_justification: string | null;
        override_hours: number | null;
        override_justification: string | null;
        archived: boolean;
        archived_at: string | null;
        archived_by: string | null;
    }[];
    journalCount: number;
    archivedJournalCount: number;
    audits: ProjectAuditEntry[];
    activityTotals: {
        journal_seconds: number;
        hackatime_seconds: number;
    };
    hackatimeProjectStats: {
        name: string;
        total_seconds: number;
    }[];
    pendingGold: {
        total: number;
        rowCount: number;
    };
    permissions: {
        canFulfillPendingGold: boolean;
    };
};

type JournalItem = ProjectDetail["journals"][number];

const route = useRoute();
const router = useRouter();
const projectId = route.params.id as string;

const pending = ref(true);
const fetchError = ref<unknown>(null);
const data = ref<ProjectDetail | null>(null);
type ProjectAdminTab = "overview" | "journals" | "history";
const activeProjectTab = ref<ProjectAdminTab>("overview");
const auditTimelineExpanded = ref(false);
const retrySyncingShipId = ref<number | null>(null);
const retrySyncErrorByShip = ref<Record<number, string>>({});

// HTML is enabled so authors can embed raw <img> tags; HTMLSanitizer below is the safety boundary.
const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
});

md.core.ruler.after("linkify", "normalize_links", (state) => {
    for (const token of state.tokens) {
        if (token.type !== "inline" || !token.children) continue;
        for (const child of token.children) {
            if (child.type !== "link_open") continue;
            const href = child.attrGet("href");
            if (
                href &&
                !/^https?:\/\//i.test(href) &&
                !/^mailto:/i.test(href) &&
                !/^#/.test(href)
            ) {
                child.attrSet("href", `https://${href}`);
            }
        }
    }
});

const project = computed(() => data.value?.project ?? null);
const owner = computed(() => data.value?.owner ?? null);
const pendingGold = computed(() => data.value?.pendingGold ?? { total: 0, rowCount: 0 });
const canFulfillPendingGold = computed(
    () => data.value?.permissions?.canFulfillPendingGold ?? false,
);
const ships = computed(() => data.value?.ships ?? []);
const journals = computed(() => data.value?.journals ?? []);
const journalCount = computed(() => data.value?.journalCount ?? 0);
const archivedJournalCount = computed(() => data.value?.archivedJournalCount ?? 0);
const audits = computed(() => data.value?.audits ?? []);
const currentShip = computed(() => ships.value[0] ?? null);
const projectAdminTabs = computed<{ id: ProjectAdminTab; label: string; meta: string }[]>(() => [
    {
        id: "overview",
        label: "Overview",
        meta: `${project.value?.type ?? "project"} · ${totalProjectHours.value}h total`,
    },
    {
        id: "journals",
        label: "Journals",
        meta: `${journalCount.value} entries · ${pendingJournalCount.value} pending`,
    },
    {
        id: "history",
        label: "History",
        meta: `${ships.value.length} ships · ${audits.value.length} audit events`,
    },
]);
const totalLoggedHours = computed(() =>
    ships.value.reduce((sum, ship) => sum + (ship.hackatime_hours ?? 0), 0),
);
const requestedJournalHours = computed(() =>
    journals.value.reduce((sum, journal) => sum + (journal.hours ?? 0), 0),
);
const approvedJournalHours = computed(() =>
    journals.value.reduce((sum, journal) => {
        if (!journal.reviewed || !journal.approved) {
            return sum;
        }

        return sum + getApprovedHours(journal);
    }, 0),
);
const hackatimeProjectNames = computed(
    () => project.value?.hackatime_projects ?? [],
);
// Fetched server-side via the owner's OAuth token; names can be missing (Hackatime outage, typo).
const hackatimeStatsByName = computed(() => {
    const map = new Map<string, number>();
    for (const stat of data.value?.hackatimeProjectStats ?? []) {
        map.set(stat.name, stat.total_seconds);
    }
    return map;
});
function formatHackatimeProjectHours(name: string): string | null {
    const seconds = hackatimeStatsByName.value.get(name);
    if (seconds == null) return null;
    return `${(Math.round((seconds / 3600) * 10) / 10).toFixed(1)}h`;
}
// From daily_project_activity: hackatime is streak-credited time (earliest-claim dedupe),
// journals count only un-archived entries.
const hackatimeHoursTotal = computed(() => {
    return Math.round(((data.value?.activityTotals?.hackatime_seconds ?? 0) / 3600) * 10) / 10;
});
const journalHoursTotal = computed(() => {
    return Math.round(((data.value?.activityTotals?.journal_seconds ?? 0) / 3600) * 10) / 10;
});
const totalProjectHours = computed(() => {
    return Math.round((hackatimeHoursTotal.value + journalHoursTotal.value) * 10) / 10;
});

const reviewedJournalCount = computed(
    () => journals.value.filter((journal) => journal.reviewed).length,
);
const pendingJournalCount = computed(
    () => journals.value.filter((journal) => !journal.reviewed).length,
);
const approvedJournalCount = computed(
    () => journals.value.filter((journal) => journal.reviewed && journal.approved).length,
);
const rejectedJournalCount = computed(
    () => journals.value.filter((journal) => journal.reviewed && journal.approved === false).length,
);

async function loadProjectData() {
    const projectData = await $fetch<ProjectDetail>(
        `/api/internal/projects/${projectId}`,
    );

    data.value = projectData;
}

async function retrySyncShipAirtable(shipId: number, force: boolean) {
    if (retrySyncingShipId.value !== null) return;
    retrySyncingShipId.value = shipId;
    if (retrySyncErrorByShip.value[shipId]) {
        const next = { ...retrySyncErrorByShip.value };
        delete next[shipId];
        retrySyncErrorByShip.value = next;
    }
    try {
        await $fetch(`/api/internal/ships/${shipId}/sync-airtable`, {
            method: "POST",
            body: { force },
        });
        await loadProjectData();
    } catch (error) {
        const msg =
            error instanceof Error
                ? error.message
                : typeof error === "object" && error !== null && "statusMessage" in error
                    ? String((error as { statusMessage?: string }).statusMessage)
                    : String(error);
        retrySyncErrorByShip.value = {
            ...retrySyncErrorByShip.value,
            [shipId]: msg,
        };
    } finally {
        retrySyncingShipId.value = null;
    }
}

async function fetchProject() {
    pending.value = true;
    fetchError.value = null;

    try {
        await loadProjectData();
    } catch (error) {
        fetchError.value = error;
    } finally {
        pending.value = false;
    }
}

onMounted(fetchProject);

function goBack() {
    if (import.meta.client && window.history.length > 1) {
        router.back();
        return;
    }

    navigateTo("/internal/shipped");
}

function shipStatusLabel(status: string) {
    switch (status) {
        case "pending_fraud_review":
            return "Fraudsquad Review";
        case "shipped_missing_airtable":
            return "Missing Airtable";
        case "shipped":
            return "Shipped";
        case "pending_second_pass":
            return "Pending second pass";
        default:
            return "Under Review";
    }
}

function shipStatusClass(status: string) {
    switch (status) {
        case "pending_fraud_review":
            return "bg-red-500/10 text-red-400 border-red-500/20";
        case "shipped_missing_airtable":
            return "bg-amber-500/10 text-amber-400 border-amber-500/20";
        case "shipped":
            return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        case "pending_second_pass":
            return "bg-amber-500/10 text-amber-400 border-amber-500/20";
        default:
            return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    }
}

// Red border flags shipped ships with Airtable problems (no record id, fetch failed, missing fields).
type ShipHistoryItem = {
    status: string;
    airtable_record_id?: string | null;
    airtableHealth?: { state: string };
};
function shipBorderClass(ship: ShipHistoryItem) {
    if (!(ship.status === "shipped" || ship.status === "shipped_missing_airtable")) return "border-zinc-800";
    if (!ship.airtable_record_id) return "border-red-500/60";
    if (ship.airtableHealth?.state === "missing_fields") return "border-red-500/60";
    return "border-zinc-800";
}

function journalStatusLabel(journal: JournalItem) {
    if (!journal.reviewed) {
        return "Pending Review";
    }

    if (journal.approved === false) {
        return "Rejected";
    }

    if (journal.approved) {
        return "Approved";
    }

    return "Reviewed";
}

function journalStatusClass(journal: JournalItem) {
    if (!journal.reviewed) {
        return "border-zinc-700 text-zinc-400 bg-zinc-900/60";
    }

    if (journal.approved === false) {
        return "border-red-500/30 bg-red-500/10 text-red-300";
    }

    if (journal.approved) {
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    }

    return "border-blue-500/30 bg-blue-500/10 text-blue-300";
}

function formatAuditTitle(entry: ProjectAuditEntry) {
    return (
        entry.public_message ??
        entry.change_summary ??
        entry.action.replaceAll("_", " ")
    );
}

function changedFields(entry: ProjectAuditEntry) {
    const oldValue = entry.old_value ?? {};
    const newValue = entry.new_value ?? {};
    return [...new Set([
        ...Object.keys(oldValue),
        ...Object.keys(newValue),
    ])].filter((key) => {
        return JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]);
    });
}

function formatFieldValue(value: unknown) {
    if (value == null || value === "") return "Empty";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function renderJournalHtml(markdown: string) {
    return HTMLSanitizer.sanitize(md.render(markdown), {
        ALLOWED_TAGS: [
            "p", "br", "strong", "em", "del", "s", "h1", "h2", "h3", "h4", "h5", "h6",
            "ul", "ol", "li", "pre", "code", "a", "img", "blockquote", "hr",
            "table", "thead", "tbody", "tr", "th", "td",
        ],
        ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "width", "height"],
        ADD_ATTR: ["target", "rel"],
        ALLOW_DATA_ATTR: false,
    }).replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}

function formatJournalDate(value: string | null) {
    return value ? new Date(value).toLocaleString() : "Unknown time";
}

function getApprovedHours(journal: JournalItem) {
    return journal.override_hours ?? journal.hours ?? 0;
}

function getErrorMessage(error: unknown, fallback: string) {
    if (
        typeof error === "object" &&
        error &&
        "data" in error &&
        typeof error.data === "object" &&
        error.data &&
        "statusMessage" in error.data &&
        typeof error.data.statusMessage === "string"
    ) {
        return error.data.statusMessage;
    }

    if (
        typeof error === "object" &&
        error &&
        "statusMessage" in error &&
        typeof error.statusMessage === "string"
    ) {
        return error.statusMessage;
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}

// Supaadmin escape hatch for hardware makers who can't build (e.g. an unaffordable PCB):
// unlocks every pending gold row, mirroring a build-complete approval.
const fulfillModalOpen = ref(false);
const fulfillReason = ref("");
const fulfillSaving = ref(false);
const fulfillError = ref("");

function openFulfillModal() {
    fulfillReason.value = "";
    fulfillError.value = "";
    fulfillModalOpen.value = true;
}

function closeFulfillModal() {
    if (fulfillSaving.value) return;
    fulfillModalOpen.value = false;
}

async function confirmFulfillPendingGold() {
    const reason = fulfillReason.value.trim();
    if (reason.length < 3) {
        fulfillError.value = "A reason is required for the audit trail";
        return;
    }

    fulfillSaving.value = true;
    fulfillError.value = "";

    try {
        await $fetch(`/api/internal/projects/${projectId}/fulfill-pending-gold`, {
            method: "POST",
            body: { reason },
        });
        fulfillModalOpen.value = false;
        await loadProjectData();
    } catch (error) {
        fulfillError.value = getErrorMessage(
            error,
            "Failed to fulfill pending gold.",
        );
    } finally {
        fulfillSaving.value = false;
    }
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-7xl mx-auto flex flex-col gap-6">
            <button
                class="flex items-center gap-2 text-zinc-500 hover:text-white text-sm transition-colors w-fit"
                @click="goBack"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="15 18 9 12 15 6" />
                </svg>
                Back
            </button>

            <div v-if="pending" class="border border-zinc-800 bg-zinc-900/40 p-6">
                <div class="animate-pulse flex flex-col gap-4">
                    <div class="h-7 w-56 bg-zinc-800 rounded" />
                    <div class="h-4 w-full bg-zinc-800 rounded" />
                    <div class="h-4 w-2/3 bg-zinc-800 rounded" />
                </div>
            </div>

            <div
                v-else-if="fetchError || !project"
                class="border border-red-500/20 bg-red-500/5 p-6 text-red-300"
            >
                Failed to load project.
            </div>

            <template v-else>
                <div
                    class="border border-zinc-800 bg-zinc-900/35 p-6 md:p-7 flex flex-col gap-6 overflow-hidden"
                >
                    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
                        <div class="min-w-0 flex flex-col gap-5">
                            <div class="flex flex-col gap-3">
                                <div class="flex items-center gap-3 flex-wrap">
                                    <h1 class="text-3xl md:text-4xl font-bold text-white tracking-tight break-words min-w-0">
                                        {{ project.name }}
                                    </h1>
                                    <span
                                        v-if="project.is_fork"
                                        class="text-[11px] font-medium px-2.5 py-1 border border-zinc-700 text-zinc-300"
                                    >
                                        Fork
                                    </span>
                                </div>
                                <p class="text-zinc-300 text-base max-w-3xl leading-relaxed break-words">
                                    {{ project.description }}
                                </p>
                            </div>
                        </div>

                        <div class="flex flex-col gap-3 self-start lg:-mt-1">
                            <div
                                v-if="owner"
                                class="border border-zinc-800 bg-zinc-900/40 p-5 flex items-center gap-3 min-w-0"
                            >
                                <img
                                    v-if="owner.image"
                                    :src="owner.image"
                                    :alt="owner.name"
                                    class="w-12 h-12 rounded-full border border-zinc-700 bg-black"
                                >
                                <div
                                    v-else
                                    class="w-12 h-12 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-lg font-bold text-zinc-500"
                                >
                                    {{ owner.name?.charAt(0)?.toUpperCase() ?? "?" }}
                                </div>
                                <div class="min-w-0">
                                    <NuxtLink
                                        :to="`/internal/users/${owner.id}`"
                                        class="text-white font-bold hover:text-amber-200 transition-colors block truncate"
                                    >
                                        {{ owner.name }}
                                    </NuxtLink>
                                    <p class="text-xs text-zinc-500 font-mono truncate">
                                        {{ owner.username ?? owner.slack_id ?? owner.id }}
                                    </p>
                                    <p class="text-xs text-zinc-400 truncate">
                                        {{ owner.email ?? "PII hidden" }}
                                    </p>
                                </div>
                            </div>

                            <div class="flex flex-wrap gap-3 text-sm">
                                <a
                                    v-if="project.repository_url"
                                    :href="project.repository_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                                >
                                    Repository
                                </a>
                                <a
                                    v-if="project.demo_url"
                                    :href="project.demo_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                                >
                                    Demo
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="border border-zinc-800 bg-zinc-950/80 p-2 sticky top-20 z-20">
                    <nav class="flex items-stretch gap-1 overflow-x-auto" aria-label="Project admin sections">
                        <button
                            v-for="tab in projectAdminTabs"
                            :key="tab.id"
                            class="min-w-[160px] flex-1 border px-4 py-3 text-left transition-colors"
                            :class="activeProjectTab === tab.id
                                ? 'border-white bg-white text-black'
                                : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600 hover:text-white'"
                            @click="activeProjectTab = tab.id"
                        >
                            <span class="text-sm font-bold">{{ tab.label }}</span>
                            <span
                                class="block mt-1 text-xs"
                                :class="activeProjectTab === tab.id ? 'text-black/60' : 'text-zinc-500'"
                            >
                                {{ tab.meta }}
                            </span>
                        </button>
                    </nav>
                </div>

                <div class="grid grid-cols-1 gap-6">
                    <div v-show="activeProjectTab === 'overview'" class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                            Overview
                        </h2>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Created</span>
                                <span class="text-zinc-300">
                                    {{
                                        project.created_at
                                            ? new Date(project.created_at).toLocaleString()
                                            : "—"
                                    }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Updated</span>
                                <span class="text-zinc-300">
                                    {{
                                        project.updated_at
                                            ? new Date(project.updated_at).toLocaleString()
                                            : "—"
                                    }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Type</span>
                                <span class="text-zinc-300">
                                    {{ project.type ?? "-" }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Level</span>
                                <span class="text-zinc-300">
                                    {{ project.level ?? "—" }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Stage</span>
                                <span class="text-zinc-300">
                                    {{ project.stage ?? "—" }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Fruit</span>
                                <span class="text-zinc-300">
                                    {{ project.fruit ?? "—" }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Total Ships</span>
                                <span class="text-zinc-300">
                                    {{ ships.length }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Journals</span>
                                <span class="text-zinc-300">
                                    {{ journalCount }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Archived Journals</span>
                                <span class="text-zinc-300">
                                    {{ archivedJournalCount }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Logged Hours (snapshotted)</span>
                                <span class="text-zinc-300">
                                    {{ totalLoggedHours }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Hackatime Hours</span>
                                <span class="text-zinc-300">
                                    {{ hackatimeHoursTotal }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Requested Journal Hours</span>
                                <span class="text-zinc-300">
                                    {{ requestedJournalHours }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Approved Journal Hours</span>
                                <span class="text-zinc-300">
                                    {{ approvedJournalHours }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Journal Hours (counted)</span>
                                <span class="text-zinc-300">
                                    {{ journalHoursTotal }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500 font-bold">Total Hours</span>
                                <span class="text-white font-bold">
                                    {{ totalProjectHours }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Reviewed Journals</span>
                                <span class="text-zinc-300">
                                    {{ reviewedJournalCount }}
                                </span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Pending Reviews</span>
                                <span class="text-zinc-300">
                                    {{ pendingJournalCount }}
                                </span>
                            </div>
                            <div
                                v-if="currentShip"
                                class="flex justify-between gap-4"
                            >
                                <span class="text-zinc-500">Current Ship Status</span>
                                <span
                                    class="text-[10px] font-bold tracking-widest px-2 py-1 border w-fit"
                                    :class="shipStatusClass(currentShip.status)"
                                >
                                    {{ shipStatusLabel(currentShip.status) }}
                                </span>
                            </div>
                            <div
                                v-if="currentShip?.airtableLink"
                                class="flex justify-between gap-4"
                            >
                                <span class="text-zinc-500">Airtable</span>
                                <a
                                    :href="currentShip.airtableLink"
                                    target="_blank"
                                    rel="noopener"
                                    class="text-emerald-400 hover:text-emerald-300 underline truncate max-w-[200px]"
                                >
                                    {{ currentShip.airtable_record_id }}
                                </a>
                            </div>
                            <div
                                v-else-if="currentShip && (currentShip.status === 'shipped' || currentShip.status === 'shipped_missing_airtable')"
                                class="flex justify-between gap-4"
                            >
                                <span class="text-zinc-500">Airtable</span>
                                <span class="text-red-400">no record id</span>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="pendingGold.total > 0"
                        v-show="activeProjectTab === 'overview'"
                        class="border border-amber-500/30 bg-amber-500/5 p-5 flex flex-col gap-4"
                    >
                        <div class="flex items-start justify-between gap-4 flex-wrap">
                            <div class="flex flex-col gap-1">
                                <h2 class="text-xs uppercase tracking-widest text-amber-400/80 font-bold">
                                    Pending Gold
                                </h2>
                                <p class="text-xs text-zinc-500 max-w-2xl">
                                    Hardware ship rewards stay locked until a build-complete ship is approved. Fulfill manually only when the maker legitimately cannot build (e.g. a PCB they cannot afford to fabricate). This unlocks every pending row at once, exactly like a build-complete approval.
                                </p>
                            </div>
                            <div class="text-right shrink-0">
                                <p class="text-2xl font-bold text-amber-300">
                                    {{ pendingGold.total }}<span class="text-sm font-normal text-zinc-500"> gold</span>
                                </p>
                                <p class="text-xs text-zinc-500">
                                    {{ pendingGold.rowCount }} pending {{ pendingGold.rowCount === 1 ? "row" : "rows" }}
                                </p>
                            </div>
                        </div>
                        <div v-if="canFulfillPendingGold">
                            <button
                                type="button"
                                class="px-4 py-2 text-sm font-bold border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 transition-colors"
                                @click="openFulfillModal"
                            >
                                Fulfill pending gold
                            </button>
                        </div>
                        <p v-else class="text-xs text-zinc-600 italic">
                            Only a supaadmin can fulfill pending gold.
                        </p>
                    </div>

                    <div v-show="activeProjectTab === 'overview'" class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                        <div class="flex items-start justify-between gap-3 flex-wrap">
                            <div class="flex flex-col gap-1">
                                <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                    Hackatime Projects
                                </h2>
                                <p class="text-xs text-zinc-500 max-w-2xl">
                                    Names linked from <code class="text-zinc-400">projects.hackatime_projects</code>. Time logged under any of these names accrues to this project's totals (subject to the earliest-claim dedupe rule).
                                </p>
                            </div>
                            <a
                                v-if="owner?.hackatime_id"
                                :href="`https://hackatime.hackclub.com/?user=${owner.hackatime_id}`"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-xs text-cyan-300 hover:text-cyan-200 underline w-fit"
                            >
                                Open Hackatime profile →
                            </a>
                        </div>
                        <div
                            v-if="hackatimeProjectNames.length === 0"
                            class="text-zinc-600 text-sm italic"
                        >
                            No Hackatime project names linked.
                        </div>
                        <div v-else class="flex flex-wrap gap-2">
                            <span
                                v-for="hackatimeProject in hackatimeProjectNames"
                                :key="hackatimeProject"
                                class="text-[11px] font-mono px-2 py-0.5 border border-zinc-700 text-zinc-300 inline-flex items-center gap-1.5"
                            >
                                <span>{{ hackatimeProject }}</span>
                                <span
                                    v-if="formatHackatimeProjectHours(hackatimeProject)"
                                    class="text-zinc-500"
                                >
                                    · {{ formatHackatimeProjectHours(hackatimeProject) }}
                                </span>
                            </span>
                        </div>
                    </div>

                </div>

                <div class="flex flex-col gap-6">
                    <div
                        v-show="activeProjectTab === 'journals'"
                        class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                    >
                            <div class="flex items-start justify-between gap-4 flex-wrap">
                                <div class="flex flex-col gap-1">
                                    <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                        Journals
                                    </h2>
                                    <p class="text-xs text-zinc-500 max-w-2xl">
                                        Journal review lives on the dedicated review page. Archived entries stay visible here but are hidden from the public project page.
                                    </p>
                                </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-[10px] font-bold tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                    Pending {{ pendingJournalCount }}
                                </span>
                                <span class="text-[10px] font-bold tracking-widest px-2 py-1 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                    Approved {{ approvedJournalCount }}
                                </span>
                                <span class="text-[10px] font-bold tracking-widest px-2 py-1 border border-red-500/30 bg-red-500/10 text-red-300">
                                    Rejected {{ rejectedJournalCount }}
                                </span>
                                <span class="text-[10px] font-bold tracking-widest px-2 py-1 border border-blue-500/30 bg-blue-500/10 text-blue-300">
                                    Approved Hours {{ approvedJournalHours }}h
                                </span>
                            </div>
                        </div>

                        <div
                            v-if="journals.length === 0"
                            class="text-zinc-600 text-sm italic"
                        >
                            No journal entries recorded for this project yet.
                        </div>

                        <div v-else class="flex flex-col gap-4">
                            <div
                                v-for="journal in journals"
                                :key="journal.id"
                                class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-4"
                            >
                                <div class="flex items-start justify-between gap-4 flex-wrap">
                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2 flex-wrap">
                                            <h3 class="text-lg font-bold text-white break-words">
                                                {{ journal.short_brief }}
                                            </h3>
                                            <span
                                                class="text-[10px] font-bold tracking-widest px-2 py-1 border"
                                                :class="journalStatusClass(journal)"
                                            >
                                                {{ journalStatusLabel(journal) }}
                                            </span>
                                            <span
                                                v-if="journal.archived"
                                                class="text-[10px] font-bold tracking-widest px-2 py-1 border border-amber-500/30 bg-amber-500/10 text-amber-300"
                                            >
                                                Archived
                                            </span>
                                        </div>
                                        <p class="text-xs text-zinc-500 mt-1">
                                            {{ formatJournalDate(journal.created_at) }}
                                            <template v-if="journal.hours != null">
                                                · Requested {{ journal.hours }}h
                                            </template>
                                            <template v-if="journal.reviewed && journal.approved">
                                                · Approved {{ getApprovedHours(journal) }}h
                                            </template>
                                        </p>
                                    </div>
                                </div>

                                <div class="grid grid-cols-1 gap-4 items-start">
                                    <!-- eslint-disable vue/no-v-html -->
                                    <div
                                        class="internal-journal prose prose-invert prose-sm max-w-none text-zinc-200 min-w-0"
                                        v-html="renderJournalHtml(journal.long_brief)"
                                    />
                                    <!-- eslint-enable vue/no-v-html -->
                                </div>

                                <div
                                    v-if="journal.reviewed"
                                    class="border border-zinc-800 bg-zinc-950/40 p-4 flex flex-col gap-2 text-xs min-w-0"
                                >
                                    <p
                                        v-if="journal.reviewed"
                                        class="text-zinc-500"
                                    >
                                        Reviewed {{ formatJournalDate(journal.reviewed_at) }}
                                    </p>
                                    <p
                                        v-if="journal.decision_justification"
                                        class="text-zinc-400 break-all"
                                    >
                                        Internal Notes: {{ journal.decision_justification }}
                                    </p>
                                    <p
                                        v-if="journal.override_justification"
                                        class="text-zinc-400 break-all"
                                    >
                                        Approval Reason: {{ journal.override_justification }}
                                    </p>
                                </div>

                                <p
                                    v-if="journal.archived && journal.archived_at"
                                    class="text-xs text-zinc-500"
                                >
                                    Archived {{ formatJournalDate(journal.archived_at) }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div v-show="activeProjectTab === 'history'" class="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-6">
                        <div
                            class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                        >
                            <button
                                type="button"
                                class="flex items-center justify-between w-full text-left cursor-pointer"
                                @click="auditTimelineExpanded = !auditTimelineExpanded"
                            >
                                <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                    Audit Timeline
                                    <span class="ml-2 text-zinc-600">{{ audits.length }}</span>
                                </h2>
                                <span
                                    class="text-zinc-500 text-xs transition-transform"
                                    :class="{ 'rotate-180': auditTimelineExpanded }"
                                >▼</span>
                            </button>
                            <div
                                v-if="auditTimelineExpanded && audits.length === 0"
                                class="text-zinc-600 text-sm italic"
                            >
                                No audit events recorded for this project yet.
                            </div>
                            <div v-else-if="auditTimelineExpanded" class="flex flex-col gap-4">
                                <div
                                    v-for="entry in audits"
                                    :key="entry.id"
                                    class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3"
                                >
                                    <div class="flex items-start justify-between gap-4 flex-wrap">
                                        <div>
                                            <p class="text-sm font-bold text-white capitalize">
                                                {{ formatAuditTitle(entry) }}
                                            </p>
                                            <p class="text-xs text-zinc-500">
                                                {{
                                                    entry.created_at
                                                        ? new Date(entry.created_at).toLocaleString()
                                                        : "Unknown time"
                                                }}
                                                <template v-if="entry.actor">
                                                    ·
                                                    <NuxtLink
                                                        :to="`/internal/users/${entry.actor.id}`"
                                                        class="text-zinc-300 hover:text-amber-200 transition-colors"
                                                    >
                                                        {{ entry.actor.name }}
                                                    </NuxtLink>
                                                </template>
                                            </p>
                                        </div>
                                        <span
                                            class="text-[10px] font-bold tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400"
                                        >
                                            {{ entry.action.replaceAll("_", " ") }}
                                        </span>
                                    </div>

                                    <p
                                        v-if="entry.change_summary"
                                        class="text-sm text-zinc-300"
                                    >
                                        {{ entry.change_summary }}
                                    </p>

                                    <div
                                        v-if="changedFields(entry).length"
                                        class="flex flex-col gap-2"
                                    >
                                        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                                            Changed Fields
                                        </p>
                                        <div class="flex flex-col gap-2">
                                            <div
                                                v-for="field in changedFields(entry)"
                                                :key="field"
                                                class="border border-zinc-800 bg-zinc-950/60 p-3"
                                            >
                                                <p class="text-xs font-bold text-zinc-200">
                                                    {{ field }}
                                                </p>
                                                <p class="text-xs text-zinc-500 mt-1">
                                                    From:
                                                    {{
                                                        formatFieldValue(
                                                            entry.old_value?.[field],
                                                        )
                                                    }}
                                                </p>
                                                <p class="text-xs text-zinc-300">
                                                    To:
                                                    {{
                                                        formatFieldValue(
                                                            entry.new_value?.[field],
                                                        )
                                                    }}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div
                            class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                        >
                            <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                Ship History
                            </h2>
                            <div
                                v-if="ships.length === 0"
                                class="text-zinc-600 text-sm italic"
                            >
                                This project has not been shipped yet.
                            </div>
                            <div v-else class="flex flex-col gap-3">
                                <div
                                    v-for="ship in ships"
                                    :key="ship.id"
                                    class="border bg-black/20 p-4 flex flex-col gap-2"
                                    :class="shipBorderClass(ship)"
                                >
                                    <div class="flex items-center justify-between gap-3">
                                        <p class="text-sm font-bold text-white">
                                            <InternalEntityRef :id="ship.id" type="ship" />
                                        </p>
                                        <span
                                            class="text-[10px] font-bold tracking-widest px-2 py-1 border"
                                            :class="shipStatusClass(ship.status)"
                                        >
                                            {{ shipStatusLabel(ship.status) }}
                                        </span>
                                    </div>
                                    <p class="text-xs text-zinc-500">
                                        Submitted
                                        {{
                                            ship.created_at
                                                ? new Date(ship.created_at).toLocaleString()
                                                : "unknown"
                                        }}
                                    </p>
                                    <p class="text-xs text-zinc-300">
                                        Hackatime: {{ ship.hackatime_hours ?? 0 }}h
                                        · Override: {{ ship.override_hours ?? 0 }}h
                                    </p>
                                    <p
                                        v-if="ship.override_reason"
                                        class="text-xs text-zinc-400"
                                    >
                                        {{ ship.override_reason }}
                                    </p>
                                    <p class="text-xs text-zinc-500">
                                        Reviewed
                                        {{
                                            ship.reviewed_at
                                                ? new Date(ship.reviewed_at).toLocaleString()
                                                : "not yet"
                                        }}
                                    </p>
                                    <a
                                        v-if="ship.airtableLink"
                                        :href="ship.airtableLink"
                                        target="_blank"
                                        rel="noopener"
                                        class="text-xs text-emerald-400 hover:text-emerald-300 underline truncate"
                                    >
                                        Airtable: {{ ship.airtable_record_id }}
                                    </a>
                                    <p
                                        v-else-if="ship.status === 'shipped_missing_airtable'"
                                        class="text-xs text-amber-400"
                                    >
                                        Airtable sync pending.
                                    </p>
                                    <p
                                        v-else-if="ship.status === 'shipped'"
                                        class="text-xs text-red-400"
                                    >
                                        No Airtable record id stored on this ship.
                                    </p>
                                    <div
                                        v-if="ship.airtableHealth?.state === 'missing_fields'"
                                        class="mt-1 p-2 border border-red-500 bg-red-950/30 text-xs text-red-300"
                                    >
                                        <p class="font-bold mb-1">
                                            Airtable row missing required fields:
                                        </p>
                                        <ul class="list-disc list-inside">
                                            <li v-for="f in ship.airtableHealth.missing" :key="f">
                                                {{ f }}
                                            </li>
                                        </ul>
                                    </div>
                                    <p
                                        v-else-if="ship.airtableHealth?.state === 'fetch_failed'"
                                        class="text-xs text-amber-400"
                                    >
                                        Airtable health check failed: {{ ship.airtableHealth.error }}
                                    </p>
                                    <div
                                        v-if="ship.status === 'shipped_missing_airtable' || (ship.status === 'shipped' && (!ship.airtable_record_id || ship.airtableHealth?.state === 'missing_fields' || ship.airtableHealth?.state === 'fetch_failed'))"
                                        class="mt-2 flex flex-col gap-1"
                                    >
                                        <button
                                            type="button"
                                            :disabled="retrySyncingShipId === ship.id"
                                            class="self-start px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            @click="retrySyncShipAirtable(ship.id, ship.status === 'shipped')"
                                        >
                                            {{ retrySyncingShipId === ship.id ? "Retrying..." : "Retry Airtable Sync" }}
                                        </button>
                                        <p
                                            v-if="retrySyncErrorByShip[ship.id]"
                                            class="text-[11px] text-red-400"
                                        >
                                            {{ retrySyncErrorByShip[ship.id] }}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        <Transition name="modal-fade" appear>
            <div
                v-if="fulfillModalOpen"
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                @click.self="closeFulfillModal"
            >
                <div
                    class="modal-fade-panel relative bg-zinc-950 border border-amber-700/60 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
                >
                    <h2 class="text-amber-200 font-bold text-lg">
                        Fulfill pending gold
                    </h2>
                    <p class="text-zinc-300 text-sm">
                        This unlocks
                        <span class="text-amber-300 font-bold">{{ pendingGold.total }} pending gold</span>
                        on
                        <span class="text-white font-semibold">{{ project?.name }}</span>,
                        the same as approving a build-complete ship. Use this only
                        when the maker legitimately cannot build. The unlock is
                        recorded in the audit log and the maker is notified.
                    </p>
                    <div class="flex flex-col gap-1.5">
                        <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Reason</label>
                        <textarea
                            v-model="fulfillReason"
                            rows="3"
                            placeholder="e.g. Slack ticket: PCB fabrication is $300+ with customs, maker shipped the design instead"
                            class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
                        />
                    </div>
                    <p v-if="fulfillError" class="text-red-400 text-xs">
                        {{ fulfillError }}
                    </p>
                    <div class="flex gap-2 justify-end">
                        <button
                            class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors disabled:opacity-50"
                            :disabled="fulfillSaving"
                            @click="closeFulfillModal"
                        >
                            Cancel
                        </button>
                        <button
                            class="text-sm font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 px-4 py-2 transition-colors disabled:opacity-50"
                            :disabled="fulfillSaving || fulfillReason.trim().length < 3"
                            @click="confirmFulfillPendingGold"
                        >
                            {{ fulfillSaving ? "Fulfilling…" : `Fulfill ${pendingGold.total} gold` }}
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.internal-journal :deep(h1) {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0.5em 0 0.25em;
}

.internal-journal :deep(h2) {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0.5em 0 0.25em;
}

.internal-journal :deep(h3) {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0.5em 0 0.25em;
}

.internal-journal :deep(ul),
.internal-journal :deep(ol) {
    padding-left: 1.5rem;
    margin: 0.5em 0;
}

.internal-journal :deep(ul) {
    list-style-type: disc;
}

.internal-journal :deep(ol) {
    list-style-type: decimal;
}

.internal-journal :deep(li) {
    margin: 0.25em 0;
}

.internal-journal :deep(p) {
    margin: 0.5em 0;
}

.internal-journal :deep(hr) {
    border-top: 1px solid rgb(63 63 70);
    margin: 1em 0;
}

.internal-journal :deep(img) {
    max-width: 100%;
    border-radius: 8px;
    margin: 0.75em 0;
}

.internal-journal :deep(pre) {
    background: rgba(0, 0, 0, 0.45);
    padding: 0.75rem;
    border-radius: 6px;
    overflow-x: auto;
}

.internal-journal :deep(code) {
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 5px;
    border-radius: 3px;
    font-size: 0.9em;
}

.internal-journal :deep(pre code) {
    background: transparent;
    padding: 0;
}

.internal-journal :deep(a) {
    color: rgb(147 197 253);
    text-decoration: underline;
}

.internal-journal :deep(blockquote) {
    border-left: 3px solid rgb(161 161 170);
    padding-left: 1rem;
    color: rgb(212 212 216);
}
</style>
