<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

definePageMeta({ layout: "internal" });

type SuggestionStatus = "pending" | "accepted" | "rejected";

type Citation = { ticket_id: number; snippet: string };

type SuggestionRow = {
    id: number;
    question_en: string;
    answer_en: string;
    question_es: string | null;
    answer_es: string | null;
    status: SuggestionStatus;
    category: string;
    source_ticket_count: number;
    source_ticket_ids: number[];
    citations: Citation[];
    reviewed_at: string | null;
    published_kb_id: number | null;
    created_at: string;
    updated_at: string;
    reviewer: {
        id: string;
        name: string;
        username: string | null;
        image: string | null;
    } | null;
};

type EntrySource = {
    source_type: string;
    source_ref: string;
    citation_text: string;
};

type EntryRow = {
    id: number;
    title: string;
    body_en: string;
    body_es: string | null;
    type: string;
    category: string;
    status: "draft" | "published" | "archived";
    tags: string[];
    sort_order: number;
    valid_from: string | null;
    valid_until: string | null;
    last_verified_at: string | null;
    created_at: string;
    updated_at: string;
    sources: EntrySource[];
};

type EditState = {
    question_en: string;
    answer_en: string;
    question_es: string;
    answer_es: string;
};

type EntryEditState = {
    title: string;
    body_en: string;
    body_es: string;
    category: string;
    status: "draft" | "published" | "archived";
    tags: string;
};

const CATEGORY_OPTIONS = [
    "general",
    "project",
    "payout",
    "account",
    "shop",
    "bug",
    "other",
];
const STATUS_OPTIONS = ["draft", "published", "archived"] as const;

const activeTab = ref<SuggestionStatus>("pending");

const {
    data: suggestionsData,
    pending: suggestionsPending,
    refresh: refreshSuggestions,
} = useFetch<{ suggestions: SuggestionRow[] }>("/api/internal/kb-suggestions", {
    query: { status: activeTab },
    server: false,
    watch: [activeTab],
});

const { data: entriesData, refresh: refreshEntries } = useFetch<{
    entries: EntryRow[];
}>("/api/internal/kb-entries", { server: false });

const suggestions = computed<SuggestionRow[]>(
    () => suggestionsData.value?.suggestions ?? [],
);
const entries = computed<EntryRow[]>(() => entriesData.value?.entries ?? []);

const edits = reactive<Record<number, EditState>>({});
const rowBusy = reactive<Record<number, boolean>>({});

function ensureEdit(row: SuggestionRow): EditState {
    if (!edits[row.id]) {
        edits[row.id] = {
            question_en: row.question_en,
            answer_en: row.answer_en,
            question_es: row.question_es ?? "",
            answer_es: row.answer_es ?? "",
        };
    }
    return edits[row.id]!;
}

function resetEdit(row: SuggestionRow) {
    edits[row.id] = {
        question_en: row.question_en,
        answer_en: row.answer_en,
        question_es: row.question_es ?? "",
        answer_es: row.answer_es ?? "",
    };
}

function editHasChanges(row: SuggestionRow): boolean {
    const e = edits[row.id];
    if (!e) return false;
    return (
        e.question_en !== row.question_en ||
        e.answer_en !== row.answer_en ||
        e.question_es !== (row.question_es ?? "") ||
        e.answer_es !== (row.answer_es ?? "")
    );
}

watch(
    () => suggestions.value,
    (rows) => {
        for (const r of rows) ensureEdit(r);
    },
    { immediate: true },
);

const generateBusy = ref(false);
const generateMessage = ref<string | null>(null);
const generateError = ref<string | null>(null);

const actionError = ref<string | null>(null);

function reportActionError(err: unknown, fallback: string) {
    const e = err as { data?: { message?: string }; statusMessage?: string };
    actionError.value = e?.data?.message ?? e?.statusMessage ?? fallback;
}

