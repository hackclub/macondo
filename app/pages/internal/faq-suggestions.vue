<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

definePageMeta({ layout: "internal" });

type SuggestionStatus = "pending" | "accepted" | "rejected";

type SuggestionRow = {
    id: number;
    question_en: string;
    answer_en: string;
    question_es: string | null;
    answer_es: string | null;
    status: SuggestionStatus;
    source_ticket_count: number;
    source_ticket_ids: number[];
    reviewed_at: string | null;
    published_faq_id: number | null;
    created_at: string;
    updated_at: string;
    reviewer: {
        id: string;
        name: string;
        username: string | null;
        image: string | null;
    } | null;
};

type EntryRow = {
    id: number;
    question_en: string;
    answer_en: string;
    question_es: string | null;
    answer_es: string | null;
    source: "manual" | "ai_generated";
    sort_order: number;
    created_at: string;
    updated_at: string;
};

type EditState = {
    question_en: string;
    answer_en: string;
    question_es: string;
    answer_es: string;
};

const activeTab = ref<SuggestionStatus>("pending");

const {
    data: suggestionsData,
    pending: suggestionsPending,
    refresh: refreshSuggestions,
} = useFetch<{ suggestions: SuggestionRow[] }>("/api/internal/faq-suggestions", {
    query: { status: activeTab },
    server: false,
    watch: [activeTab],
});

const {
    data: entriesData,
    refresh: refreshEntries,
} = useFetch<{ entries: EntryRow[] }>("/api/internal/faq-entries", {
    server: false,
});

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
        for (const r of rows) {
            ensureEdit(r);
        }
    },
    { immediate: true },
);

const generateBusy = ref(false);
const generateMessage = ref<string | null>(null);
const generateError = ref<string | null>(null);

