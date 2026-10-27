<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";

definePageMeta({
    layout: "internal",
});

interface UserListItem {
    id: string;
    name: string;
    slack_id: string | null;
    hackatime_id: number | null;
    email?: string | null;
    image: string | null;
    username: string | null;
    trustFactor: "Green" | "Blue" | "Yellow" | "Red";
    createdAt: string;
    roles: string[] | null;
    isShadowBanned: boolean;
    canImpersonate?: boolean;
    totalShips: number;
    projectCount: number;
    projects: {
        id: number;
        name: string;
        created_at: string | null;
    }[];
    ships: {
        id: number;
        status: string;
        created_at: string | null;
        project_name: string | null;
    }[];
}

const route = useRoute();
const router = useRouter();
const searchQuery = ref(typeof route.query.search === "string" ? route.query.search : "");
const filters = ref({
    trustFactor: "all",
});

const currentPage = ref(1);
const itemsPerPage = 12;

const usersData = ref<{ users: UserListItem[]; page: number; limit: number; total: number } | null>(
    null,
);
const pending = ref(true);
const error = ref<unknown>(null);

async function fetchUsers() {
    pending.value = true;
    error.value = null;
    try {
        usersData.value = await $fetch<{ users: UserListItem[]; page: number; limit: number; total: number }>("/api/internal/users", {
            params: {
                search: searchQuery.value,
                page: currentPage.value,
                limit: itemsPerPage,
                ...(filters.value.trustFactor !== "all"
                    ? { trustFactor: filters.value.trustFactor }
                    : {}),
            },
        });
    } catch (e: unknown) {
        error.value = e;
        const err = e as { statusCode?: number };
        if (err?.statusCode === 401 || err?.statusCode === 403) {
            navigateTo("/?login=required");
        }
    } finally {
        pending.value = false;
    }
}

onMounted(fetchUsers);
watch([searchQuery, () => filters.value.trustFactor, currentPage], fetchUsers);

watch(
    () => filters.value.trustFactor,
    () => {
        currentPage.value = 1;
    },
);

watch(
    () => route.query.search,
    (value) => {
        const next = typeof value === "string" ? value : "";
        if (next !== searchQuery.value) {
            searchQuery.value = next;
            currentPage.value = 1;
        }
    },
);

watch(searchQuery, (value) => {
    router.replace({
        query: {
            ...route.query,
            search: value.trim() || undefined,
            page: undefined,
        },
    });
});

const users = computed(() => usersData.value?.users ?? []);
const totalUsers = computed(() => usersData.value?.total ?? 0);
const totalPages = computed(() => {
    if (!usersData.value) return 1;
    return Math.max(1, Math.ceil(totalUsers.value / itemsPerPage));
});

const { data: meData } = useFetch<{
    permissions: { canSeePii: boolean; canImpersonate: boolean; canAccessBackups: boolean };
}>("/api/internal/me", { server: false });
const canImpersonate = computed(
    () => meData.value?.permissions?.canImpersonate ?? false,
);
const showPii = computed(() => meData.value?.permissions?.canSeePii ?? false);
const canAccessBackups = computed(
    () => meData.value?.permissions?.canAccessBackups ?? false,
);
const impersonatingUserId = ref<string | null>(null);
const impersonationError = ref("");

