<script setup lang="ts">
import { useTicketStream, type ViewerInfo } from "~/composables/useTicketStream";

definePageMeta({ layout: "internal", key: (route) => route.fullPath });

type Ticket = {
  id: number;
  user_id: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  auto_resolve_warned_at: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  bts_channel_id: string | null;
  bts_message_ts: string | null;
  created_at: string;
};

type Author = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  slack_id: string | null;
};

type Message = {
  id: number;
  body: string;
  author_user_id: string | null;
  author_kind?: string;
  is_internal_note: boolean;
  slack_ts?: string | null;
  client_dedup_key?: string | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  original_body?: string | null;
  author_name: string | null;
  author_image?: string | null;
  pending?: boolean;
};

type Attachment = {
  id: number;
  message_id: number;
  url: string;
  filename: string;
  size_bytes?: number | null;
  mime_type?: string | null;
};

type NewAttachment = {
  url: string;
  filename: string;
  size_bytes?: number;
  mime_type?: string;
  sha?: string;
};

type ReviewerHandle = {
  id: string;
  username: string | null;
};

type DetailResponse = {
  ticket: Ticket;
  author: Author;
  claimed_by: ReviewerHandle | null;
  resolved_by: ReviewerHandle | null;
  messages: Message[];
  attachments: Attachment[];
};

const route = useRoute();
const ticketId = Number(route.params.id);
const { user: currentUser } = useAuth();

const ticket = ref<Ticket | null>(null);
const author = ref<Author | null>(null);
const claimedBy = ref<ReviewerHandle | null>(null);
const resolvedBy = ref<ReviewerHandle | null>(null);
const messages = ref<Message[]>([]);
const attachments = ref<Attachment[]>([]);
const loading = ref(true);

const reply = ref("");
const replyAttachments = ref<NewAttachment[]>([]);
const replying = ref(false);
const isInternalNote = ref(false);

const error = ref<string | null>(null);

async function load(): Promise<void> {
  try {
    const res = await $fetch<DetailResponse>(
      `/api/internal/support/tickets/${ticketId}`,
    );
    ticket.value = res.ticket;
    author.value = res.author;
    claimedBy.value = res.claimed_by;
    resolvedBy.value = res.resolved_by;
    messages.value = res.messages;
    attachments.value = res.attachments;
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      "Failed to load ticket";
  } finally {
    loading.value = false;
  }
}

function lastSeenMessageId(): number | null {
  let max = 0;
  for (const m of messages.value) {
    if (m.id > 0 && m.id > max) max = m.id;
  }
  return max > 0 ? max : null;
}

function mergeMessage(incoming: Message, incomingAttachments: Attachment[]): void {
  const list = [...messages.value];
  let idx = -1;
  if (incoming.client_dedup_key) {
    idx = list.findIndex((m) => m.client_dedup_key === incoming.client_dedup_key);
  }
  if (idx < 0) idx = list.findIndex((m) => m.id === incoming.id);

  if (idx >= 0) {
    const old = list[idx]!;
    if (old.id !== incoming.id) {
      // Drop temp-id attachments; incomingAttachments is the source of truth.
      attachments.value = attachments.value.filter(
        (a) => a.message_id !== old.id,
      );
    }
    list.splice(idx, 1, { ...old, ...incoming, pending: false });
    messages.value = list;
  } else {
    messages.value = [...list, { ...incoming, pending: false }];
  }

  if (incomingAttachments.length > 0) {
    const known = new Set(attachments.value.map((a) => a.id));
    const additions = incomingAttachments.filter((a) => !known.has(a.id));
    if (additions.length > 0) {
      attachments.value = [...attachments.value, ...additions];
    }
  }
}

const stream = useTicketStream(ticketId, {
  scope: "internal",
  presence: true,
  getLastSeenMessageId: lastSeenMessageId,
  onMessage: (msg, atts) => mergeMessage(msg as Message, atts as Attachment[]),
  onMessageEdited: (patch) => {
    const idx = messages.value.findIndex((m) => m.id === patch.id);
    if (idx === -1) return;
    const current = messages.value[idx];
    if (!current) return;
    messages.value = [
      ...messages.value.slice(0, idx),
      {
        ...current,
        body: patch.body,
        edited_at: typeof patch.edited_at === "string" ? patch.edited_at : (patch.edited_at?.toISOString?.() ?? null),
        deleted_at: typeof patch.deleted_at === "string" ? patch.deleted_at : (patch.deleted_at?.toISOString?.() ?? null),
        original_body: patch.original_body ?? current.original_body ?? null,
      },
      ...messages.value.slice(idx + 1),
    ];
  },
  onMessageDeleted: (messageId) => {
    const idx = messages.value.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const current = messages.value[idx];
    if (!current) return;
    messages.value = [
      ...messages.value.slice(0, idx),
      { ...current, deleted_at: new Date().toISOString() },
      ...messages.value.slice(idx + 1),
    ];
  },
  onStatusChange: (evt) => {
    if (!ticket.value) return;
    ticket.value = {
      ...ticket.value,
      status: evt.status || ticket.value.status,
      claimed_by_user_id: (evt.claimed_by_user_id ?? ticket.value.claimed_by_user_id) as string | null,
      resolved_by_user_id: (evt.resolved_by_user_id ?? ticket.value.resolved_by_user_id) as string | null,
    };
  },
});

