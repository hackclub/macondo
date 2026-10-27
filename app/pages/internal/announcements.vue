<script setup lang="ts">
definePageMeta({ layout: "internal" });

type AnnouncementHistory = {
    id: number;
    title_en: string;
    body_en: string;
    recipient_count: number;
    created_at: string;
    created_by: string;
    author_name: string | null;
};

const TITLE_MAX = 200;
const BODY_MAX = 20_000;

const title = ref("");
const body = ref("");
const postToSlack = ref(true);
const broadcasting = ref(false);
const errorMsg = ref("");
const successMsg = ref("");
const confirmOpen = ref(false);

const { data: history, refresh: refreshHistory } = await useFetch<{
    items: AnnouncementHistory[];
}>("/api/internal/announcements", {
    server: false,
    default: () => ({ items: [] }),
});

const trimmedTitle = computed(() => title.value.trim());
const trimmedBody = computed(() => body.value.trim());
const canBroadcast = computed(
    () =>
        trimmedTitle.value.length > 0 &&
        trimmedTitle.value.length <= TITLE_MAX &&
        trimmedBody.value.length > 0 &&
        trimmedBody.value.length <= BODY_MAX,
);

function openConfirm() {
    errorMsg.value = "";
    successMsg.value = "";
    if (!canBroadcast.value) {
        errorMsg.value = "Add a title and body before broadcasting.";
        return;
    }
    confirmOpen.value = true;
}

async function doBroadcast() {
    if (!canBroadcast.value || broadcasting.value) return;
    broadcasting.value = true;
    errorMsg.value = "";
    try {
        const res = await $fetch<{ id: number; recipient_count: number }>(
            "/api/internal/announcements",
            {
                method: "POST",
                body: {
                    title: trimmedTitle.value,
                    body: trimmedBody.value,
                    slack: postToSlack.value,
                },
            },
        );
        successMsg.value = `Broadcast sent to ${res.recipient_count.toLocaleString()} user${res.recipient_count === 1 ? "" : "s"}. It will appear once on their next dashboard visit.`;
        title.value = "";
        body.value = "";
        confirmOpen.value = false;
        await refreshHistory();
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        errorMsg.value =
            err?.data?.message ?? err?.data?.statusMessage ?? "Broadcast failed.";
    } finally {
        broadcasting.value = false;
    }
}

