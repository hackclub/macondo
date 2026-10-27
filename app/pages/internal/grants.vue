<script setup lang="ts">
import type { HcbGrantInfo } from "~/utils/internalOrders";

definePageMeta({ layout: "internal" });

type SendAction = "first_card" | "top_up" | "reissue";

type GrantRow = {
    id: number;
    ship_id: number;
    amount_cents: number;
    status: "queued" | "sent" | "cancelled";
    hcb_grant_id: string | null;
    created_at: string | null;
    sent_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    cancel_fruit_tx_id: number | null;
    reissued_from_id: number | null;
    intended_send_action: SendAction | null;
    hcb_card_replaces_id: string | null;
    prior_hcb_card_id: string | null;
    fruit_spent: boolean;
    project: {
        id: number;
        name: string;
        fruit: string | null;
        level: string | null;
    };
    user: {
        id: string;
        name: string;
        email: string | null;
        slack_id: string | null;
        hcb_email: string | null;
        username?: string | null;
        hackatime_id?: number | null;
    };
};

// NULL means a legacy row from before the column; treat it as 'first_card'.
function effectiveSendAction(grant: GrantRow): SendAction {
    return grant.intended_send_action ?? "first_card";
}

function sendButtonLabel(grant: GrantRow): string {
    switch (effectiveSendAction(grant)) {
        case "top_up":
            return "Send (top up card)";
        case "reissue":
            return "Send (reissue card)";
        case "first_card":
        default:
            return "Send (new card)";
    }
}

function sendActionBadge(grant: GrantRow): { label: string; cls: string } | null {
    const action = effectiveSendAction(grant);
    if (action === "top_up") {
        return {
            label: grant.prior_hcb_card_id
                ? `Top-up of card ${grant.prior_hcb_card_id}`
                : "Top-up of existing card",
            cls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
        };
    }
    if (action === "reissue") {
        return {
            label: grant.prior_hcb_card_id
                ? `Reissue, replaces cancelled card ${grant.prior_hcb_card_id}`
                : "Reissue (prior card cancelled)",
            cls: "border-amber-500/30 bg-amber-500/10 text-amber-200",
        };
    }
    return null;
}

// cancel-card: no payout; cancel-fruit: award equivalent fruit; reverse: un-cancel;
// cancel-reissue: cancel with no payout and queue a fresh grant for the same ship.
type RowAction =
    | "cancel-card"
    | "cancel-fruit"
    | "reverse"
    | "cancel-reissue"
    | null;
type RowState = {
    action: RowAction;
    reason: string;
    loading: boolean;
    error: string | null;
};

const searchQuery = ref("");
const statusFilter = ref<"queued" | "sent" | "cancelled" | "all">("queued");
const grants = ref<GrantRow[]>([]);
const grantsLoading = ref(false);
const grantsError = ref("");

const selectedIds = ref<Set<number>>(new Set());

const rowStates = ref<Record<number, RowState>>({});

function getRowState(grantId: number): RowState {
    return (
        rowStates.value[grantId] ?? {
            action: null,
            reason: "",
            loading: false,
            error: null,
        }
    );
}
function setRowState(grantId: number, patch: Partial<RowState>) {
    const current = getRowState(grantId);
    rowStates.value = {
        ...rowStates.value,
        [grantId]: { ...current, ...patch },
    };
}
function resetRowState(grantId: number) {
    // Rest-spread instead of `delete`, which lints as no-dynamic-delete.
    const { [grantId]: _removed, ...rest } = rowStates.value;
    void _removed;
    rowStates.value = rest;
}

// Lazy: one HCB call per grant on first expand, cached for the life of the row.
type TxState = {
    open: boolean;
    loading: boolean;
    error: string | null;
    info: HcbGrantInfo | null;
};
const txStates = ref<Record<number, TxState>>({});

function getTxState(grantId: number): TxState {
    return (
        txStates.value[grantId] ?? {
            open: false,
            loading: false,
            error: null,
            info: null,
        }
    );
}
function setTxState(grantId: number, patch: Partial<TxState>) {
    const current = getTxState(grantId);
    txStates.value = {
        ...txStates.value,
        [grantId]: { ...current, ...patch },
    };
}

