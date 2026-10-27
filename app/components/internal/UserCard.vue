<script setup lang="ts">
interface User {
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
    isShadowBanned: boolean;
    canImpersonate?: boolean;
}

defineProps<{
    user: User;
    canImpersonate?: boolean;
    impersonating?: boolean;
    showPii?: boolean;
}>();

const emit = defineEmits<{
    (e: "viewProfile" | "impersonate", user: User): void;
}>();

const trustCardClass: Record<User["trustFactor"], string> = {
    Green: "bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-400/30",
    Blue: "bg-blue-500/10 border-blue-500/20 hover:border-blue-400/30",
    Yellow: "bg-amber-500/10 border-amber-500/20 hover:border-amber-400/30",
    Red: "bg-red-500/10 border-red-500/20 hover:border-red-400/30",
};
</script>

<template>
    <div
        class="border backdrop-blur-sm shadow-2xl p-5 flex flex-col gap-4 group transition-colors"
        :class="trustCardClass[user.trustFactor]"
    >
        <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
                <img
                    v-if="user.image"
                    :src="user.image"
                    class="w-12 h-12 rounded-full border border-zinc-800 bg-black shadow-lg"
                >
                <div
                    v-else
                    class="w-12 h-12 rounded-full border border-zinc-800 bg-zinc-900 shadow-lg flex items-center justify-center text-zinc-500 font-bold text-lg"
                >
                    {{ user.name?.charAt(0)?.toUpperCase() ?? "?" }}
                </div>
                <div class="flex flex-col">
                    <h3
                        class="text-white font-bold group-hover:text-amber-200 transition-colors"
                    >
                        {{ user.name }}
                    </h3>
                    <span
                        class="text-zinc-500 text-xs font-mono tracking-tighter"
                        >{{ user.slack_id ?? user.username ?? "—" }}</span
                    >
                </div>
            </div>
            <div class="flex flex-col items-end gap-1.5">
                <span
                    v-if="user.isShadowBanned"
                    class="text-[10px] font-bold text-red-500 flex items-center gap-1.5 leading-none"
                >
                    SHADOW BANNED
                </span>
            </div>
        </div>

        <div class="flex flex-col gap-3 py-2 border-t border-zinc-800/50">
                <div class="flex flex-col gap-1 pr-1">
                <div v-if="showPii" class="flex items-center justify-between text-xs">
                    <span class="text-zinc-500">Email</span>
                    <span class="text-zinc-300">{{ user.email ?? "—" }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                    <span class="text-zinc-500">Hackatime ID</span>
                    <span class="text-zinc-300 font-mono">{{
                        user.hackatime_id ?? "—"
                    }}</span>
                </div>
            </div>
            <div v-if="user.roles?.length" class="flex flex-col gap-1.5">
                <span
                    class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold"
                    >Assigned Roles</span
                >
                <div class="flex flex-wrap gap-1">
                    <span
                        v-for="role in user.roles"
                        :key="role"
                        class="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700 text-[10px] font-medium rounded-sm group-hover:bg-blue-500/10 group-hover:text-blue-400 group-hover:border-blue-500/20 transition-all"
                    >
                        {{ role }}
                    </span>
                </div>
            </div>
        </div>

        <div class="flex gap-2 pt-2">
            <button
                class="flex-1 bg-white/10 hover:bg-white text-white hover:text-black text-xs font-bold py-1.5 transition-all backdrop-blur-sm border border-white/5"
                @click="emit('viewProfile', user)"
            >
                View Profile
            </button>
            <button
                v-if="canImpersonate !== undefined"
                :disabled="!canImpersonate || impersonating"
                class="flex-1 text-xs font-bold py-1.5 transition-all backdrop-blur-sm border"
                :class="[
                    canImpersonate && !impersonating
                        ? 'bg-zinc-800/50 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-200 border-zinc-700/30 hover:border-amber-500/30'
                        : 'bg-zinc-900/80 text-zinc-600 border-zinc-800/50 cursor-not-allowed grayscale',
                ]"
                :title="
                    !canImpersonate
                        ? 'Impersonation restricted for this user level'
                        : ''
                "
                @click="emit('impersonate', user)"
            >
                {{ impersonating ? "Starting..." : "Impersonate" }}
            </button>
        </div>
    </div>
</template>