async function runGenerate() {
    generateBusy.value = true;
    generateMessage.value = null;
    generateError.value = null;
    try {
        const res = await $fetch<{
            ok: boolean;
            ticketsAnalyzed: number;
            clustersFound: number;
            suggestionsCreated: number;
            duplicatesSkipped?: number;
        }>("/api/internal/kb-suggestions/generate", { method: "POST" });
        generateMessage.value =
            `Analyzed ${res.ticketsAnalyzed} resolved tickets, found ${res.clustersFound} clusters, ` +
            `created ${res.suggestionsCreated} new suggestions` +
            (res.duplicatesSkipped
                ? ` (skipped ${res.duplicatesSkipped} duplicates).`
                : ".");
        activeTab.value = "pending";
        await refreshSuggestions();
    } catch (err: unknown) {
        const e = err as { data?: { message?: string }; statusMessage?: string };
        generateError.value =
            e?.data?.message ?? e?.statusMessage ?? "Generation failed.";
    } finally {
        generateBusy.value = false;
    }
}

async function accept(row: SuggestionRow) {
    rowBusy[row.id] = true;
    actionError.value = null;
    try {
        const e = ensureEdit(row);
        // Save edits first: the accept body doesn't carry question_es.
        if (editHasChanges(row)) {
            await $fetch(`/api/internal/kb-suggestions/${row.id}`, {
                method: "PATCH",
                body: {
                    question_en: e.question_en,
                    answer_en: e.answer_en,
                    question_es: e.question_es || null,
                    answer_es: e.answer_es || null,
                },
            });
        }
        await $fetch(`/api/internal/kb-suggestions/${row.id}/accept`, {
            method: "POST",
            body: {
                question_en: e.question_en,
                answer_en: e.answer_en,
                answer_es: e.answer_es || null,
            },
        });
        await Promise.all([refreshSuggestions(), refreshEntries()]);
    } catch (err: unknown) {
        reportActionError(err, "Accept failed.");
    } finally {
        rowBusy[row.id] = false;
    }
}

async function reject(row: SuggestionRow) {
    rowBusy[row.id] = true;
    actionError.value = null;
    try {
        await $fetch(`/api/internal/kb-suggestions/${row.id}/reject`, {
            method: "POST",
        });
        await refreshSuggestions();
    } catch (err: unknown) {
        reportActionError(err, "Reject failed.");
    } finally {
        rowBusy[row.id] = false;
    }
}

async function saveEdits(row: SuggestionRow) {
    rowBusy[row.id] = true;
    actionError.value = null;
    try {
        const e = ensureEdit(row);
        await $fetch(`/api/internal/kb-suggestions/${row.id}`, {
            method: "PATCH",
            body: {
                question_en: e.question_en,
                answer_en: e.answer_en,
                question_es: e.question_es || null,
                answer_es: e.answer_es || null,
            },
        });
        await refreshSuggestions();
    } catch (err: unknown) {
        reportActionError(err, "Save failed.");
    } finally {
        rowBusy[row.id] = false;
    }
}

async function retranslate(row: SuggestionRow) {
    rowBusy[row.id] = true;
    actionError.value = null;
    try {
        const e = ensureEdit(row);
        if (editHasChanges(row)) {
            await $fetch(`/api/internal/kb-suggestions/${row.id}`, {
                method: "PATCH",
                body: {
                    question_en: e.question_en,
                    answer_en: e.answer_en,
                    question_es: e.question_es || null,
                    answer_es: e.answer_es || null,
                },
            });
        }
        const res = await $fetch<{ ok: boolean; suggestion: SuggestionRow }>(
            `/api/internal/kb-suggestions/${row.id}/retranslate`,
            { method: "POST" },
        );
        if (res.suggestion) {
            edits[row.id] = {
                question_en: res.suggestion.question_en,
                answer_en: res.suggestion.answer_en,
                question_es: res.suggestion.question_es ?? "",
                answer_es: res.suggestion.answer_es ?? "",
            };
        }
        await refreshSuggestions();
    } catch (err: unknown) {
        reportActionError(err, "Retranslate failed.");
    } finally {
        rowBusy[row.id] = false;
    }
}

async function deleteSuggestion(row: SuggestionRow) {
    askConfirm(
        `Delete suggestion "${row.question_en}"? The pipeline can regenerate it from the same tickets later.`,
        async () => {
            rowBusy[row.id] = true;
            actionError.value = null;
            try {
                await $fetch(`/api/internal/kb-suggestions/${row.id}`, {
                    method: "DELETE",
                });
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete edits[row.id];
                await refreshSuggestions();
            } catch (err: unknown) {
                reportActionError(err, "Delete failed.");
            } finally {
                rowBusy[row.id] = false;
            }
        },
    );
}