const viewers = stream.viewers;
const typingUsers = stream.typingUsers;
const otherViewers = computed<ViewerInfo[]>(() =>
  (viewers.value ?? []).filter((v) => v.userId !== currentUser.value?.id),
);
const otherTypers = computed(() =>
  typingUsers.value.filter((u) => u.userId !== currentUser.value?.id),
);

async function claim(): Promise<void> {
  await $fetch(`/api/internal/support/tickets/${ticketId}/claim`, {
    method: "POST",
  });
  if (ticket.value) {
    ticket.value = {
      ...ticket.value,
      status: "claimed",
      claimed_by_user_id: currentUser.value?.id ?? ticket.value.claimed_by_user_id,
    };
  }
}

async function resolve(): Promise<void> {
  await $fetch(`/api/internal/support/tickets/${ticketId}/resolve`, {
    method: "POST",
  });
  if (ticket.value) ticket.value = { ...ticket.value, status: "resolved" };
}

async function close(): Promise<void> {
  if (!confirm("Close this ticket? User cannot reopen by replying.")) return;
  await $fetch(`/api/internal/support/tickets/${ticketId}/close`, {
    method: "POST",
  });
  if (ticket.value) ticket.value = { ...ticket.value, status: "closed" };
}

function nextTempId(): number {
  // Negative ids never collide with real serial ids; we render in append order.
  return -(Date.now() + Math.floor(Math.random() * 1000));
}

async function sendReply(): Promise<void> {
  if (!reply.value.trim() || replying.value) return;
  replying.value = true;
  const dedupKey = (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`).slice(0, 64); // dedup key length cap

  const replyText = reply.value;
  const replyIsInternal = isInternalNote.value;
  const replyAtts = replyAttachments.value.slice();

  const tempId = nextTempId();
  const optimistic: Message = {
    id: tempId,
    body: replyText,
    author_user_id: currentUser.value?.id ?? "",
    is_internal_note: replyIsInternal,
    client_dedup_key: dedupKey,
    created_at: new Date().toISOString(),
    author_name: currentUser.value?.name ?? null,
    author_image: currentUser.value?.image ?? null,
    pending: true,
  };
  const optimisticAttachments: Attachment[] = replyAtts.map((a, i) => ({
    id: -(Date.now() * 10 + i + 1),
    message_id: tempId,
    url: a.url,
    filename: a.filename,
    size_bytes: a.size_bytes ?? null,
    mime_type: a.mime_type ?? null,
  }));

  messages.value = [...messages.value, optimistic];
  if (optimisticAttachments.length > 0) {
    attachments.value = [...attachments.value, ...optimisticAttachments];
  }

  reply.value = "";
  replyAttachments.value = [];
  isInternalNote.value = false;
  stream.emitTyping("stop");

  try {
    await $fetch<{ ok: boolean; id: number }>(
      `/api/internal/support/tickets/${ticketId}/messages`,
      {
        method: "POST",
        body: {
          body: replyText,
          is_internal_note: replyIsInternal,
          attachments: replyAtts,
          client_dedup_key: dedupKey,
        },
      },
    );
    // Clear pending ourselves in case the realtime echo never arrives (redis down).
    setTimeout(() => {
      const i = messages.value.findIndex((m) => m.client_dedup_key === dedupKey);
      if (i >= 0 && messages.value[i]!.pending) {
        const list = [...messages.value];
        list[i] = { ...list[i]!, pending: false };
        messages.value = list;
      }
    }, 1500);
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      "Failed to send reply";
    messages.value = messages.value.filter((m) => m.client_dedup_key !== dedupKey);
    attachments.value = attachments.value.filter(
      (a) => a.message_id !== tempId,
    );
    reply.value = replyText;
    replyAttachments.value = replyAtts;
    isInternalNote.value = replyIsInternal;
  } finally {
    replying.value = false;
  }
}

const slackUrl = computed(() => {
  if (!ticket.value?.slack_channel_id || !ticket.value?.slack_thread_ts) return null;
  return `https://hackclub.enterprise.slack.com/archives/${ticket.value.slack_channel_id}/p${ticket.value.slack_thread_ts.replace(".", "")}`;
});