async function impersonateUser(user: UserListItem) {
    if (!canImpersonate.value || !user.canImpersonate) return;

    impersonatingUserId.value = user.id;
    impersonationError.value = "";

    try {
        window.location.href = (await $fetch<{ redirectTo?: string }>(
            `/api/internal/users/${user.id}/impersonate`,
            { method: "POST" },
        )).redirectTo ?? "/dashboard";
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        impersonationError.value =
            err?.data?.message ??
            err?.data?.statusMessage ??
            "Failed to start impersonation";
    } finally {
        impersonatingUserId.value = null;
    }
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div
                class="flex items-end justify-between border-b border-zinc-800 pb-4 relative z-30"
            >
                <div class="flex flex-col gap-1">
                    <h1 class="text-3xl font-bold text-white tracking-tight">
                        Users
                    </h1>
                    <p class="text-zinc-400 text-sm">
                        Manage and search for contributors across the program.
                    </p>
                    <NuxtLink
                        v-if="canAccessBackups"
                        to="/internal/users/backups"
                        class="mt-1 inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-white transition-colors w-fit"
                    >
                        <span>Backups</span>
                        <span aria-hidden="true">→</span>
                    </NuxtLink>
                </div>

                <div class="flex flex-wrap gap-4">
                    <div class="flex flex-col gap-1.5">
                        <label
                            class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1"
                            >Search</label
                        >
                        <div class="relative">
                            <input
                                v-model="searchQuery"
                                type="text"
                                placeholder="Name, Slack, Email..."
                                class="bg-zinc-900/60 hover:bg-zinc-800/80 backdrop-blur-md border border-zinc-800 text-zinc-100 placeholder-zinc-500 text-sm px-4 py-2 focus:outline-none focus:border-zinc-500 transition-all w-64 h-10"
                            >
                        </div>
                    </div>

                    <div class="flex flex-col gap-1.5">
                        <label
                            class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1"
                            >Trust Factor</label
                        >
                        <select
                            v-model="filters.trustFactor"
                            class="bg-zinc-900/60 hover:bg-zinc-800/80 backdrop-blur-md border border-zinc-800 text-zinc-300 text-sm px-4 py-2 focus:outline-none focus:border-zinc-500 transition-all h-10 min-w-[140px]"
                        >
                            <option value="all">All Factors</option>
                            <option value="Green">Green</option>
                            <option value="Blue">Blue</option>
                            <option value="Yellow">Yellow</option>
                            <option value="Red">Red</option>
                        </select>
                    </div>

                </div>
            </div>

            <div
                v-if="pending"
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
                <div
                    v-for="i in 6"
                    :key="i"
                    class="border border-zinc-800 bg-zinc-900/40 p-6 animate-pulse"
                >
                    <div class="h-12 w-12 bg-zinc-800 rounded-full mb-4"/>
                    <div class="h-4 bg-zinc-800 rounded w-3/4 mb-2"/>
                    <div class="h-3 bg-zinc-800 rounded w-1/2"/>
                </div>
            </div>

            <div
                v-else
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
                <p
                    v-if="impersonationError"
                    class="col-span-full border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                    {{ impersonationError }}
                </p>
                <InternalUserCard
                    v-for="user in users"
                    :key="user.id"
                    :user="user"
                    :can-impersonate="canImpersonate && !!user.canImpersonate"
                    :impersonating="impersonatingUserId === user.id"
                    :show-pii="showPii"
                    @view-profile="(u) => navigateTo(`/internal/users/${u.id}`)"
                    @impersonate="impersonateUser"
                />
                <div
                    v-if="users.length === 0"
                    class="col-span-full py-20 flex flex-col items-center justify-center text-zinc-500 gap-3 border border-dashed border-zinc-800 bg-zinc-900/10 backdrop-blur-sm"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="opacity-30"
                    >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p class="text-sm">
                        No users found matching your search query.
                    </p>
                </div>
            </div>

            <div
                v-if="totalPages > 1"
                class="flex items-center justify-between border-t border-zinc-800 pt-6"
            >
                <p class="text-xs text-zinc-500">
                    Showing
                    <span class="text-white">{{
                        (currentPage - 1) * itemsPerPage + 1
                    }}</span
                    >-
                    <span class="text-white">{{
                        Math.min(currentPage * itemsPerPage, users.length)
                    }}</span>
                    of
                    <span class="text-white">{{ users.length }}</span>
                    users
                </p>
                <InternalPagination
                    v-model:current-page="currentPage"
                    :total-pages="totalPages"
                />
            </div>
        </div>
    </div>
</template>
