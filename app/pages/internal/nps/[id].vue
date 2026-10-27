<script setup lang="ts">
import { computed, ref } from "vue";

definePageMeta({ layout: "internal" });

type Reply = {
    id: number;
    body: string;
    created_at: string;
    is_inbound: boolean;
    slack_delivered: boolean;
    slack_error: string | null;
    responder: {
        id: string;
        name: string | null;
        image: string | null;
    } | null;
};
type SubmissionDetail = {
    id: number;
    score: number;
    doing_well: string;
    can_improve: string;
    anything_else: string | null;
    created_at: string;
    resolved_at: string | null;
    resolved_by: {
        id: string;
        name: string | null;
        image: string | null;
    } | null;
    user: {
        id: string;
        name: string | null;
        image: string | null;
        slack_id: string | null;
        username: string | null;
    };
    replies: Reply[];
};

const route = useRoute();
const id = computed(() => route.params.id as string);

const { data, pending, error, refresh } = useFetch<SubmissionDetail>(
    () => `/api/internal/nps/submissions/${id.value}`,
    { server: false },
);

const replyText = ref("");
const replyBusy = ref(false);
const replyError = ref<string | null>(null);

const resolveBusy = ref(false);
const resolveError = ref<string | null>(null);

async function toggleResolved(): Promise<void> {
    if (!data.value || resolveBusy.value) return;
    resolveBusy.value = true;
    resolveError.value = null;
    const next = !data.value.resolved_at;
    try {
        await $fetch(`/api/internal/nps/submissions/${id.value}/resolve`, {
            method: "POST",
            body: { resolved: next },
        });
        await refresh();
    } catch (err) {
        resolveError.value =
            (err as { statusMessage?: string })?.statusMessage ||
            (err as Error)?.message ||
            "Failed to update";
    } finally {
        resolveBusy.value = false;
    }
}

function scoreClass(score: number): string {
    if (score >= 9) return "text-emerald-200 border-emerald-500/40 bg-emerald-500/10";
    if (score >= 7) return "text-sky-200 border-sky-500/40 bg-sky-500/10";
    return "text-red-200 border-red-500/40 bg-red-500/10";
}

function scoreBucket(score: number): string {
    if (score >= 9) return "Promoter";
    if (score >= 7) return "Passive";
    return "Detractor";
}

function formatDateTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function userHandle(u: SubmissionDetail["user"]): string {
    return u.slack_id ?? u.username ?? (u.name ?? u.id.slice(0, 8)); // short id fallback
}

async function submitReply(): Promise<void> {
    const text = replyText.value.trim();
    if (text.length < 3) {
        replyError.value = "Reply must be at least 3 characters";
        return;
    }
    if (text.length > 2000) {
        replyError.value = "Reply must be at most 2000 characters";
        return;
    }
    replyBusy.value = true;
    replyError.value = null;
    try {
        const res = await $fetch<{ ok: boolean; reply: Reply }>(
            `/api/internal/nps/submissions/${id.value}/reply`,
            { method: "POST", body: { body: text } },
        );
        replyText.value = "";
        if (res.reply.slack_error) {
            replyError.value = `Saved, but Slack DM failed: ${res.reply.slack_error}`;
        }
        await refresh();
    } catch (err) {
        replyError.value =
            (err as { statusMessage?: string })?.statusMessage ||
            (err as Error)?.message ||
            "Failed to send reply";
    } finally {
        replyBusy.value = false;
    }
}