const entryEdits = reactive<Record<number, EntryEditState>>({});
const entryBusy = reactive<Record<number, boolean>>({});
const entryEditingId = ref<number | null>(null);

function startEditEntry(entry: EntryRow) {
    entryEdits[entry.id] = {
        title: entry.title,
        body_en: entry.body_en,
        body_es: entry.body_es ?? "",
        category: entry.category,
        status: entry.status,
        tags: (entry.tags ?? []).join(", "),
    };
    entryEditingId.value = entry.id;
}

function cancelEditEntry() {
    entryEditingId.value = null;
}

async function saveEntry(entry: EntryRow) {
    const e = entryEdits[entry.id];
    if (!e) return;
    entryBusy[entry.id] = true;
    actionError.value = null;
    try {
        await $fetch(`/api/internal/kb-entries/${entry.id}`, {
            method: "PATCH",
            body: {
                title: e.title,
                body_en: e.body_en,
                body_es: e.body_es || null,
                category: e.category,
                status: e.status,
                tags: e.tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
            },
        });
        entryEditingId.value = null;
        await refreshEntries();
    } catch (err: unknown) {
        reportActionError(err, "Entry save failed.");
    } finally {
        entryBusy[entry.id] = false;
    }
}

async function moveEntry(entry: EntryRow, direction: -1 | 1) {
    const sorted = [...entries.value].sort(
        (a, b) => a.sort_order - b.sort_order || a.id - b.id,
    );
    const idx = sorted.findIndex((e) => e.id === entry.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx]!;
    entryBusy[entry.id] = true;
    entryBusy[other.id] = true;
    actionError.value = null;
    try {
        await Promise.all([
            $fetch(`/api/internal/kb-entries/${entry.id}`, {
                method: "PATCH",
                body: { sort_order: other.sort_order },
            }),
            $fetch(`/api/internal/kb-entries/${other.id}`, {
                method: "PATCH",
                body: { sort_order: entry.sort_order },
            }),
        ]);
        await refreshEntries();
    } catch (err: unknown) {
        reportActionError(err, "Reorder failed.");
    } finally {
        entryBusy[entry.id] = false;
        entryBusy[other.id] = false;
    }
}

async function deleteEntry(entry: EntryRow) {
    askConfirm(
        `Delete KB entry "${entry.title}"? Prefer archiving to keep its provenance.`,
        async () => {
            entryBusy[entry.id] = true;
            actionError.value = null;
            try {
                await $fetch(`/api/internal/kb-entries/${entry.id}`, {
                    method: "DELETE",
                });
                await refreshEntries();
            } catch (err: unknown) {
                reportActionError(err, "Entry delete failed.");
            } finally {
                entryBusy[entry.id] = false;
            }
        },
    );
}

const confirmState = ref<{ message: string; action: () => Promise<void> } | null>(
    null,
);
function askConfirm(message: string, action: () => Promise<void>) {
    confirmState.value = { message, action };
}
async function runConfirm() {
    const action = confirmState.value?.action;
    confirmState.value = null;
    if (action) await action();
}

const tabCounts = reactive({ pending: 0, accepted: 0, rejected: 0 });

async function refreshCounts() {
    // One GROUP BY server-side instead of fetching all three lists.
    const res = await $fetch<{
        counts: Record<SuggestionStatus | "archived", number>;
    }>("/api/internal/kb-suggestions?counts=1");
    tabCounts.pending = res.counts.pending ?? 0;
    tabCounts.accepted = res.counts.accepted ?? 0;
    tabCounts.rejected = res.counts.rejected ?? 0;
}

watch(
    suggestions,
    () => {
        refreshCounts().catch(() => {});
    },
    { immediate: true },
);

function ticketLink(id: number | string): string {
    return `/internal/support/${id}`;
}

function reviewerHandle(r: SuggestionRow["reviewer"]): string {
    if (!r) return "";
    return r.username ?? r.name;
}
</script>

