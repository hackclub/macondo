<script setup lang="ts">
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

defineProps<{
  messages: Message[];
  attachments: Attachment[];
  currentUserId?: string;
}>();

function isImage(mime?: string | null): boolean {
  return !!mime && mime.startsWith("image/");
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString();
}

function attachmentsFor(messageId: number, all: Attachment[]): Attachment[] {
  return all.filter((a) => a.message_id === messageId);
}

function isCapybara(m: Message): boolean {
  return m.author_kind === "capybara" || m.author_kind === "supporter_llm";
}

// Only bullets and [text](url): the sole producer is server-side Capybara output,
// and the URL allowlist keeps it tight anyway.
function renderCapybaraBody(body: string): string {
  const out: string[] = [];
  let inList = false;
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      if (!inList) {
        out.push("<ul class=\"list-disc pl-5 my-1 space-y-0.5\">");
        inList = true;
      }
      out.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (line.length === 0) {
      out.push("<div class=\"h-1\"></div>");
    } else {
      out.push(`<p class="my-1">${renderInline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function renderInline(text: string): string {
  // only http(s) or /support/N links; anything else stays escaped text
  return escapeHtml(text).replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|\/support\/)[^\s)]+)\)/g,
    (_match, label: string, url: string) =>
      `<a href="${url}" class="text-ds-brown underline decoration-ds-brown/40 hover:decoration-ds-brown">${label}</a>`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="m in messages"
      :key="m.client_dedup_key ?? m.id"
      class="border p-3 transition-opacity"
      :class="[
        isCapybara(m)
          ? 'border-ds-success bg-ds-success/10'
          : m.is_internal_note
            ? 'border-ds-warning bg-ds-warning/10'
            : 'border-ds-brown/20 bg-white/50',
        m.pending ? 'opacity-60' : '',
      ]"
    >
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2">
          <span
            v-if="isCapybara(m)"
            class="inline-flex items-center justify-center w-5 h-5 bg-ds-success/30 border border-ds-success text-[11px]"
            aria-hidden="true"
          >
            CB
          </span>
          <img
            v-else-if="m.author_image"
            :src="m.author_image"
            class="w-5 h-5 rounded-full"
            alt=""
          >
          <span class="text-xs font-semibold text-ds-brown">
            <template v-if="isCapybara(m)">
              {{ $t("support.capybara_author") }}
            </template>
            <template v-else>
              {{ m.author_name ?? $t("support.unknown_author") }}
            </template>
          </span>
          <span
            v-if="isCapybara(m)"
            class="text-[10px] bg-ds-success/30 text-ds-brown px-1.5 py-0.5 border border-ds-success"
          >
            {{ $t("support.capybara_label") }}
          </span>
          <span
            v-if="m.is_internal_note"
            class="text-[10px] bg-ds-warning/30 text-ds-brown px-1.5 py-0.5 border border-ds-warning"
          >
            {{ $t("support.internal_note") }}
          </span>
        </div>
        <span class="text-[11px] text-ds-brown/50">{{ formatTime(m.created_at) }}</span>
      </div>
      <div
        v-if="isCapybara(m)"
        class="text-sm text-ds-brown break-words"
        v-html="renderCapybaraBody(m.body)"
      />
      <div
        v-else
        class="text-sm text-ds-brown whitespace-pre-wrap break-words"
      >
        {{ m.body }}
      </div>
      <div
        v-if="attachmentsFor(m.id, attachments).length > 0"
        class="mt-2 flex flex-wrap gap-2"
      >
        <a
          v-for="a in attachmentsFor(m.id, attachments)"
          :key="a.id"
          :href="a.url"
          target="_blank"
          class="inline-flex items-center gap-1 text-xs border border-ds-brown/30 bg-white/60 px-2 py-1 hover:bg-white"
        >
          <img
            v-if="isImage(a.mime_type)"
            :src="a.url"
            class="max-h-24 max-w-40 border border-ds-brown/20"
          >
          <span v-else>{{ a.filename }}</span>
        </a>
      </div>
    </div>
  </div>
</template>