function statusPill(status: string): string {
  if (status === "open") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "claimed") return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  if (status === "resolved") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return "border-zinc-700 bg-zinc-800/40 text-zinc-400";
}

function isImage(mime?: string | null): boolean {
  return !!mime && mime.startsWith("image/");
}

function attachmentsFor(messageId: number): Attachment[] {
  return attachments.value.filter((a) => a.message_id === messageId);
}

async function uploadFile(file: File): Promise<NewAttachment | null> {
  const form = new FormData();
  form.append("file", file);
  try {
    return await $fetch<NewAttachment>("/api/support/uploads", {
      method: "POST",
      body: form,
    });
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      "upload failed";
    return null;
  }
}

const fileInput = ref<HTMLInputElement | null>(null);
async function onPickFiles(): Promise<void> {
  const input = fileInput.value;
  if (!input?.files || input.files.length === 0) return;
  for (const f of Array.from(input.files)) {
    const a = await uploadFile(f);
    if (a) replyAttachments.value.push(a);
  }
  input.value = "";
}

function humanSize(b?: number | null): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// Emit "start" once per burst; the server keeps the chip alive until "stop" on blur or idle.
const typingActive = ref(false);
let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
function onReplyInput(): void {
  if (!typingActive.value) {
    typingActive.value = true;
    stream.emitTyping("start");
  }
  if (typingIdleTimer) clearTimeout(typingIdleTimer);
  typingIdleTimer = setTimeout(() => {
    typingActive.value = false;
    stream.emitTyping("stop");
    typingIdleTimer = null;
  }, 4000); // stop typing indicator after 4s idle
}
function onReplyBlur(): void {
  if (typingActive.value) {
    typingActive.value = false;
    stream.emitTyping("stop");
  }
  if (typingIdleTimer) {
    clearTimeout(typingIdleTimer);
    typingIdleTimer = null;
  }
}

