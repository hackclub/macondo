<script setup lang="ts">
import { X } from "lucide-vue-next";

import { useTicketStream } from "~/composables/useTicketStream";

definePageMeta({ layout: false });

type Ticket = {
  id: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: number;
  body: string;
  author_user_id: string | null;
  author_kind?: string;
  is_internal_note: boolean;
  client_dedup_key?: string | null;
  created_at: string;
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

type DetailResponse = {
  ticket: Ticket;
  messages: Message[];
  attachments: Attachment[];
};

const props = defineProps<{
  embeddedWindowed?: boolean;
  ticketId?: number;
}>();
const emit = defineEmits<{ close: []; back: [] }>();

const { t } = useI18n();
const route = useRoute();
const { user: currentUser } = useAuth();
const isWindowed = computed(
  () => props.embeddedWindowed || route.query.windowed === "1",
);
const ticketId = computed(() =>
  props.ticketId ?? Number(route.params.id),
);

const ticket = ref<Ticket | null>(null);
const messages = ref<Message[]>([]);
const attachments = ref<Attachment[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const reply = ref("");
const replyAttachments = ref<NewAttachment[]>([]);
const replying = ref(false);
const resolving = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await $fetch<DetailResponse>(
      `/api/support/tickets/${ticketId.value}`,
    );
    ticket.value = res.ticket;
    messages.value = res.messages;
    attachments.value = res.attachments;
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      t("support.load_failed");
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
  if (incoming.is_internal_note) return;
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

// Subscribing once is safe: a different ticket always remounts this page (route param or dashboard :key).
useTicketStream(ticketId.value, {
  scope: "student",
  presence: false,
  getLastSeenMessageId: lastSeenMessageId,
  onMessage: (msg, atts) => mergeMessage(msg as Message, atts as Attachment[]),
  onStatusChange: (evt) => {
    if (!ticket.value) return;
    ticket.value = { ...ticket.value, status: evt.status || ticket.value.status };
  },
});

async function resolveOwn(): Promise<void> {
  if (resolving.value || !ticket.value) return;
  if (!confirm(t("support.confirm_resolve"))) return;
  resolving.value = true;
  try {
    await $fetch(`/api/support/tickets/${ticketId.value}/resolve`, {
      method: "POST",
    });
    if (ticket.value) ticket.value = { ...ticket.value, status: "resolved" };
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      t("support.resolve_failed");
  } finally {
    resolving.value = false;
  }
}

function nextTempId(): number {
  return -(Date.now() + Math.floor(Math.random() * 1000));
}

async function sendReply(): Promise<void> {
  if (!reply.value.trim() || replying.value) return;
  replying.value = true;
  const dedupKey = (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`).slice(0, 64); // dedup key length cap
  const replyText = reply.value;
  const replyAtts = replyAttachments.value.slice();

  const tempId = nextTempId();
  const optimistic: Message = {
    id: tempId,
    body: replyText,
    author_user_id: currentUser.value?.id ?? "",
    is_internal_note: false,
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

  try {
    await $fetch<{ ok: boolean; id: number; reopened?: boolean }>(
      `/api/support/tickets/${ticketId.value}/messages`,
      {
        method: "POST",
        body: {
          body: replyText,
          attachments: replyAtts,
          client_dedup_key: dedupKey,
        },
      },
    );
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
      t("support.reply_failed");
    messages.value = messages.value.filter((m) => m.client_dedup_key !== dedupKey);
    attachments.value = attachments.value.filter(
      (a) => a.message_id !== tempId,
    );
    reply.value = replyText;
    replyAttachments.value = replyAtts;
  } finally {
    replying.value = false;
  }
}

function back(): void {
  if (props.embeddedWindowed) {
    emit("back");
  } else {
    navigateTo("/support");
  }
}

function close(): void {
  if (props.embeddedWindowed) {
    emit("close");
  } else {
    navigateTo("/dashboard");
  }
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-ds-warning/30 text-ds-brown",
  resolved: "bg-ds-success/30 text-ds-brown",
  closed: "bg-ds-brown/20 text-ds-brown",
};

// "claimed" is internal; students only see it as "open".
function displayStatus(status: string): string {
  return status === "claimed" ? "open" : status;
}

function statusLabel(status: string): string {
  const normalized = displayStatus(status);
  if (normalized === "open") return t("support.status_open");
  if (normalized === "resolved") return t("support.status_resolved");
  if (normalized === "closed") return t("support.status_closed");
  return normalized;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div :class="isWindowed ? '' : 'min-h-screen bg-parchment pt-6 pb-10'">
    <div :class="isWindowed ? 'flex flex-col gap-4' : 'max-w-3xl mx-auto px-6 flex flex-col gap-4'">
      <NuxtLink
        v-if="!isWindowed"
        to="/dashboard"
        class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ $t("support.back_to_farm") }}
      </NuxtLink>
      <component :is="'div'" class="w-full">
        <div :class="isWindowed ? 'p-6 sm:p-8' : ''">
        <div v-if="loading" class="text-center text-ds-brown/60 py-10">
          {{ $t("support.loading") }}
        </div>
        <div v-else-if="error" class="text-center text-ds-danger py-10">
          {{ error }}
        </div>
        <div v-else-if="ticket">
          <div class="flex items-center justify-between mb-3">
            <button
              type="button"
              class="text-xs text-ds-brown/70 hover:text-ds-brown underline"
              @click="back"
            >
              ← {{ $t("support.all_tickets") }}
            </button>
            <button
              v-if="isWindowed"
              type="button"
              class="text-ds-brown/60 hover:text-ds-brown"
              :aria-label="$t('support.close')"
              @click="close"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
          <div class="flex items-start justify-between gap-3 mb-4">
            <h1 class="text-2xl font-bold text-ds-brown">{{ ticket.subject }}</h1>
            <span
              class="text-[10px] font-bold uppercase px-2 py-1 shrink-0"
              :class="STATUS_COLORS[displayStatus(ticket.status)] ?? 'bg-ds-brown/20 text-ds-brown'"
            >
              {{ statusLabel(ticket.status) }}
            </span>
          </div>

          <TicketThread :messages="messages" :attachments="attachments" />

          <div
            v-if="ticket.status === 'open' || ticket.status === 'claimed'"
            class="mt-4 flex justify-end"
          >
            <button
              class="ds-btn-success text-sm"
              :disabled="resolving"
              @click="resolveOwn"
            >
              {{ resolving ? $t("support.resolving") : $t("support.mark_resolved") }}
            </button>
          </div>

          <div
            v-if="ticket.status === 'closed'"
            class="mt-6 text-sm text-ds-brown/70 italic"
          >
            {{ $t("support.closed_notice") }}
          </div>
          <div v-else class="mt-6">
            <h3 class="text-sm font-semibold text-ds-brown mb-2">{{ $t("support.reply_heading") }}</h3>
            <textarea
              v-model="reply"
              rows="4"
              class="ds-input w-full text-sm resize-none"
              :placeholder="$t('support.reply_placeholder')"
            />
            <div class="flex items-center justify-between mt-2">
              <AttachmentUploader v-model="replyAttachments" />
              <button
                class="ds-btn-primary text-sm"
                :disabled="!reply.trim() || replying"
                @click="sendReply"
              >
                {{ replying ? $t("support.sending") : $t("support.send_reply") }}
              </button>
            </div>
          </div>
        </div>
        </div>
      </component>
    </div>
  </div>
</template>
