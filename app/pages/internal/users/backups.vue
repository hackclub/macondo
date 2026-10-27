<script setup lang="ts">
definePageMeta({ layout: "internal" });

type Backup = {
    id: number;
    original_user_id: string;
    original_email: string;
    original_name: string;
    nuked_by_user_id: string | null;
    nuked_by_name: string | null;
    nuked_at: string;
    reason: string | null;
    restored_at: string | null;
    restored_by_user_id: string | null;
};

const includeRestored = ref(false);
const backups = ref<Backup[]>([]);
const pending = ref(true);
const fetchError = ref("");
const restoringId = ref<number | null>(null);
const restoreError = ref("");

async function fetchBackups() {
    pending.value = true;
    fetchError.value = "";
    try {
        backups.value = (await $fetch<{ backups: Backup[] }>(
            "/api/internal/users/backups",
            { params: { includeRestored: includeRestored.value ? "true" : undefined } },
        )).backups;
    } catch (e: unknown) {
        const err = e as { statusCode?: number; data?: { message?: string; statusMessage?: string } };
        if (err?.statusCode === 401 || err?.statusCode === 403) {
            navigateTo("/?login=required");
            return;
        }
        fetchError.value = err?.data?.message ?? err?.data?.statusMessage ?? "Failed to load backups";
    } finally {
        pending.value = false;
    }
}

onMounted(fetchBackups);
watch(includeRestored, fetchBackups);

async function restoreBackup(id: number, name: string) {
    if (!confirm(`Restore ${name}? This re-inserts every row that was captured when they were nuked.`)) return;
    restoringId.value = id;
    restoreError.value = "";
    try {
        await $fetch(`/api/internal/users/backups/${id}/restore`, { method: "POST" });
        await fetchBackups();
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        restoreError.value = err?.data?.message ?? err?.data?.statusMessage ?? "Restore failed";
    } finally {
        restoringId.value = null;
    }
}

function fmtDate(ts: string | null): string {
    if (!ts) return "—";
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return ts;
    }
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <div class="flex items-center justify-between gap-4 flex-wrap">
            <div>
                <div class="flex items-center gap-3 flex-wrap">
                    <NuxtLink
                        to="/internal/users"
                        class="text-xs font-bold text-zinc-500 hover:text-white transition-colors inline-flex items-center gap-1"
                    >
                        <span>←</span>
                        <span>Users</span>
                    </NuxtLink>
                </div>
                <h1 class="text-white text-2xl font-bold mt-1">User backups</h1>
                <p class="text-zinc-400 text-sm mt-1">
                    Snapshots captured when a user is nuked. Restore re-inserts every row in the original FK order.
                </p>
            </div>
            <label class="flex items-center gap-2 text-sm text-zinc-300">
                <input
                    v-model="includeRestored"
                    type="checkbox"
                    class="accent-red-500"
                >
                Include already-restored
            </label>
        </div>

        <div v-if="fetchError" class="text-red-400 text-sm">{{ fetchError }}</div>
        <div v-if="restoreError" class="text-red-400 text-sm">{{ restoreError }}</div>

        <div v-if="pending" class="text-zinc-500 text-sm">Loading...</div>
        <div v-else-if="!backups.length" class="text-zinc-500 text-sm border border-zinc-800 p-8 text-center">
            No backups {{ includeRestored ? "" : "to restore" }}.
        </div>
        <table v-else class="w-full border border-zinc-800 text-sm">
            <thead class="bg-zinc-900/40 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                    <th class="text-left px-3 py-2 font-bold">User</th>
                    <th class="text-left px-3 py-2 font-bold">Nuked by</th>
                    <th class="text-left px-3 py-2 font-bold">Nuked at</th>
                    <th class="text-left px-3 py-2 font-bold">Reason</th>
                    <th class="text-left px-3 py-2 font-bold">Status</th>
                    <th class="text-right px-3 py-2 font-bold">Action</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="b in backups"
                    :key="b.id"
                    class="border-t border-zinc-800"
                >
                    <td class="px-3 py-2">
                        <div class="text-zinc-100">{{ b.original_name }}</div>
                        <div class="text-zinc-500 text-xs font-mono">{{ b.original_email }}</div>
                        <div class="text-zinc-600 text-[10px] font-mono">{{ b.original_user_id }}</div>
                    </td>
                    <td class="px-3 py-2 text-zinc-300">{{ b.nuked_by_name ?? b.nuked_by_user_id ?? "—" }}</td>
                    <td class="px-3 py-2 text-zinc-400 text-xs">{{ fmtDate(b.nuked_at) }}</td>
                    <td class="px-3 py-2 text-zinc-400 text-xs">{{ b.reason ?? "—" }}</td>
                    <td class="px-3 py-2">
                        <span
                            v-if="b.restored_at"
                            class="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5"
                        >Restored {{ fmtDate(b.restored_at) }}</span>
                        <span
                            v-else
                            class="text-xs text-zinc-400 bg-zinc-900 border border-zinc-700 px-2 py-0.5"
                        >Nuked</span>
                    </td>
                    <td class="px-3 py-2 text-right">
                        <button
                            v-if="!b.restored_at"
                            class="text-xs font-bold px-3 py-1.5 border border-green-700 text-green-200 bg-green-700/20 hover:bg-green-700/40 disabled:opacity-50 transition-colors"
                            :disabled="restoringId === b.id"
                            @click="restoreBackup(b.id, b.original_name)"
                        >
                            {{ restoringId === b.id ? "Restoring…" : "Restore" }}
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        </div>
    </div>
</template>