const typingLabel = computed(() => {
  const list = otherTypers.value;
  if (list.length === 0) return "";
  if (list.length === 1) return `${list[0]!.name} is typing...`;
  if (list.length === 2) return `${list[0]!.name} and ${list[1]!.name} are typing...`;
  return `${list.length} people are typing...`;
});

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-4xl mx-auto flex flex-col gap-6">
      <NuxtLink
        to="/internal/support"
        class="text-xs text-zinc-500 hover:text-white transition-colors self-start"
      >
        ← Support queue
      </NuxtLink>

      <div v-if="loading" class="border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-500 text-sm">
        Loading...
      </div>
      <div
        v-else-if="error"
        class="border border-red-500/20 bg-red-500/5 p-6 text-red-300 text-sm"
      >
        {{ error }}
      </div>
      <template v-else-if="ticket">
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <h1 class="text-3xl font-bold text-white tracking-tight">
              #{{ ticket.id }} {{ ticket.subject }}
            </h1>
            <div class="flex items-center gap-3">
              <div
                v-if="otherViewers.length > 0"
                class="flex items-center gap-1.5"
                :title="otherViewers.map((v) => v.name).join(', ')"
              >
                <div class="flex -space-x-2">
                  <img
                    v-for="v in otherViewers.slice(0, 4)"
                    :key="v.userId"
                    :src="v.image ?? undefined"
                    :alt="v.name"
                    class="w-6 h-6 rounded-full border-2 border-zinc-900 bg-zinc-700 object-cover"
                  >
                  <span
                    v-if="otherViewers.length > 4"
                    class="w-6 h-6 rounded-full border-2 border-zinc-900 bg-zinc-800 text-zinc-300 text-[10px] font-bold flex items-center justify-center"
                  >+{{ otherViewers.length - 4 }}</span>
                </div>
                <span class="text-[10px] text-zinc-400 uppercase tracking-widest">viewing</span>
              </div>
              <span
                class="text-[10px] font-bold uppercase px-2 py-1 border tracking-widest"
                :class="statusPill(ticket.status)"
              >
                {{ ticket.status }}
              </span>
              <span
                v-if="ticket.auto_resolve_warned_at && (ticket.status === 'open' || ticket.status === 'claimed')"
                class="text-[10px] font-bold uppercase px-2 py-1 border tracking-widest border-amber-500/40 bg-amber-500/10 text-amber-300"
                title="Capybara warned the owner. Auto-resolves if no reply within 24h."
              >
                auto-resolve warned
              </span>
            </div>
          </div>
          <p class="text-zinc-400 text-sm mt-1">
            {{ ticket.category }} / {{ ticket.priority }} • opened {{ new Date(ticket.created_at).toLocaleString() }}
            <template v-if="ticket.claimed_by_user_id">
              <span class="text-zinc-600">•</span>
              <span class="text-zinc-500">Claimed by <InternalEntityRef v-if="claimedBy" :id="claimedBy.id" type="user" :label="formatReviewerHandle(claimedBy)" /></span>
            </template>
            <template v-if="ticket.resolved_by_user_id">
              <span class="text-zinc-600">•</span>
              <span class="text-zinc-500">Resolved by <InternalEntityRef v-if="resolvedBy" :id="resolvedBy.id" type="user" :label="formatReviewerHandle(resolvedBy)" /></span>
            </template>
            <template v-else-if="ticket.status === 'resolved'">
              <span class="text-zinc-600">•</span>
              <span class="text-zinc-500">Auto-resolved by Capybara</span>
            </template>
          </p>
        </div>

        <div
          v-if="author"
          class="border border-zinc-800 bg-zinc-900/40 p-4 flex items-center gap-3"
        >
          <img
            v-if="author.image"
            :src="author.image"
            class="w-9 h-9 rounded-full border border-zinc-700 bg-black object-cover"
            alt=""
          >
          <div class="flex flex-col">
            <span class="text-sm font-semibold text-white">{{ author.name ?? "unknown" }}</span>
            <span class="text-xs text-zinc-500">{{ author.email }}</span>
          </div>
          <div class="ml-auto flex items-center gap-3 text-xs">
            <a
              v-if="slackUrl"
              :href="slackUrl"
              target="_blank"
              class="text-zinc-300 hover:text-white underline underline-offset-2"
            >Open in Slack</a>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-if="ticket.status === 'open'"
            class="px-3 py-1.5 text-[11px] font-bold border border-blue-500/40 text-blue-200 hover:bg-blue-500/10 transition-colors"
            @click="claim"
          >
            Claim
          </button>
          <button
            v-if="ticket.status === 'open' || ticket.status === 'claimed'"
            class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors"
            @click="resolve"
          >
            Mark resolved
          </button>
          <button
            v-if="ticket.status !== 'closed'"
            class="px-3 py-1.5 text-[11px] font-bold border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors"
            @click="close"
          >
            Close
          </button>
        </div>

        <div class="border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-200 whitespace-pre-wrap">
          <InternalLinkifyText :text="ticket.body" />
        </div>

        <div class="flex flex-col gap-3">
          <div
            v-for="m in messages"
            :key="m.client_dedup_key ?? m.id"
            class="border bg-zinc-900/40 p-4 transition-opacity"
            :class="[
              (m.author_kind === 'capybara' || m.author_kind === 'supporter_llm')
                ? 'border-emerald-500/40'
                : m.is_internal_note
                  ? 'border-amber-500/30'
                  : 'border-zinc-800',
              m.pending ? 'opacity-60' : '',
            ]"
          >
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span
                  v-if="(m.author_kind === 'capybara' || m.author_kind === 'supporter_llm')"
                  class="inline-flex items-center justify-center w-5 h-5 bg-emerald-500/20 border border-emerald-500/40 text-[10px] text-emerald-200"
                  aria-hidden="true"
                >CB</span>
                <img
                  v-else-if="m.author_image"
                  :src="m.author_image"
                  class="w-5 h-5 rounded-full border border-zinc-700"
                  alt=""
                >
                <span class="text-xs font-semibold text-zinc-200">
                  <template v-if="(m.author_kind === 'capybara' || m.author_kind === 'supporter_llm')">Capybara</template>
                  <template v-else>{{ m.author_name ?? "unknown" }}</template>
                </span>
                <span
                  v-if="(m.author_kind === 'capybara' || m.author_kind === 'supporter_llm')"
                  class="text-[10px] uppercase font-bold border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 px-1.5 py-0.5 tracking-widest"
                >
                  auto-reply
                </span>
                <span
                  v-if="m.is_internal_note"
                  class="text-[10px] uppercase font-bold border border-amber-500/40 text-amber-200 bg-amber-500/10 px-1.5 py-0.5 tracking-widest"
                >
                  internal
                </span>
                <span
                  v-if="m.pending"
                  class="text-[10px] uppercase font-bold border border-zinc-600 text-zinc-400 px-1.5 py-0.5 tracking-widest"
                >sending</span>
                <span
                  v-if="m.edited_at && !m.deleted_at"
                  class="text-[10px] uppercase font-bold border border-blue-500/40 text-blue-300 bg-blue-500/10 px-1.5 py-0.5 tracking-widest"
                  :title="`Edited at ${new Date(m.edited_at).toLocaleString()}`"
                >edited</span>
                <span
                  v-if="m.deleted_at"
                  class="text-[10px] uppercase font-bold border border-red-500/40 text-red-300 bg-red-500/10 px-1.5 py-0.5 tracking-widest"
                  :title="`Deleted at ${new Date(m.deleted_at).toLocaleString()}`"
                >deleted</span>
              </div>
              <span class="text-[11px] text-zinc-500">{{ new Date(m.created_at).toLocaleString() }}</span>
            </div>
            <div
              class="text-sm whitespace-pre-wrap break-words"
              :class="m.deleted_at ? 'text-zinc-500 italic line-through' : 'text-zinc-200'"
            ><InternalLinkifyText :text="m.body" /></div>
            <details
              v-if="m.original_body && m.original_body !== m.body"
              class="mt-1 text-[11px] text-zinc-500"
            >
              <summary class="cursor-pointer hover:text-zinc-400">show original</summary>
              <div class="mt-1 pl-3 border-l border-zinc-700 whitespace-pre-wrap break-words text-zinc-400">{{ m.original_body }}</div>
            </details>
            <div
              v-if="attachmentsFor(m.id).length > 0"
              class="mt-3 flex flex-wrap gap-2"
            >
              <a
                v-for="a in attachmentsFor(m.id)"
                :key="a.id"
                :href="a.url"
                target="_blank"
                class="inline-flex items-center gap-2 text-xs border border-zinc-700 bg-black/40 px-2 py-1 hover:border-zinc-500 transition-colors text-zinc-200"
              >
                <img
                  v-if="isImage(a.mime_type)"
                  :src="a.url"
                  class="max-h-20 max-w-32 border border-zinc-700"
                >
                <span v-else>{{ a.filename }}</span>
              </a>
            </div>
          </div>
        </div>

        <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-300">Reply</h3>
            <label class="text-xs flex items-center gap-1 text-zinc-400 select-none cursor-pointer">
              <input v-model="isInternalNote" type="checkbox" class="accent-amber-400">
              <span>Internal note (staff only)</span>
            </label>
          </div>
          <div
            v-if="typingLabel"
            class="text-[11px] italic text-zinc-400 border-l-2 border-zinc-600 pl-2"
          >{{ typingLabel }}</div>
          <textarea
            v-model="reply"
            rows="4"
            class="w-full bg-black/40 border border-zinc-700 text-sm px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 resize-none"
            :placeholder="isInternalNote ? 'Staff-only note (not shown to user)' : 'Reply to user (mirrors to Slack and notifies them)'"
            @input="onReplyInput"
            @blur="onReplyBlur"
          />
          <input
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onPickFiles"
          >
          <ul v-if="replyAttachments.length > 0" class="flex flex-col gap-1">
            <li
              v-for="(a, i) in replyAttachments"
              :key="a.url"
              class="flex items-center gap-2 text-xs text-zinc-300 border border-zinc-800 bg-black/40 px-2 py-1"
            >
              <a :href="a.url" target="_blank" class="underline truncate flex-1">{{ a.filename }}</a>
              <span class="text-zinc-500">{{ humanSize(a.size_bytes) }}</span>
              <button
                type="button"
                class="text-red-300 hover:text-red-200"
                @click="replyAttachments.splice(i, 1)"
              >remove</button>
            </li>
          </ul>
          <div class="flex items-center justify-between gap-3">
            <button
              type="button"
              class="px-3 py-1.5 text-[11px] font-bold border border-zinc-600 text-zinc-300 hover:bg-zinc-700/30 transition-colors"
              @click="fileInput?.click()"
            >
              + attach file
            </button>
            <button
              class="bg-white hover:bg-zinc-200 text-black text-[13px] font-bold px-5 py-2 transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-white"
              :disabled="!reply.trim() || replying"
              @click="sendReply"
            >
              {{ replying ? "Sending..." : isInternalNote ? "Save note" : "Send reply" }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
