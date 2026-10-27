<script setup lang="ts">
import { useAlertDialog } from "~/composables/useAlertDialog";

definePageMeta({
    layout: "internal",
});

type ShippedRow = {
    ship_id: number;
    ship_status: "shipped" | "shipped_missing_airtable";
    shipped_at: string | null;
    hackatime_hours: number | null;
    override_hours: number | null;
    project_id: number;
    project_name: string | null;
    project_type: "software" | "hardware" | null;
    project_level: number | null;
    author_id: string;
    author_username: string | null;
    author_image: string | null;
    airtable_record_id: string | null;
};

const { showAlert, showPrompt } = useAlertDialog();

const page = ref(1);
const limit = ref(50);
const revertingShipId = ref<number | null>(null);
const actionMessage = ref<string | null>(null);

const { data, pending, refresh, error } = await useFetch<{
    items: ShippedRow[];
    page: number;
    limit: number;
    total: number;
}>("/api/internal/shipped", {
    query: { page, limit },
});

const items = computed(() => data.value?.items ?? []);
const totalShipped = computed(() => data.value?.total ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(totalShipped.value / limit.value)));

function formatDate(value: string | null) {
    return value ? new Date(value).toLocaleString() : "—";
}

function approvedHours(row: ShippedRow) {
    return row.override_hours ?? row.hackatime_hours ?? 0;
}

function typeLabel(type: "software" | "hardware" | null) {
    if (!type) return "-";
    if (type === "hardware") return "Hardware";
    if (type === "software") return "Software";
    return "-";
}

function levelLabel(level: number | null) {
    if (level == null) return "—";
    return `Level ${level}`;
}

function statusLabel(status: ShippedRow["ship_status"]) {
    return status === "shipped_missing_airtable" ? "Shipped (no Airtable)" : "Shipped";
}