async function runGenerate() {
    generateBusy.value = true;
    generateMessage.value = null;
    generateError.value = null;
    try {
        const res = await $fetch<{
            ok: boolean;
            ticketsAnalyzed: number;
            suggestionsCreated: number;
            duplicatesSkipped?: number;
            message?: string;
        }>("/api/internal/faq-suggestions/generate", { method: "POST" });
        generateMessage.value =
            res.message ??
            `Analyzed ${res.ticketsAnalyzed} tickets, created ${res.suggestionsCreated} new suggestions` +
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
    try {
        const e = ensureEdit(row);
        await $fetch(`/api/internal/faq-suggestions/${row.id}/accept`, {
            method: "POST",
            body: {
                question_en: e.question_en,
                answer_en: e.answer_en,
                question_es: e.question_es || null,
                answer_es: e.answer_es || null,
            },
        });
        await Promise.all([refreshSuggestions(), refreshEntries()]);
    } finally {
        rowBusy[row.id] = false;
    }
}

async function reject(row: SuggestionRow) {
    rowBusy[row.id] = true;
    try {
        await $fetch(`/api/internal/faq-suggestions/${row.id}/reject`, {
            method: "POST",
        });
        await refreshSuggestions();
    } finally {
        rowBusy[row.id] = false;
    }
}

async function saveEdits(row: SuggestionRow) {
    rowBusy[row.id] = true;
    try {
        const e = ensureEdit(row);
        await $fetch(`/api/internal/faq-suggestions/${row.id}`, {
            method: "PATCH",
            body: {
                question_en: e.question_en,
                answer_en: e.answer_en,
                question_es: e.question_es || null,
                answer_es: e.answer_es || null,
            },
        });
        await refreshSuggestions();
    } finally {
        rowBusy[row.id] = false;
    }
}

async function retranslate(row: SuggestionRow) {
    rowBusy[row.id] = true;
    try {
        const e = ensureEdit(row);
        // Save unsaved English edits first so the server translates what the reviewer sees.
        if (editHasChanges(row)) {
            await $fetch(`/api/internal/faq-suggestions/${row.id}`, {
                method: "PATCH",
                body: {
                    question_en: e.question_en,
                    answer_en: e.answer_en,
                    question_es: e.question_es || null,
                    answer_es: e.answer_es || null,
                },
            });
        }
        const res = await $fetch<{
            ok: boolean;
            suggestion: SuggestionRow;
        }>(`/api/internal/faq-suggestions/${row.id}/retranslate`, {
            method: "POST",
        });
        if (res.suggestion) {
            edits[row.id] = {
                question_en: res.suggestion.question_en,
                answer_en: res.suggestion.answer_en,
                question_es: res.suggestion.question_es ?? "",
                answer_es: res.suggestion.answer_es ?? "",
            };
        }
        await refreshSuggestions();
    } finally {
        rowBusy[row.id] = false;
    }
}

async function deleteSuggestion(row: SuggestionRow) {
    const prompt = `Delete suggestion "${row.question_en}"? The AI can regenerate it from the same tickets later.`;
    if (typeof window !== "undefined" && !window.confirm(prompt)) return;
    rowBusy[row.id] = true;
    try {
        await $fetch(`/api/internal/faq-suggestions/${row.id}`, {
            method: "DELETE",
        });
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete edits[row.id];
        await refreshSuggestions();
    } finally {
        rowBusy[row.id] = false;
    }
}

const entryEdits = reactive<Record<number, EditState>>({});
const entryBusy = reactive<Record<number, boolean>>({});
const entryEditingId = ref<number | null>(null);

function startEditEntry(entry: EntryRow) {
    entryEdits[entry.id] = {
        question_en: entry.question_en,
        answer_en: entry.answer_en,
        question_es: entry.question_es ?? "",
        answer_es: entry.answer_es ?? "",
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
    try {
        await $fetch(`/api/internal/faq-entries/${entry.id}`, {
            method: "PATCH",
            body: {
                question_en: e.question_en,
                answer_en: e.answer_en,
                question_es: e.question_es || null,
                answer_es: e.answer_es || null,
            },
        });
        entryEditingId.value = null;
        await refreshEntries();
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
    try {
        await Promise.all([
            $fetch(`/api/internal/faq-entries/${entry.id}`, {
                method: "PATCH",
                body: { sort_order: other.sort_order },
            }),
            $fetch(`/api/internal/faq-entries/${other.id}`, {
                method: "PATCH",
                body: { sort_order: entry.sort_order },
            }),
        ]);
        await refreshEntries();
    } finally {
        entryBusy[entry.id] = false;
        entryBusy[other.id] = false;
    }
}

async function deleteEntry(entry: EntryRow) {
    const prompt =
        entry.source === "manual"
            ? `Delete the manual FAQ entry "${entry.question_en}"? This removes it from /docs/faq.`
            : `Delete AI-generated FAQ entry "${entry.question_en}"?`;
    if (typeof window !== "undefined" && !window.confirm(prompt)) return;
    entryBusy[entry.id] = true;
    try {
        await $fetch(`/api/internal/faq-entries/${entry.id}`, {
            method: "DELETE",
        });
        await refreshEntries();
    } finally {
        entryBusy[entry.id] = false;
    }
}

const tabCounts = reactive({
    pending: 0,
    accepted: 0,
    rejected: 0,
});

async function refreshCounts() {
    const [pendingRes, acceptedRes, rejectedRes] = await Promise.all([
        $fetch<{ suggestions: SuggestionRow[] }>(
            "/api/internal/faq-suggestions?status=pending",
        ),
        $fetch<{ suggestions: SuggestionRow[] }>(
            "/api/internal/faq-suggestions?status=accepted",
        ),
        $fetch<{ suggestions: SuggestionRow[] }>(
            "/api/internal/faq-suggestions?status=rejected",
        ),
    ]);
    tabCounts.pending = pendingRes.suggestions.length;
    tabCounts.accepted = acceptedRes.suggestions.length;
    tabCounts.rejected = rejectedRes.suggestions.length;
}

watch(
    suggestions,
    () => {
        refreshCounts().catch(() => {});
    },
    { immediate: true },
);

function formatTicketLink(id: number): string {
    return `/internal/support/${id}`;
}
</script>

<template>
    <div class="min-h-screen text-white px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto">
            <header class="flex items-start justify-between gap-4 mb-6">
                <div>
                    <h1 class="text-2xl font-bold mb-1">FAQ suggestions</h1>
                    <p class="text-sm text-zinc-400">
                        Cluster resolved support tickets into public FAQ entries.
                        Accepted items appear on /docs/faq.
                    </p>
                </div>
                <button
                    class="px-4 py-2 bg-white hover:bg-zinc-200 text-black text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="generateBusy"
                    @click="runGenerate"
                >
                    {{ generateBusy ? "Generating..." : "Generate FAQ suggestions" }}
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
                <span v-if="activeTab === 'pending'">Click "Generate FAQ suggestions" to run the AI.</span>
            </div>
            <div v-else class="space-y-4 mb-12">
                <article
                    v-for="row in suggestions"
                    :key="row.id"
                    class="bg-zinc-950 border border-zinc-700"
                >
                    <div class="p-4 space-y-4">
                        <div class="flex items-center justify-between gap-3 text-xs text-zinc-500">
                            <div class="flex items-center gap-3">
                                <span class="px-2 py-0.5 bg-zinc-800 text-zinc-300 font-mono">#{{ row.id }}</span>
                                <span>Source tickets: <strong class="text-zinc-300">{{ row.source_ticket_count }}</strong></span>
                                <span v-if="row.source_ticket_ids.length">·</span>
                                <span v-if="row.source_ticket_ids.length">
                                    <NuxtLink
                                        v-for="(tid, idx) in row.source_ticket_ids"
                                        :key="tid"
                                        :to="formatTicketLink(tid)"
                                        class="text-zinc-400 hover:text-white underline"
                                    >#{{ tid }}<span v-if="idx < row.source_ticket_ids.length - 1">, </span></NuxtLink>
                                </span>
                            </div>
                            <span v-if="row.reviewer" class="text-zinc-500">
                                Reviewed by <InternalEntityRef :id="row.reviewer.id" type="user" :label="formatReviewerHandle(row.reviewer)" />
                            </span>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">English</label>
                                <input
                                    v-model="ensureEdit(row).question_en"
                                    :disabled="row.status !== 'pending'"
                                    class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none disabled:opacity-60"
                                    placeholder="Question"
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
                                Accept
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
                                :title="editHasChanges(row) ? 'Saves English edits, then retranslates to Spanish' : 'Retranslate English to Spanish'"
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
                <h2 class="text-lg font-bold mb-1">Published FAQ</h2>
                <p class="text-sm text-zinc-500 mb-4">
                    These are the entries rendered on /docs/faq right now. Reorder, edit, or remove as needed.
                </p>

                <div v-if="entries.length === 0" class="text-sm text-zinc-500 py-12 text-center border border-dashed border-zinc-800">
                    No FAQ entries yet.
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
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div class="space-y-2">
                                            <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">English</label>
                                            <input
                                                v-model="entryEdits[entry.id]!.question_en"
                                                class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
                                            >
                                            <textarea
                                                v-model="entryEdits[entry.id]!.answer_en"
                                                rows="3"
                                                class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none resize-y"
                                            />
                                        </div>
                                        <div class="space-y-2">
                                            <label class="text-xs uppercase tracking-wide text-zinc-500 font-bold">Spanish</label>
                                            <input
                                                v-model="entryEdits[entry.id]!.question_es"
                                                class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
                                            >
                                            <textarea
                                                v-model="entryEdits[entry.id]!.answer_es"
                                                rows="3"
                                                class="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none resize-y"
                                            />
                                        </div>
                                    </div>
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
                                    <div class="flex items-center gap-2 mb-1">
                                        <span
                                            class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                                            :class="
                                                entry.source === 'ai_generated'
                                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                            "
                                        >
                                            {{ entry.source === 'ai_generated' ? 'AI' : 'Manual' }}
                                        </span>
                                        <span class="text-xs text-zinc-500">sort: {{ entry.sort_order }}</span>
                                    </div>
                                    <p class="font-bold text-sm text-white">{{ entry.question_en }}</p>
                                    <p class="text-sm text-zinc-400 mt-1"><InternalLinkifyText :text="entry.answer_en" /></p>
                                    <p v-if="entry.question_es" class="font-bold text-xs text-zinc-500 mt-3">{{ entry.question_es }}</p>
                                    <p v-if="entry.answer_es" class="text-xs text-zinc-500 mt-1"><InternalLinkifyText :text="entry.answer_es" /></p>
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
    </div>
</template>