async function toggleTransactions(grant: GrantRow) {
    const state = getTxState(grant.id);
    if (state.open) {
        setTxState(grant.id, { open: false });
        return;
    }
    setTxState(grant.id, { open: true });
    if (state.info || state.loading) return;
    setTxState(grant.id, { loading: true, error: null });
    try {
        const info = await $fetch<HcbGrantInfo>(
            `/api/internal/grants/${grant.id}/transactions`,
        );
        setTxState(grant.id, { loading: false, info });
    } catch (err) {
        setTxState(grant.id, {
            loading: false,
            error: errorMessage(err, "Failed to load transactions"),
        });
    }
}

type BulkAction = "cancel-card" | "cancel-fruit" | null;
const bulkAction = ref<BulkAction>(null);
const bulkReason = ref("");
const bulkLoading = ref(false);
const bulkError = ref<string | null>(null);
const bulkResultsMessage = ref<string | null>(null);

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

async function loadGrants() {
    grantsLoading.value = true;
    grantsError.value = "";
    try {
        const res = await $fetch<{ grants: GrantRow[] }>(
            "/api/internal/grants",
            {
                query: {
                    q: searchQuery.value.trim() || undefined,
                    status: statusFilter.value,
                    limit: 200,
                },
            },
        );
        grants.value = res.grants;
        // Prune selections / row states for grants that no longer appear.
        const visibleIds = new Set(grants.value.map((g) => g.id));
        const nextSelected = new Set<number>();
        for (const id of selectedIds.value) {
            if (visibleIds.has(id)) nextSelected.add(id);
        }
        selectedIds.value = nextSelected;
        const nextRowStates: Record<number, RowState> = {};
        for (const [key, state] of Object.entries(rowStates.value)) {
            const id = Number(key);
            if (visibleIds.has(id)) nextRowStates[id] = state;
        }
        rowStates.value = nextRowStates;
        const nextTxStates: Record<number, TxState> = {};
        for (const [key, state] of Object.entries(txStates.value)) {
            const id = Number(key);
            if (visibleIds.has(id)) nextTxStates[id] = state;
        }
        txStates.value = nextTxStates;
    } catch (err) {
        console.error(err);
        grantsError.value = "Failed to load grants.";
        grants.value = [];
    } finally {
        grantsLoading.value = false;
    }
}

function onSearchInput() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadGrants, 300);
}

function setFilter(next: "queued" | "sent" | "cancelled" | "all") {
    statusFilter.value = next;
    loadGrants();
}

onMounted(() => {
    loadGrants();
});

const selectableGrants = computed(() =>
    grants.value.filter((g) => g.status === "queued" || g.status === "sent"),
);
const allSelectableSelected = computed(
    () =>
        selectableGrants.value.length > 0 &&
        selectableGrants.value.every((g) => selectedIds.value.has(g.id)),
);
const someSelected = computed(() => selectedIds.value.size > 0);
const selectedCount = computed(() => selectedIds.value.size);
const selectedQueuedCount = computed(
    () =>
        grants.value.filter(
            (g) => g.status === "queued" && selectedIds.value.has(g.id),
        ).length,
);

function toggleRow(grant: GrantRow) {
    if (grant.status !== "queued" && grant.status !== "sent") return;
    const next = new Set(selectedIds.value);
    if (next.has(grant.id)) next.delete(grant.id);
    else next.add(grant.id);
    selectedIds.value = next;
}

function toggleSelectAll() {
    if (allSelectableSelected.value) {
        selectedIds.value = new Set();
    } else {
        selectedIds.value = new Set(selectableGrants.value.map((g) => g.id));
    }
}

function clearSelection() {
    selectedIds.value = new Set();
    bulkAction.value = null;
    bulkReason.value = "";
    bulkError.value = null;
}

