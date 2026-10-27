<script setup lang="ts">
const props = defineProps<{
    currentPage: number;
    totalPages: number;
}>();

const emit = defineEmits<{
    "update:currentPage": [value: number];
}>();

const { t } = useI18n();

const visiblePages = computed<(number | "ellipsis")[]>(() => {
    const total = props.totalPages;
    const current = props.currentPage;
    if (total <= 7) { // few enough pages to show them all
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const sorted = [...new Set<number>([1, total, current, current - 1, current + 1])]
        .filter((n) => n >= 1 && n <= total)
        .sort((a, b) => a - b);

    const out: (number | "ellipsis")[] = [];
    let prev = 0;
    for (const n of sorted) {
        if (n - prev > 1) out.push("ellipsis");
        out.push(n);
        prev = n;
    }
    return out;
});

function goTo(page: number) {
    if (page < 1 || page > props.totalPages || page === props.currentPage) return;
    emit("update:currentPage", page);
}
</script>

<template>
    <nav v-if="totalPages > 1" :aria-label="t('pagination.label')" class="flex items-center gap-2">
        <button
            :disabled="currentPage === 1"
            :aria-label="t('pagination.previous_page')"
            class="p-2 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            @click="goTo(currentPage - 1)"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <polyline points="15 18 9 12 15 6" />
            </svg>
        </button>

        <div class="flex items-center gap-1">
            <template v-for="(entry, i) in visiblePages" :key="`${entry}-${i}`">
                <span
                    v-if="entry === 'ellipsis'"
                    class="w-8 h-8 flex items-center justify-center text-xs text-zinc-500 select-none"
                    aria-hidden="true"
                >
                    …
                </span>
                <button
                    v-else
                    :aria-label="t('pagination.go_to_page', { n: entry })"
                    :aria-current="currentPage === entry ? 'page' : undefined"
                    class="w-8 h-8 text-xs font-bold transition-all border"
                    :class="[
                        currentPage === entry
                            ? 'bg-white text-black border-white'
                            : 'bg-zinc-900/40 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-white',
                    ]"
                    @click="goTo(entry)"
                >
                    {{ entry }}
                </button>
            </template>
        </div>

        <button
            :disabled="currentPage === totalPages"
            :aria-label="t('pagination.next_page')"
            class="p-2 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            @click="goTo(currentPage + 1)"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <polyline points="9 18 15 12 9 6" />
            </svg>
        </button>
    </nav>
</template>