function formatDate(value: string) {
    return new Date(value).toLocaleString();
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-5xl mx-auto flex flex-col gap-6">
            <div class="flex flex-col gap-2">
                <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Ops</p>
                <h1 class="text-3xl font-bold text-white tracking-tight">Announcements</h1>
                <p class="text-sm text-zinc-400 max-w-3xl">
                    Broadcast a one-off message to every signed-in user. It shows once as a
                    popup on their next dashboard visit and stays in their notification center.
                    Write in English with Markdown; it is auto-translated to Spanish for
                    Spanish-locale users.
                </p>
            </div>

            <p
                v-if="successMsg"
                class="border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
            >
                {{ successMsg }}
            </p>
            <p
                v-if="errorMsg"
                class="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200"
            >
                {{ errorMsg }}
            </p>

            <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-5">
                <div>
                    <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Compose</p>
                    <h2 class="text-xl font-bold text-white">New announcement</h2>
                </div>

                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                        Title
                    </label>
                    <input
                        v-model="title"
                        type="text"
                        :maxlength="TITLE_MAX"
                        placeholder="e.g. Scheduled maintenance this Saturday"
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 w-full"
                    >
                    <span class="text-[10px] text-zinc-600 self-end tabular-nums">
                        {{ trimmedTitle.length }}/{{ TITLE_MAX }}
                    </span>
                </div>

                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                        Body (Markdown)
                    </label>
                    <textarea
                        v-model="body"
                        rows="8"
                        :maxlength="BODY_MAX"
                        placeholder="Write the message. **Bold**, _italics_, lists, and [links](https://hackclub.com) are supported."
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-y w-full font-mono"
                    />
                    <span class="text-[10px] text-zinc-600 self-end tabular-nums">
                        {{ trimmedBody.length }}/{{ BODY_MAX }}
                    </span>
                </div>

                <div class="flex flex-col gap-1.5">
                    <span class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                        Preview (how users will see it)
                    </span>
                    <div class="border-[3px] border-ds-brown bg-parchment p-4">
                        <h3 v-if="trimmedTitle" class="text-lg font-bold text-ds-brown leading-tight mb-2">
                            {{ trimmedTitle }}
                        </h3>
                        <MarkdownContent v-if="trimmedBody" :source="body" />
                        <p v-else class="text-sm text-ds-brown/50 italic">
                            Nothing to preview yet.
                        </p>
                    </div>
                </div>

                <div class="flex items-center justify-between gap-4">
                    <label class="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                        <input
                            v-model="postToSlack"
                            type="checkbox"
                            class="accent-emerald-600 w-4 h-4"
                        >
                        Also post to #macondo-bulletin
                    </label>
                    <button
                        type="button"
                        class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors disabled:opacity-50"
                        :disabled="!canBroadcast || broadcasting"
                        @click="openConfirm"
                    >
                        Broadcast to all users
                    </button>
                </div>
            </section>

            <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                <div>
                    <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">History</p>
                    <h2 class="text-xl font-bold text-white">Past broadcasts</h2>
                </div>

                <p v-if="!history?.items.length" class="text-sm text-zinc-500">
                    No announcements have been sent yet.
                </p>

                <div
                    v-for="a in history?.items ?? []"
                    :key="a.id"
                    class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-1"
                >
                    <div class="flex items-start justify-between gap-3">
                        <span class="font-semibold text-white">{{ a.title_en }}</span>
                        <span class="text-[11px] text-zinc-500 shrink-0 whitespace-nowrap">
                            {{ formatDate(a.created_at) }}
                        </span>
                    </div>
                    <p class="text-sm text-zinc-400 line-clamp-2">{{ a.body_en }}</p>
                    <div class="text-[11px] text-zinc-500">
                        {{ a.recipient_count.toLocaleString() }} recipients
                        <template v-if="a.author_name">· by {{ a.author_name }}</template>
                    </div>
                </div>
            </section>
        </div>

        <Transition name="modal-fade" appear>
            <div
                v-if="confirmOpen"
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                @click.self="confirmOpen = false"
            >
                <div
                    class="modal-fade-panel relative bg-zinc-950 border border-emerald-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
                >
                    <h2 class="text-emerald-200 font-bold text-lg">Broadcast announcement?</h2>
                    <p class="text-zinc-300 text-sm">
                        This sends
                        <strong class="text-white">"{{ trimmedTitle }}"</strong>
                        to every signed-in user. Each one sees it once as a popup on their
                        next dashboard visit, and it stays in their notification center.
                    </p>
                    <p class="text-sm" :class="postToSlack ? 'text-zinc-300' : 'text-zinc-400'">
                        <template v-if="postToSlack">
                            It is also posted to
                            <strong class="text-white">#macondo-bulletin</strong> under your
                            Slack handle.
                        </template>
                        <template v-else>
                            In-site only. Nothing is posted to
                            <strong class="text-white">#macondo-bulletin</strong>.
                        </template>
                    </p>
                    <p class="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 p-2">
                        Announcements cannot be edited or recalled once sent.
                    </p>
                    <p v-if="errorMsg" class="text-red-400 text-xs">{{ errorMsg }}</p>
                    <div class="flex gap-2 justify-end">
                        <button
                            class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
                            :disabled="broadcasting"
                            @click="confirmOpen = false"
                        >
                            Cancel
                        </button>
                        <button
                            class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors disabled:opacity-50"
                            :disabled="broadcasting"
                            @click="doBroadcast"
                        >
                            {{ broadcasting ? "Broadcasting…" : "Broadcast now" }}
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>