function statusClass(status: ShippedRow["ship_status"]) {
    return status === "shipped_missing_airtable"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

// A shipped row without an Airtable record id was never backfilled or its Airtable POST dropped.
function rowClass(row: ShippedRow) {
    if (!row.airtable_record_id) {
        return "border-t border-red-500/40 bg-red-500/5 hover:bg-red-500/10";
    }
    return "border-t border-zinc-800 hover:bg-black/20";
}

function getErrorMessage(error: unknown, fallback: string): string {
    const err = error as { data?: { statusMessage?: string }; message?: string };
    return err?.data?.statusMessage || err?.message || fallback;
}

type RevertShipResponse = {
    ok: boolean;
    cancelledGrantCount: number;
    cancelledSentGrantCount: number;
    disabledCurrencyTransactionCount: number;
    restoredPendingCurrencyTransactionCount: number;
    clawBackDisabledCurrencyTransactionCount: number;
    clawBackCancelledShopOrderCount: number;
};

function formatRevertSummary(projectName: string, response: RevertShipResponse): string {
    const parts: string[] = [];
    if (response.cancelledGrantCount > 0) {
        const sent = response.cancelledSentGrantCount;
        if (sent > 0) {
            parts.push(`cancelled ${response.cancelledGrantCount} grant${response.cancelledGrantCount === 1 ? "" : "s"} (${sent} sent, HCB cancelled)`);
        } else {
            parts.push(`cancelled ${response.cancelledGrantCount} queued grant${response.cancelledGrantCount === 1 ? "" : "s"}`);
        }
    }
    if (response.disabledCurrencyTransactionCount > 0) {
        parts.push(`disabled ${response.disabledCurrencyTransactionCount} ship_reward currency tx`);
    }
    if (response.clawBackDisabledCurrencyTransactionCount > 0) {
        parts.push(`clawed back ${response.clawBackDisabledCurrencyTransactionCount} post-approval currency tx`);
    }
    if (response.clawBackCancelledShopOrderCount > 0) {
        parts.push(`cancelled ${response.clawBackCancelledShopOrderCount} shop order${response.clawBackCancelledShopOrderCount === 1 ? "" : "s"}`);
    }
    if (parts.length === 0) {
        return `"${projectName}" was reverted and moved back under review.`;
    }
    return `"${projectName}" was reverted and moved back under review. ${parts.join(", ")}.`;
}

async function revertShip(row: ShippedRow) {
    if (revertingShipId.value !== null) return;

    const projectName = row.project_name ?? `ship #${row.ship_id}`;
    const internalNotes = await showPrompt({
        title: "Revert ship?",
        message: `This will unship "${projectName}" and put it back under review. If a grant has already been sent to HCB it will also be cancelled. Recent fruit conversions and shop purchases by the student will be undone too, just enough to keep their balance non-negative. No fallback fruit is awarded. Write the internal reason for the audit log.`,
        placeholder: "e.g. Duplicate of a project already paid out under sleepover",
        required: true,
        confirmLabel: "Continue",
        tone: "warning",
        destructive: true,
    });
    const trimmedInternalNotes = internalNotes?.trim();
    if (!trimmedInternalNotes) return;

    const publicNotes = await showPrompt({
        title: "Public note",
        message: "Optional: write the note that should be sent to the submitter. Leave it blank to send a generic message.",
        placeholder: "e.g. This project duplicates one that has already been paid out, so the approval has been reversed.",
        required: false,
        confirmLabel: "Revert ship",
        tone: "warning",
        destructive: true,
    });

    revertingShipId.value = row.ship_id;
    actionMessage.value = null;
    try {
        const response = await $fetch<RevertShipResponse>(`/api/internal/ships/${row.ship_id}/revert-ship`, {
            method: "POST",
            body: {
                internalNotes: trimmedInternalNotes,
                publicNotes: publicNotes?.trim() || null,
            },
        });
        actionMessage.value = formatRevertSummary(projectName, response);
        await refresh();
    } catch (e: unknown) {
        await showAlert({
            title: "Failed to revert ship",
            message: getErrorMessage(e, "Failed to revert ship."),
            tone: "error",
        });
    } finally {
        revertingShipId.value = null;
    }
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-7xl mx-auto flex flex-col gap-6">
            <div class="flex flex-col gap-1">
                <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Shipped Projects</p>
                <h1 class="text-3xl font-bold text-white tracking-tight">All shipped projects</h1>
                <p class="text-sm text-zinc-400">Supaadmin-only view of every approved ship. Most recent first.</p>
            </div>

            <div
                v-if="actionMessage"
                class="border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm"
            >
                {{ actionMessage }}
            </div>
            <div
                v-if="error"
                class="border border-red-500/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm"
            >
                Failed to load shipped projects.
            </div>

            <div class="border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                <div v-if="pending" class="p-8 text-center text-zinc-500 text-sm">Loading...</div>
                <div v-else-if="items.length === 0" class="p-8 text-center text-zinc-500 text-sm">No shipped projects yet.</div>
                <table v-else class="w-full text-sm">
                    <thead class="bg-black/30 text-xs uppercase tracking-widest text-zinc-500">
                        <tr>
                            <th class="text-left px-4 py-3 font-bold">Project</th>
                            <th class="text-left px-4 py-3 font-bold">Author</th>
                            <th class="text-left px-4 py-3 font-bold">Type</th>
                            <th class="text-left px-4 py-3 font-bold">Level</th>
                            <th class="text-right px-4 py-3 font-bold">Hours</th>
                            <th class="text-left px-4 py-3 font-bold">Shipped</th>
                            <th class="text-left px-4 py-3 font-bold">Status</th>
                            <th class="text-left px-4 py-3 font-bold">Airtable</th>
                            <th class="text-right px-4 py-3 font-bold">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in items"
                            :key="row.ship_id"
                            :class="rowClass(row) + ' transition-colors'"
                        >
                            <td class="px-4 py-3">
                                <NuxtLink
                                    :to="`/internal/projects/${row.project_id}`"
                                    class="text-white hover:text-amber-300 transition-colors font-medium"
                                >
                                    {{ row.project_name ?? `#${row.project_id}` }}
                                </NuxtLink>
                            </td>
                            <td class="px-4 py-3">
                                <NuxtLink
                                    :to="`/internal/users/${row.author_id}`"
                                    class="flex items-center gap-2 text-zinc-300 hover:text-white transition-colors"
                                >
                                    <img
                                        v-if="row.author_image"
                                        :src="row.author_image"
                                        :alt="row.author_username ?? 'User'"
                                        class="w-6 h-6 object-cover border border-zinc-700"
                                    >
                                    <span>{{ row.author_username ?? row.author_id }}</span>
                                </NuxtLink>
                            </td>
                            <td class="px-4 py-3 text-zinc-400">{{ typeLabel(row.project_type) }}</td>
                            <td class="px-4 py-3 text-zinc-400">{{ levelLabel(row.project_level) }}</td>
                            <td class="px-4 py-3 text-right text-zinc-300 font-mono">{{ approvedHours(row).toFixed(1) }}h</td>
                            <td class="px-4 py-3 text-zinc-400 text-xs">{{ formatDate(row.shipped_at) }}</td>
                            <td class="px-4 py-3">
                                <span
                                    class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
                                    :class="statusClass(row.ship_status)"
                                >
                                    {{ statusLabel(row.ship_status) }}
                                </span>
                            </td>
                            <td class="px-4 py-3">
                                <a
                                    v-if="row.airtable_record_id"
                                    :href="`https://airtable.com/appYYPWFXz9IhZO03/tbl0FTDHEq369oijK/${row.airtable_record_id}`"
                                    target="_blank"
                                    rel="noopener"
                                    class="text-emerald-400 hover:text-emerald-300 underline text-xs font-mono"
                                    @click.stop
                                >
                                    {{ row.airtable_record_id }}
                                </a>
                                <span v-else class="text-red-400 text-xs">missing</span>
                            </td>
                            <td class="px-4 py-3 text-right">
                                <button
                                    type="button"
                                    class="text-[10px] font-bold uppercase tracking-widest px-3 py-2 border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                    :disabled="revertingShipId !== null"
                                    @click="revertShip(row)"
                                >
                                    {{ revertingShipId === row.ship_id ? "Reverting..." : "Revert ship" }}
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="flex items-center justify-between gap-3">
                <span class="text-xs text-zinc-500">
                    Showing {{ Math.min((page - 1) * limit + 1, totalShipped) }}–{{ Math.min(page * limit, totalShipped) }} of {{ totalShipped }}
                </span>
                <InternalPagination
                    v-model:current-page="page"
                    :total-pages="totalPages"
                />
            </div>
        </div>
    </div>
</template>