function formatDollars(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(value: string | null | undefined) {
    if (!value) return "—";
    return new Date(value).toLocaleString();
}

function errorMessage(err: unknown, fallback: string) {
    return (
        (err as { data?: { statusMessage?: string } })?.data?.statusMessage ??
        fallback
    );
}

function startRowAction(grant: GrantRow, action: RowAction) {
    setRowState(grant.id, {
        action,
        reason: "",
        loading: false,
        error: null,
    });
}

function cancelRowAction(grantId: number) {
    resetRowState(grantId);
}

async function sendGrant(grant: GrantRow) {
    setRowState(grant.id, { loading: true, error: null });
    try {
        await $fetch(`/api/internal/grants/${grant.id}/send`, {
            method: "POST",
        });
        resetRowState(grant.id);
        await loadGrants();
    } catch (err) {
        setRowState(grant.id, {
            loading: false,
            error: errorMessage(err, "Failed to send grant"),
        });
    }
}

async function submitRowCancel(grant: GrantRow, awardFruit: boolean) {
    const state = getRowState(grant.id);
    if (!state.reason.trim()) {
        setRowState(grant.id, { error: "A reason is required." });
        return;
    }
    setRowState(grant.id, { loading: true, error: null });
    try {
        await $fetch(`/api/internal/grants/${grant.id}/cancel`, {
            method: "POST",
            body: { reason: state.reason.trim(), awardFruit },
        });
        resetRowState(grant.id);
        await loadGrants();
    } catch (err) {
        setRowState(grant.id, {
            loading: false,
            error: errorMessage(err, "Failed to cancel grant"),
        });
    }
}

async function submitRowReverse(grant: GrantRow) {
    const state = getRowState(grant.id);
    if (!state.reason.trim()) {
        setRowState(grant.id, { error: "A reason is required." });
        return;
    }
    if (grant.fruit_spent) {
        setRowState(grant.id, {
            error: "User has already spent the fallback fruit; cannot reverse.",
        });
        return;
    }
    setRowState(grant.id, { loading: true, error: null });
    try {
        await $fetch(`/api/internal/grants/${grant.id}/reverse`, {
            method: "POST",
            body: { reason: state.reason.trim() },
        });
        resetRowState(grant.id);
        await loadGrants();
    } catch (err) {
        setRowState(grant.id, {
            loading: false,
            error: errorMessage(err, "Failed to reverse grant"),
        });
    }
}

async function reissueGrant(grant: GrantRow) {
    setRowState(grant.id, { loading: true, error: null });
    try {
        await $fetch(`/api/internal/grants/${grant.id}/reissue`, {
            method: "POST",
            body: { reason: null },
        });
        resetRowState(grant.id);
        await loadGrants();
    } catch (err) {
        setRowState(grant.id, {
            loading: false,
            error: errorMessage(err, "Failed to reissue grant"),
        });
    }
}

// Cancels the current card with no payout and queues a fresh grant for the same ship.
async function submitRowReissue(grant: GrantRow) {
    const state = getRowState(grant.id);
    if (!state.reason.trim()) {
        setRowState(grant.id, { error: "A reason is required." });
        return;
    }
    setRowState(grant.id, { loading: true, error: null });
    try {
        await $fetch(`/api/internal/grants/${grant.id}/cancel-and-reissue`, {
            method: "POST",
            body: { reason: state.reason.trim() },
        });
        resetRowState(grant.id);
        await loadGrants();
    } catch (err) {
        setRowState(grant.id, {
            loading: false,
            error: errorMessage(err, "Failed to reissue grant"),
        });
    }
}

function startBulkAction(action: BulkAction) {
    bulkAction.value = action;
    bulkReason.value = "";
    bulkError.value = null;
    bulkResultsMessage.value = null;
}
function cancelBulkAction() {
    bulkAction.value = null;
    bulkReason.value = "";
    bulkError.value = null;
}

async function bulkSend() {
    const queuedIds = grants.value
        .filter((g) => g.status === "queued" && selectedIds.value.has(g.id))
        .map((g) => g.id);
    if (queuedIds.length === 0) {
        bulkError.value = "Select at least one queued grant to send.";
        return;
    }
    bulkLoading.value = true;
    bulkError.value = null;
    bulkResultsMessage.value = null;
    try {
        const res = await $fetch<{
            sent: number;
            failed: number;
            results: { id: number; ok: boolean; error?: string }[];
        }>("/api/internal/grants/bulk-send", {
            method: "POST",
            body: { ids: queuedIds },
        });
        bulkResultsMessage.value = `Sent ${res.sent} grant(s).${
            res.failed > 0 ? ` ${res.failed} failed, see rows below.` : ""
        }`;
        if (res.failed > 0) {
            for (const r of res.results) {
                if (!r.ok) {
                    setRowState(r.id, {
                        error: r.error ?? "Failed to send grant",
                    });
                }
            }
        }
        await loadGrants();
    } catch (err) {
        bulkError.value = errorMessage(err, "Bulk send failed");
    } finally {
        bulkLoading.value = false;
    }
}

async function submitBulkCancel() {
    if (!bulkAction.value) return;
    const awardFruit = bulkAction.value === "cancel-fruit";
    const actionableIds = grants.value
        .filter(
            (g) =>
                (g.status === "queued" || g.status === "sent") &&
                selectedIds.value.has(g.id),
        )
        .map((g) => g.id);
    if (actionableIds.length === 0) {
        bulkError.value = "Select at least one queued or sent grant to cancel.";
        return;
    }
    if (!bulkReason.value.trim()) {
        bulkError.value = "A reason is required.";
        return;
    }
    bulkLoading.value = true;
    bulkError.value = null;
    bulkResultsMessage.value = null;
    try {
        const res = await $fetch<{
            cancelled: number;
            failed: number;
            results: { id: number; ok: boolean; error?: string }[];
        }>("/api/internal/grants/bulk-cancel", {
            method: "POST",
            body: {
                ids: actionableIds,
                reason: bulkReason.value.trim(),
                awardFruit,
            },
        });
        bulkResultsMessage.value = `Cancelled ${res.cancelled} grant(s).${
            res.failed > 0 ? ` ${res.failed} failed, see rows below.` : ""
        }`;
        if (res.failed > 0) {
            for (const r of res.results) {
                if (!r.ok) {
                    setRowState(r.id, {
                        error: r.error ?? "Failed to cancel grant",
                    });
                }
            }
        }
        bulkAction.value = null;
        bulkReason.value = "";
        await loadGrants();
    } catch (err) {
        bulkError.value = errorMessage(err, "Bulk cancel failed");
    } finally {
        bulkLoading.value = false;
    }
}

function statusClass(status: GrantRow["status"]) {
    if (status === "sent")
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    if (status === "queued")
        return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    return "border-zinc-700 bg-zinc-800/40 text-zinc-400";
}

function rowActionLabel(action: RowAction): string {
    switch (action) {
        case "cancel-card":
            return "Cancel card (no payout)";
        case "cancel-fruit":
            return "Cancel and award fruit";
        case "reverse":
            return "Undo cancel";
        case "cancel-reissue":
            return "Cancel current card and reissue";
        default:
            return "";
    }
}

// Undo is a 24h "wrong button" escape hatch; older cancels go through Reissue.
// Mirrors the server check in /api/internal/grants/[id]/reverse.post.ts.
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
function canUndoCancel(grant: GrantRow): boolean {
    if (grant.status !== "cancelled") return false;
    if (grant.fruit_spent) return false;
    if (!grant.cancelled_at) return true; // safety: no timestamp → allow
    const age = Date.now() - new Date(grant.cancelled_at).getTime();
    return age <= UNDO_WINDOW_MS;
}
function undoCancelTooltip(grant: GrantRow): string {
    if (grant.fruit_spent) {
        return "User has already spent the fallback fruit, use Reissue instead.";
    }
    if (grant.cancelled_at) {
        const age = Date.now() - new Date(grant.cancelled_at).getTime();
        if (age > UNDO_WINDOW_MS) {
            return "Undo is only available within 24 hours of the cancel. Use Reissue to create a fresh grant.";
        }
    }
    return "Undoes the cancel. Backs out any fallback fruit awarded. Use this for mistakes made within the last 24 hours.";
}
const REISSUE_TOOLTIP =
    "Creates a fresh queued grant for the same ship. Leaves the original cancel (and any fallback fruit) in place. Use when the cancel was intentional but circumstances changed.";
const REISSUE_ACTIVE_TOOLTIP =
    "Cancels this active card (no payout) and queues a fresh grant for the same ship, ready to Send. Use when the user needs a new grant/card.";
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex flex-col gap-1">
                <h1 class="text-3xl font-bold text-white tracking-tight">Grants</h1>
                <p class="text-zinc-400 text-sm mt-1">
                    Hardware-project funding queue. Review, send, and cancel HCB grants.
                </p>
            </div>

            <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-0">
                    <button
                        v-for="tab in (['queued','sent','cancelled','all'] as const)"
                        :key="tab"
                        class="px-4 py-2 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors"
                        :class="statusFilter === tab ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'"
                        @click="setFilter(tab)"
                    >
                        {{ tab }}
                    </button>
                </div>
                <input
                    v-model="searchQuery"
                    type="search"
                    placeholder="Project, name, email, slack ID, hackatime ID..."
                    class="px-3 py-2 bg-black/40 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 w-80"
                    @input="onSearchInput"
                >
            </div>

            <!-- Reserves its own height so the list below never jumps when it expands. -->
            <div class="min-h-[52px]">
                <div
                    v-if="someSelected"
                    class="sticky top-20 z-20 border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 py-3 flex flex-col gap-3"
                >
                    <div class="flex items-center justify-between gap-3 flex-wrap">
                        <div class="text-xs text-zinc-300 flex items-center gap-3">
                            <input
                                type="checkbox"
                                class="w-4 h-4 accent-white cursor-pointer align-middle"
                                :checked="allSelectableSelected"
                                :disabled="selectableGrants.length === 0"
                                :title="allSelectableSelected ? 'Deselect all' : 'Select all actionable grants'"
                                @change="toggleSelectAll"
                            >
                            <span>
                                <span class="font-bold text-white">{{ selectedCount }}</span>
                                selected
                                <span v-if="selectedQueuedCount > 0" class="text-zinc-500">
                                    ({{ selectedQueuedCount }} queued)
                                </span>
                            </span>
                            <button
                                class="text-[11px] text-zinc-500 hover:text-white underline-offset-2 hover:underline"
                                @click="clearSelection"
                            >
                                Clear
                            </button>
                        </div>
                        <div class="flex items-center gap-2">
                            <button
                                class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                :disabled="bulkLoading || selectedQueuedCount === 0 || bulkAction !== null"
                                @click="bulkSend"
                            >
                                {{ bulkLoading && bulkAction === null ? "Sending..." : `Send ${selectedQueuedCount}`.trim() }}
                            </button>
                            <button
                                class="px-3 py-1.5 text-[11px] font-bold border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                :disabled="bulkLoading || bulkAction !== null"
                                @click="startBulkAction('cancel-card')"
                            >
                                Cancel card {{ selectedCount }}
                            </button>
                            <button
                                class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                :disabled="bulkLoading || bulkAction !== null"
                                @click="startBulkAction('cancel-fruit')"
                            >
                                Cancel + give fruit {{ selectedCount }}
                            </button>
                        </div>
                    </div>

                    <div
                        v-if="bulkAction !== null"
                        class="border border-zinc-700 bg-black/40 p-3 flex flex-col gap-2"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                                {{ bulkAction === "cancel-card" ? "Cancel card (no payout)" : "Cancel and award equivalent fruit" }} · {{ selectedCount }} grant(s)
                            </span>
                            <button
                                class="text-[11px] text-zinc-500 hover:text-white"
                                :disabled="bulkLoading"
                                @click="cancelBulkAction"
                            >
                                Back
                            </button>
                        </div>
                        <textarea
                            v-model="bulkReason"
                            rows="2"
                            placeholder="Reason applied to every selected grant (required)"
                            class="bg-black/30 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-y"
                            :disabled="bulkLoading"
                        />
                        <div class="flex items-center justify-end gap-2">
                            <button
                                class="px-3 py-1.5 text-[11px] font-bold border transition-colors disabled:opacity-40"
                                :class="bulkAction === 'cancel-fruit' ? 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10' : 'border-red-500/40 text-red-200 hover:bg-red-500/10'"
                                :disabled="bulkLoading || !bulkReason.trim()"
                                @click="submitBulkCancel"
                            >
                                {{ bulkLoading ? "..." : "Confirm" }}
                            </button>
                        </div>
                    </div>

                    <p v-if="bulkError" class="text-xs text-red-300">
                        {{ bulkError }}
                    </p>
                    <p v-if="bulkResultsMessage" class="text-xs text-emerald-300">
                        {{ bulkResultsMessage }}
                    </p>
                </div>
                <div
                    v-else
                    class="border border-dashed border-zinc-800 px-4 py-3 text-xs text-zinc-600 flex items-center gap-3"
                >
                    <input
                        type="checkbox"
                        class="w-4 h-4 accent-white cursor-pointer align-middle"
                        :checked="allSelectableSelected"
                        :disabled="selectableGrants.length === 0"
                        :title="selectableGrants.length === 0 ? 'No actionable grants' : 'Select all actionable grants'"
                        @change="toggleSelectAll"
                    >
                    <span>Select grants to send or cancel in bulk.</span>
                </div>
            </div>

            <div v-if="grantsLoading" class="text-sm text-zinc-500">
                Loading grants...
            </div>
            <div v-else-if="grantsError" class="text-sm text-red-300">
                {{ grantsError }}
            </div>
            <div
                v-else-if="grants.length === 0"
                class="border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-sm text-zinc-500"
            >
                No grants to show.
                <span v-if="statusFilter === 'queued'">
                    Approved hardware projects that checked "I need funding for this ship" will appear here.
                </span>
            </div>

            <div v-else class="flex flex-col gap-4">
                <section
                    v-for="grant in grants"
                    :key="grant.id"
                    class="border bg-zinc-900/40 p-5 flex flex-col gap-4 transition-colors"
                    :class="selectedIds.has(grant.id) ? 'border-white/40 bg-zinc-900/60' : 'border-zinc-800'"
                >
                    <div class="flex items-start gap-4">
                        <input
                            v-if="grant.status === 'queued' || grant.status === 'sent'"
                            type="checkbox"
                            class="w-5 h-5 accent-white cursor-pointer mt-1 shrink-0"
                            :checked="selectedIds.has(grant.id)"
                            @change="toggleRow(grant)"
                        >
                        <div v-else class="w-5 h-5 mt-1 shrink-0" />

                        <div class="flex-1 flex items-start justify-between gap-4 flex-wrap min-w-0">
                            <div class="flex flex-col gap-1 min-w-0 flex-1">
                                <div class="flex items-center gap-3 flex-wrap">
                                    <h2 class="text-xl font-bold text-white truncate">
                                        {{ grant.project.name }}
                                    </h2>
                                    <span
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
                                        :class="statusClass(grant.status)"
                                    >
                                        {{ grant.status }}
                                    </span>
                                    <span
                                        v-if="grant.reissued_from_id"
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400"
                                    >
                                        Reissued from #{{ grant.reissued_from_id }}
                                    </span>
                                    <span
                                        v-if="grant.status === 'queued' && sendActionBadge(grant)"
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
                                        :class="sendActionBadge(grant)!.cls"
                                    >
                                        {{ sendActionBadge(grant)!.label }}
                                    </span>
                                    <span
                                        v-if="grant.status === 'sent' && grant.hcb_card_replaces_id"
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-amber-500/30 bg-amber-500/10 text-amber-200"
                                    >
                                        Replaces cancelled card {{ grant.hcb_card_replaces_id }}
                                    </span>
                                    <span
                                        v-if="grant.status === 'sent' && grant.intended_send_action === 'top_up'"
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                                    >
                                        Topped up card {{ grant.hcb_grant_id }}
                                    </span>
                                </div>
                                <p class="text-sm text-zinc-400">
                                    Grant #{{ grant.id }} ·
                                    <span class="text-zinc-300">ship #{{ grant.ship_id }}</span>
                                </p>
                                <p class="text-xs text-zinc-500">
                                    Created {{ formatDate(grant.created_at) }}
                                    <template v-if="grant.sent_at">
                                        · Sent {{ formatDate(grant.sent_at) }}
                                    </template>
                                    <template v-if="grant.cancelled_at">
                                        · Cancelled {{ formatDate(grant.cancelled_at) }}
                                    </template>
                                </p>
                            </div>

                            <div class="text-sm text-zinc-400 flex flex-col items-end gap-1">
                                <span class="text-2xl font-bold text-white tabular-nums">
                                    {{ formatDollars(grant.amount_cents) }}
                                </span>
                                <span v-if="grant.hcb_grant_id" class="text-[11px] text-zinc-500">
                                    HCB #{{ grant.hcb_grant_id }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2">
                            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Recipient</p>
                            <NuxtLink
                                :to="`/internal/users/${grant.user.id}`"
                                class="text-sm text-white hover:text-amber-200 transition-colors font-semibold"
                            >
                                {{ grant.user.username ? `${grant.user.username} (${grant.user.name})` : grant.user.name }}
                            </NuxtLink>
                            <p class="text-xs text-zinc-400 truncate">
                                {{ grant.user.hcb_email ?? grant.user.email ?? "no email" }}
                            </p>
                            <p v-if="grant.user.slack_id" class="text-[11px] text-zinc-500">
                                Slack: {{ grant.user.slack_id }}
                            </p>
                            <p v-if="grant.user.hackatime_id" class="text-[11px] text-zinc-500">
                                Hackatime: {{ grant.user.hackatime_id }}
                            </p>
                        </div>

                        <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2">
                            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Project</p>
                            <NuxtLink
                                :to="`/projects/${grant.project.id}`"
                                class="text-sm text-white hover:text-amber-200 transition-colors font-semibold truncate"
                            >
                                {{ grant.project.name }}
                            </NuxtLink>
                            <p v-if="grant.project.fruit" class="text-xs text-zinc-400">
                                Fruit: {{ grant.project.fruit }}
                            </p>
                            <p v-if="grant.project.level" class="text-xs text-zinc-400">
                                Level {{ grant.project.level }}
                            </p>
                        </div>

                        <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2">
                            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Actions</p>
                            <div class="flex flex-wrap gap-2">
                                <template v-if="grant.status === 'queued'">
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading || getRowState(grant.id).action !== null"
                                        @click="sendGrant(grant)"
                                    >
                                        {{ getRowState(grant.id).loading && getRowState(grant.id).action === null ? "..." : sendButtonLabel(grant) }}
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        @click="startRowAction(grant, 'cancel-card')"
                                    >
                                        Cancel card
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        @click="startRowAction(grant, 'cancel-fruit')"
                                    >
                                        Cancel + give fruit
                                    </button>
                                </template>
                                <template v-else-if="grant.status === 'sent'">
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        @click="startRowAction(grant, 'cancel-card')"
                                    >
                                        Cancel card
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        @click="startRowAction(grant, 'cancel-fruit')"
                                    >
                                        Cancel + give fruit
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        :title="REISSUE_ACTIVE_TOOLTIP"
                                        @click="startRowAction(grant, 'cancel-reissue')"
                                    >
                                        Reissue
                                    </button>
                                </template>
                                <template v-else-if="grant.status === 'cancelled'">
                                    <!-- Confirming also backs out the fallback fruit tx. -->
                                    <button
                                        v-if="canUndoCancel(grant)"
                                        class="px-3 py-1.5 text-[11px] font-bold border border-zinc-600 text-zinc-300 hover:bg-zinc-700/30 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        :title="undoCancelTooltip(grant)"
                                        @click="startRowAction(grant, 'reverse')"
                                    >
                                        Undo cancel
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getRowState(grant.id).loading"
                                        :title="REISSUE_TOOLTIP"
                                        @click="reissueGrant(grant)"
                                    >
                                        {{ getRowState(grant.id).loading ? "..." : "Reissue" }}
                                    </button>
                                </template>
                            </div>
                        </div>
                    </div>

                    <div v-if="grant.hcb_grant_id" class="flex flex-col gap-3">
                        <button
                            class="self-start px-3 py-1.5 text-[11px] font-bold border border-zinc-700 text-zinc-300 hover:bg-zinc-800/40 transition-colors disabled:opacity-40"
                            :disabled="getTxState(grant.id).loading"
                            @click="toggleTransactions(grant)"
                        >
                            {{ getTxState(grant.id).open ? "Hide transactions" : "View transactions" }}
                        </button>
                        <div v-if="getTxState(grant.id).open">
                            <div
                                v-if="getTxState(grant.id).loading"
                                class="border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500"
                            >
                                Loading transactions...
                            </div>
                            <div
                                v-else-if="getTxState(grant.id).error"
                                class="border border-zinc-800 bg-black/20 p-4 text-sm text-red-300"
                            >
                                {{ getTxState(grant.id).error }}
                            </div>
                            <InternalHcbGrantDetail
                                v-else-if="getTxState(grant.id).info"
                                :info="getTxState(grant.id).info!"
                            />
                        </div>
                    </div>

                    <div
                        v-if="getRowState(grant.id).action !== null"
                        class="border border-zinc-700 bg-black/40 p-3 flex flex-col gap-2"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                                {{ rowActionLabel(getRowState(grant.id).action) }}
                            </span>
                            <button
                                class="text-[11px] text-zinc-500 hover:text-white"
                                :disabled="getRowState(grant.id).loading"
                                @click="cancelRowAction(grant.id)"
                            >
                                Back
                            </button>
                        </div>
                        <textarea
                            :value="getRowState(grant.id).reason"
                            rows="2"
                            placeholder="Justification (required)"
                            class="bg-black/30 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-y"
                            :disabled="getRowState(grant.id).loading"
                            @input="setRowState(grant.id, { reason: ($event.target as HTMLTextAreaElement).value, error: null })"
                        />
                        <div class="flex items-center justify-end gap-2">
                            <button
                                v-if="getRowState(grant.id).action === 'cancel-card'"
                                class="px-3 py-1.5 text-[11px] font-bold border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                :disabled="getRowState(grant.id).loading || !getRowState(grant.id).reason.trim()"
                                @click="submitRowCancel(grant, false)"
                            >
                                {{ getRowState(grant.id).loading ? "..." : "Confirm cancel" }}
                            </button>
                            <button
                                v-else-if="getRowState(grant.id).action === 'cancel-fruit'"
                                class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                :disabled="getRowState(grant.id).loading || !getRowState(grant.id).reason.trim()"
                                @click="submitRowCancel(grant, true)"
                            >
                                {{ getRowState(grant.id).loading ? "..." : "Confirm cancel + fruit" }}
                            </button>
                            <button
                                v-else-if="getRowState(grant.id).action === 'reverse'"
                                class="px-3 py-1.5 text-[11px] font-bold border border-zinc-600 text-zinc-200 hover:bg-zinc-700/30 transition-colors disabled:opacity-40"
                                :disabled="getRowState(grant.id).loading || !getRowState(grant.id).reason.trim()"
                                @click="submitRowReverse(grant)"
                            >
                                {{ getRowState(grant.id).loading ? "..." : "Confirm reverse" }}
                            </button>
                            <button
                                v-else-if="getRowState(grant.id).action === 'cancel-reissue'"
                                class="px-3 py-1.5 text-[11px] font-bold border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                                :disabled="getRowState(grant.id).loading || !getRowState(grant.id).reason.trim()"
                                @click="submitRowReissue(grant)"
                            >
                                {{ getRowState(grant.id).loading ? "..." : "Confirm reissue" }}
                            </button>
                        </div>
                    </div>

                    <p
                        v-if="getRowState(grant.id).error"
                        class="text-xs text-red-300"
                    >
                        {{ getRowState(grant.id).error }}
                    </p>

                    <div
                        v-if="grant.cancel_reason"
                        class="border border-zinc-800 bg-black/20 px-4 py-2 text-xs text-zinc-400"
                    >
                        <span class="text-zinc-500 font-bold uppercase tracking-widest mr-2">Cancel reason</span>
                        {{ grant.cancel_reason }}
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>