function goBack(): void {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        navigateTo("/internal/nps");
    }
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex items-center justify-between gap-4 flex-wrap">
                <button
                    class="flex items-center gap-2 text-zinc-500 hover:text-white text-sm transition-colors"
                    @click="goBack"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back to NPS
                </button>
                <NuxtLink
                    v-if="data?.user"
                    :to="`/internal/users/${data.user.id}`"
                    class="text-sm text-zinc-400 hover:text-white transition-colors"
                >
                    Open user profile
                </NuxtLink>
            </div>

            <div v-if="pending" class="border border-zinc-800 bg-zinc-900/40 p-6">
                <div class="animate-pulse flex flex-col gap-4">
                    <div class="h-7 w-64 bg-zinc-800 rounded" />
                    <div class="h-4 w-full bg-zinc-800 rounded" />
                    <div class="h-4 w-2/3 bg-zinc-800 rounded" />
                </div>
            </div>

            <div v-else-if="error || !data" class="border border-red-500/20 bg-red-500/5 p-6 text-red-300">
                Failed to load submission.
            </div>

            <template v-else>
                <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
                    <div class="flex flex-col gap-6">
                        <div class="border border-zinc-800 bg-zinc-900/35 p-6 flex flex-col gap-5">
                            <div class="flex items-start justify-between gap-4 flex-wrap">
                                <div class="min-w-0 flex flex-col gap-2">
                                    <p class="text-sm text-zinc-500">
                                        NPS submission #{{ data.id }}
                                    </p>
                                    <div class="flex items-center gap-3 flex-wrap">
                                        <h1 class="text-2xl md:text-3xl font-bold text-white tracking-tight break-words min-w-0">
                                            {{ data.user.name || userHandle(data.user) }}
                                        </h1>
                                        <span
                                            class="px-2.5 py-1 text-xs font-bold uppercase tracking-wide border"
                                            :class="scoreClass(data.score)"
                                        >
                                            {{ data.score }}/10 · {{ scoreBucket(data.score) }}
                                        </span>
                                    </div>
                                    <div class="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                                        <span class="font-mono tracking-tight">{{ userHandle(data.user) }}</span>
                                        <span>·</span>
                                        <span>Submitted {{ formatDateTime(data.created_at) }}</span>
                                        <span v-if="!data.user.slack_id" class="ml-1 px-2 py-0.5 border border-red-500/40 bg-red-500/10 text-red-200 font-bold uppercase tracking-wide">
                                            No Slack id
                                        </span>
                                        <span
                                            v-if="data.resolved_at"
                                            class="ml-1 px-2 py-0.5 border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 font-bold uppercase tracking-wide"
                                        >
                                            ✓ Resolved{{ data.resolved_by?.name ? ` by ${data.resolved_by.name}` : '' }} · {{ formatDateTime(data.resolved_at) }}
                                        </span>
                                    </div>
                                </div>
                                <NuxtLink
                                    :to="`/internal/users/${data.user.id}`"
                                    class="shrink-0 block"
                                >
                                    <img
                                        v-if="data.user.image"
                                        :src="data.user.image"
                                        :alt="data.user.name ?? ''"
                                        class="w-14 h-14 rounded-full border border-zinc-700 bg-black object-cover"
                                    >
                                    <div
                                        v-else
                                        class="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white bg-black border border-zinc-700"
                                    >
                                        {{ (data.user.name ?? "?").charAt(0).toUpperCase() }}
                                    </div>
                                </NuxtLink>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div class="border border-emerald-500/20 bg-emerald-500/5 p-4">
                                    <div class="text-[10px] font-bold uppercase tracking-wide text-emerald-400/80 mb-2">
                                        Doing well
                                    </div>
                                    <p class="text-sm text-zinc-200 whitespace-pre-wrap m-0">
                                        <InternalLinkifyText :text="data.doing_well" />
                                    </p>
                                </div>
                                <div class="border border-amber-500/20 bg-amber-500/5 p-4">
                                    <div class="text-[10px] font-bold uppercase tracking-wide text-amber-400/80 mb-2">
                                        Can improve
                                    </div>
                                    <p class="text-sm text-zinc-200 whitespace-pre-wrap m-0">
                                        <InternalLinkifyText :text="data.can_improve" />
                                    </p>
                                </div>
                            </div>
                            <div v-if="data.anything_else" class="border border-zinc-800 bg-zinc-950/60 p-4">
                                <div class="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-2">
                                    Anything else
                                </div>
                                <p class="text-sm text-zinc-300 whitespace-pre-wrap m-0">
                                    <InternalLinkifyText :text="data.anything_else" />
                                </p>
                            </div>
                        </div>

                        <div class="border border-zinc-800 bg-zinc-900/35 p-6 flex flex-col gap-4">
                            <div class="flex items-baseline justify-between gap-3 flex-wrap">
                                <h2 class="text-lg font-bold text-white">
                                    Thread
                                </h2>
                                <span class="text-xs text-zinc-500">
                                    {{ data.replies.length }}
                                    {{ data.replies.length === 1 ? "reply" : "replies" }}
                                </span>
                            </div>

                            <div v-if="data.replies.length === 0" class="border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500 text-center">
                                No replies yet. Send the first one from the form on the right.
                            </div>

                            <ul v-else class="flex flex-col gap-3 list-none m-0 p-0">
                                <li
                                    v-for="r in data.replies"
                                    :key="r.id"
                                    class="border p-4 flex gap-3"
                                    :class="r.is_inbound
                                        ? 'border-sky-500/30 bg-sky-500/5'
                                        : 'border-pink-500/20 bg-pink-500/5'"
                                >
                                    <img
                                        v-if="r.responder?.image"
                                        :src="r.responder.image"
                                        :alt="r.responder.name ?? ''"
                                        class="w-8 h-8 rounded-full border border-zinc-700 bg-black object-cover shrink-0"
                                    >
                                    <div
                                        v-else
                                        class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-black border border-zinc-700 shrink-0"
                                    >
                                        {{ (r.responder?.name ?? "?").charAt(0).toUpperCase() }}
                                    </div>
                                    <div class="flex-1 min-w-0 flex flex-col gap-1">
                                        <div class="flex items-baseline gap-2 flex-wrap">
                                            <span class="text-sm font-semibold text-zinc-100">
                                                <template v-if="r.responder"><InternalEntityRef :id="r.responder.id" type="user" :label="r.responder.name" /></template><template v-else>Unknown responder</template>
                                            </span>
                                            <span
                                                v-if="r.is_inbound"
                                                class="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-sky-400/50 bg-sky-500/10 text-sky-200"
                                            >
                                                From user
                                            </span>
                                            <span class="text-[11px] text-zinc-500">
                                                {{ formatDateTime(r.created_at) }}
                                            </span>
                                            <span
                                                v-if="!r.is_inbound && !r.slack_delivered"
                                                class="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-red-500/40 bg-red-500/10 text-red-200"
                                                :title="r.slack_error ?? undefined"
                                            >
                                                DM failed
                                            </span>
                                            <span
                                                v-else-if="!r.is_inbound"
                                                class="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                            >
                                                DM sent
                                            </span>
                                        </div>
                                        <p class="text-sm text-zinc-200 whitespace-pre-wrap m-0">
                                            <InternalLinkifyText :text="r.body" />
                                        </p>
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <aside class="xl:sticky xl:top-24 border border-zinc-800 bg-zinc-900/35 p-5 flex flex-col gap-4">
                        <div class="flex flex-col gap-1">
                            <h2 class="text-lg font-bold text-white">Send a reply</h2>
                            <span class="text-xs text-zinc-500">
                                Lands in their Slack DMs as a message from you.
                            </span>
                        </div>

                        <form class="flex flex-col gap-3" @submit.prevent="submitReply">
                            <label class="flex flex-col gap-1">
                                <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                                    Message
                                    <span class="text-zinc-600 font-normal normal-case tracking-normal ml-1">
                                        ({{ replyText.length }}/2000)
                                    </span>
                                </span>
                                <textarea
                                    v-model="replyText"
                                    rows="8"
                                    maxlength="2000"
                                    required
                                    :disabled="replyBusy || !data.user.slack_id"
                                    :placeholder="data.user.slack_id
                                        ? 'Thanks for the feedback…'
                                        : 'User has no Slack id — can\u2019t DM them.'"
                                    class="bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                                />
                            </label>

                            <div
                                v-if="replyError"
                                class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-xs"
                            >
                                {{ replyError }}
                            </div>

                            <button
                                type="submit"
                                :disabled="replyBusy || replyText.trim().length < 3 || !data.user.slack_id"
                                class="px-4 py-2 text-sm font-bold border border-pink-400 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {{ replyBusy ? "Sending…" : "Send DM" }}
                            </button>
                        </form>

                        <div class="border-t border-zinc-800 pt-4 flex flex-col gap-2">
                            <span class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                                Triage
                            </span>
                            <span class="text-xs text-zinc-500">
                                {{ data.resolved_at
                                    ? "Marked resolved. Reopen if there's more to follow up on."
                                    : "Mark resolved when no further reply is needed (e.g. user just said thanks)." }}
                            </span>
                            <button
                                type="button"
                                :disabled="resolveBusy"
                                class="px-4 py-2 text-sm font-bold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                :class="data.resolved_at
                                    ? 'border-zinc-600 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800'
                                    : 'border-emerald-400 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'"
                                @click="toggleResolved"
                            >
                                {{ resolveBusy
                                    ? (data.resolved_at ? "Reopening…" : "Resolving…")
                                    : (data.resolved_at ? "Reopen" : "Mark resolved") }}
                            </button>
                            <div
                                v-if="resolveError"
                                class="border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-xs"
                            >
                                {{ resolveError }}
                            </div>
                        </div>
                    </aside>
                </div>
            </template>
        </div>
    </div>
</template>