<template>
    <div class="min-h-screen text-white px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto">
            <header class="flex items-start justify-between gap-4 mb-6">
                <div>
                    <h1 class="text-2xl font-bold mb-1">KB suggestions</h1>
                    <p class="text-sm text-zinc-400">
                        Cluster resolved support tickets into cited knowledge base
                        entries. Accepted items feed the supporter agent's answers.
                    </p>
                </div>
                <button
                    class="px-4 py-2 bg-white hover:bg-zinc-200 text-black text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="generateBusy"
                    @click="runGenerate"
                >
                    {{ generateBusy ? "Generating..." : "Generate KB suggestions" }}
                </button>
            </header>

            <div
                v-if="generateMessage"
                class="mb-4 px-3 py-2 bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-sm"
            >
                {{ generateMessage }}
            </div>
            <div
                v-if="generateError"
                class="mb-4 px-3 py-2 bg-red-950/40 border border-red-500/30 text-red-300 text-sm"
            >
                {{ generateError }}
            </div>
            <div
                v-if="actionError"
                class="mb-4 px-3 py-2 bg-red-950/40 border border-red-500/30 text-red-300 text-sm flex items-center justify-between gap-3"
            >
                <span>{{ actionError }}</span>
                <button
                    class="text-red-300/70 hover:text-red-200 text-xs font-bold shrink-0"
                    @click="actionError = null"
                >
                    Dismiss
                </button>
            </div>

            <div class="flex items-center gap-1 border-b border-zinc-800 mb-4">
                <button
                    v-for="tab in (['pending', 'accepted', 'rejected'] as const)"
                    :key="tab"
                    class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                    :class="
                        activeTab === tab
                            ? 'border-white text-white'
                            : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    "
                    @click="activeTab = tab"
                >
                    {{ tab.charAt(0).toUpperCase() + tab.slice(1) }}
                    <span class="ml-1 text-xs text-zinc-600">({{ tabCounts[tab] }})</span>
                </button>
            </div>

            <div v-if="suggestionsPending" class="text-sm text-zinc-500 py-8 text-center">
                Loading...
            </div>
            <div
                v-else-if="suggestions.length === 0"
                class="text-sm text-zinc-500 py-12 text-center border border-dashed border-zinc-800"
            >
                No {{ activeTab }} suggestions.
                <span v-if="activeTab === 'pending'">Click "Generate KB suggestions" to run the pipeline.</span>
            </div>
            <div v-else class="space-y-4 mb-12">
                <article
                    v-for="row in suggestions"
                    :key="row.id"
                    class="bg-zinc-950 border border-zinc-700"
                >
                    <div class="p-4 space-y-4">
                        <div class="flex items-center justify-between gap-3 text-xs text-zinc-500">
                            <div class="flex items-center gap-3 flex-wrap">
                                <span class="px-2 py-0.5 bg-zinc-800 text-zinc-300 font-mono">#{{ row.id }}</span>
                                <span class="px-2 py-0.5 bg-zinc-800 text-zinc-300 uppercase tracking-wide">{{ row.category }}</span>
                                <span class="px-2 py-0.5 bg-sky-950 text-sky-300 border border-sky-500/30">{{ row.source_ticket_count }} ticket cluster</span>
                            </div>
                            <span v-if="row.reviewer" class="text-zinc-500">
                                Reviewed by {{ reviewerHandle(row.reviewer) }}
                            </span>
                        </div>

                        <div
                            v-if="row.citations && row.citations.length"
                            class="border border-zinc-800 bg-zinc-900/40 p-3 space-y-1"
                        >
                            <div class="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-1">
                                Sources
                            </div>
                            <p
                                v-for="(c, idx) in row.citations"
                                :key="idx"
                                class="text-xs text-zinc-400"
                            >
                                <NuxtLink
                                    :to="ticketLink(c.ticket_id)"
                                    class="text-sky-400 hover:text-sky-300 underline font-mono"
                                >#{{ c.ticket_id }}</NuxtLink>
                                <span class="text-zinc-500">: {{ c.snippet }}</span>
                            </p>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">English</label>
                                <input
                                    v-model="ensureEdit(row).question_en"
                                    :disabled="row.status !== 'pending'"
                                    class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
                                    placeholder="Question / title"
                                >
                                <textarea
                                    v-model="ensureEdit(row).answer_en"
                                    :disabled="row.status !== 'pending'"
                                    rows="4"
                                    class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60 resize-y"
                                    placeholder="Answer"
                                />
                            </div>
                            <div class="space-y-2">
                                <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">Spanish</label>
                                <input
                                    v-model="ensureEdit(row).question_es"
                                    :disabled="row.status !== 'pending'"
                                    class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
                                    placeholder="Pregunta"
                                >
                                <textarea
                                    v-model="ensureEdit(row).answer_es"
                                    :disabled="row.status !== 'pending'"
                                    rows="4"
                                    class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60 resize-y"
                                    placeholder="Respuesta"
                                />
                            </div>
                        </div>

                        <div v-if="row.status === 'pending'" class="flex flex-wrap items-center gap-2 pt-2">
                            <button
                                class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :disabled="rowBusy[row.id]"
                                @click="accept(row)"
                            >
                                Accept &amp; publish
                            </button>
                            <button
                                v-if="editHasChanges(row)"
                                class="px-5 py-2.5 border border-zinc-600 text-zinc-200 hover:bg-zinc-800 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :disabled="rowBusy[row.id]"
                                @click="saveEdits(row)"
                            >
                                Save edits
                            </button>
                            <button
                                v-if="editHasChanges(row)"
                                class="px-5 py-2.5 border border-zinc-700 text-zinc-400 hover:bg-zinc-900 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :disabled="rowBusy[row.id]"
                                @click="resetEdit(row)"
                            >
                                Discard edits
                            </button>
                            <button
                                class="px-5 py-2.5 border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :disabled="rowBusy[row.id]"
                                @click="retranslate(row)"
                            >
                                {{ rowBusy[row.id] ? "Working..." : "Retranslate to Spanish" }}
                            </button>
                            <span class="flex-1" />
                            <button
                                class="px-5 py-2.5 border border-red-500/30 text-red-300 hover:bg-red-500/10 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :disabled="rowBusy[row.id]"
                                @click="deleteSuggestion(row)"
                            >
                                Delete
                            </button>
                            <button
                                class="px-5 py-2.5 border border-red-500/30 text-red-300 hover:bg-red-500/10 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :disabled="rowBusy[row.id]"
                                @click="reject(row)"
                            >
                                Reject
                            </button>
                        </div>
                    </div>
                </article>
            </div>

            <section class="mt-10 border-t border-zinc-800 pt-8">
                <h2 class="text-lg font-bold mb-1">Published KB</h2>
                <p class="text-sm text-zinc-500 mb-4">
                    These entries are what the supporter agent retrieves from. Edit,
                    archive, or remove as needed. Editing the title or English body
                    re-embeds the entry.
                </p>

                <div
                    v-if="entries.length === 0"
                    class="text-sm text-zinc-500 py-12 text-center border border-dashed border-zinc-800"
                >
                    No KB entries yet. Accept a suggestion above to publish the first one.
                </div>

                <ul v-else class="space-y-2">
                    <li
                        v-for="(entry, idx) in [...entries].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)"
                        :key="entry.id"
                        class="bg-zinc-950 border border-zinc-800"
                    >
                        <div class="flex items-start gap-3 p-3">
                            <div class="flex flex-col gap-1 pt-0.5">
                                <button
                                    class="w-7 h-6 text-xs text-zinc-500 hover:text-white border border-zinc-700 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                    :disabled="idx === 0 || entryBusy[entry.id]"
                                    @click="moveEntry(entry, -1)"
                                >
                                    ↑
                                </button>
                                <button
                                    class="w-7 h-6 text-xs text-zinc-500 hover:text-white border border-zinc-700 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                    :disabled="idx === entries.length - 1 || entryBusy[entry.id]"
                                    @click="moveEntry(entry, 1)"
                                >
                                    ↓
                                </button>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div v-if="entryEditingId === entry.id" class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <select
                                            v-model="entryEdits[entry.id]!.category"
                                            class="bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white focus:border-zinc-500 focus:outline-none"
                                        >
                                            <option v-for="c in CATEGORY_OPTIONS" :key="c" :value="c">{{ c }}</option>
                                        </select>
                                        <select
                                            v-model="entryEdits[entry.id]!.status"
                                            class="bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-white focus:border-zinc-500 focus:outline-none"
                                        >
                                            <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                                        </select>
                                    </div>
                                    <input
                                        v-model="entryEdits[entry.id]!.title"
                                        class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
                                        placeholder="Title"
                                    >
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div class="space-y-1">
                                            <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">Body (EN)</label>
                                            <textarea
                                                v-model="entryEdits[entry.id]!.body_en"
                                                rows="4"
                                                class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none resize-y"
                                            />
                                        </div>
                                        <div class="space-y-1">
                                            <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">Body (ES)</label>
                                            <textarea
                                                v-model="entryEdits[entry.id]!.body_es"
                                                rows="4"
                                                class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none resize-y"
                                            />
                                        </div>
                                    </div>
                                    <input
                                        v-model="entryEdits[entry.id]!.tags"
                                        class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white focus:border-zinc-500 focus:outline-none"
                                        placeholder="tags, comma, separated"
                                    >
                                    <div class="flex items-center gap-2">
                                        <button
                                            class="px-4 py-2 bg-white hover:bg-zinc-200 text-black text-sm font-bold transition-colors disabled:opacity-50"
                                            :disabled="entryBusy[entry.id]"
                                            @click="saveEntry(entry)"
                                        >
                                            Save
                                        </button>
                                        <button
                                            class="px-4 py-2 border border-zinc-700 text-zinc-400 hover:bg-zinc-900 text-sm font-bold transition-colors"
                                            @click="cancelEditEntry"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                                <div v-else>
                                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                                        <span
                                            class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                                            :class="
                                                entry.status === 'published'
                                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                                    : entry.status === 'archived'
                                                        ? 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                                                        : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                                            "
                                        >
                                            {{ entry.status }}
                                        </span>
                                        <span class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-zinc-800 text-zinc-400 border border-zinc-700">{{ entry.category }}</span>
                                        <span class="text-xs text-zinc-500">sort: {{ entry.sort_order }}</span>
                                    </div>
                                    <p class="font-bold text-sm text-white">{{ entry.title }}</p>
                                    <p class="text-sm text-zinc-400 mt-1 whitespace-pre-wrap">{{ entry.body_en }}</p>
                                    <p v-if="entry.body_es" class="text-xs text-zinc-500 mt-2 whitespace-pre-wrap">{{ entry.body_es }}</p>
                                    <div v-if="entry.sources && entry.sources.length" class="mt-2 flex flex-wrap gap-1.5">
                                        <NuxtLink
                                            v-for="(s, sidx) in entry.sources"
                                            :key="sidx"
                                            :to="s.source_type === 'support_ticket' ? ticketLink(s.source_ref) : '#'"
                                            class="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-900 border border-zinc-700 text-sky-400 hover:text-sky-300"
                                        >
                                            {{ s.source_type === 'support_ticket' ? '#' + s.source_ref : s.source_ref }}
                                        </NuxtLink>
                                    </div>
                                </div>
                            </div>
                            <div v-if="entryEditingId !== entry.id" class="flex flex-col gap-2 pt-0.5">
                                <button
                                    class="px-3 py-1 border border-zinc-700 text-zinc-300 hover:bg-zinc-900 text-xs font-bold transition-colors disabled:opacity-50"
                                    :disabled="entryBusy[entry.id]"
                                    @click="startEditEntry(entry)"
                                >
                                    Edit
                                </button>
                                <button
                                    class="px-3 py-1 border border-red-500/30 text-red-300 hover:bg-red-500/10 text-xs font-bold transition-colors disabled:opacity-50"
                                    :disabled="entryBusy[entry.id]"
                                    @click="deleteEntry(entry)"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </li>
                </ul>
            </section>
        </div>

        <div
            v-if="confirmState"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
            <div class="bg-zinc-900 border border-zinc-700 max-w-md w-full p-5">
                <p class="text-sm text-zinc-200 mb-4">{{ confirmState.message }}</p>
                <div class="flex justify-end gap-2">
                    <button
                        class="px-4 py-2 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-sm font-bold transition-colors"
                        @click="confirmState = null"
                    >
                        Cancel
                    </button>
                    <button
                        class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors"
                        @click="runConfirm"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
