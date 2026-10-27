<script setup lang="ts">
import { X } from "lucide-vue-next";

import { useRealtime } from "~/composables/useRealtime";

definePageMeta({ layout: false });

type Ticket = {
  id: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const props = defineProps<{ embeddedWindowed?: boolean }>();
const emit = defineEmits<{ close: []; "open-ticket": [number] }>();

const { t } = useI18n();
const route = useRoute();
const { user: currentUser } = useAuth();
const isWindowed = computed(
  () => props.embeddedWindowed || route.query.windowed === "1",
);

const items = ref<Ticket[]>([]);
const loading = ref(true);

async function load(): Promise<void> {
  try {
    items.value = (await $fetch<{ items: Ticket[] }>("/api/support/tickets")).items;
  } catch (err) {
    console.error("[support] load failed", err);
  } finally {
    loading.value = false;
  }
}

function openTicket(id: number): void {
  if (props.embeddedWindowed) {
    emit("open-ticket", id);
  } else {
    navigateTo(`/support/${id}`);
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

function categoryLabel(category: string): string {
  const key = `support.category.${category}`;
  const translated = t(key);
  return translated === key ? category : translated;
}

function priorityLabel(priority: string): string {
  const key = `support.priority.${priority}`;
  const translated = t(key);
  return translated === key ? priority : translated;
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString();
}

const rt = useRealtime();
let listRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(): void {
  if (listRefreshTimer) return;
  listRefreshTimer = setTimeout(() => {
    listRefreshTimer = null;
    void load();
  }, 800);
}
let unsubList: (() => void) | null = null;

onMounted(() => {
  void load();
  if (currentUser.value?.id) {
    unsubList = rt.subscribe(
      `tickets:queue:user:${currentUser.value.id}`,
      () => {
        scheduleRefresh();
      },
    );
  }
});

onBeforeUnmount(() => {
  unsubList?.();
  if (listRefreshTimer) clearTimeout(listRefreshTimer);
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
          <div class="flex items-center justify-between mb-4">
            <h1 class="text-2xl font-bold text-ds-brown">{{ $t("support.list_heading") }}</h1>
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

          <div v-if="loading" class="text-center text-ds-brown/60 py-10">
            {{ $t("support.loading") }}
          </div>
          <div
            v-else-if="items.length === 0"
            class="text-center text-ds-brown/60 py-10"
          >
            {{ $t("support.empty") }}
          </div>
          <ul v-else class="space-y-2">
            <li
              v-for="t in items"
              :key="t.id"
              class="border border-ds-brown/20 bg-white/40 p-3 cursor-pointer hover:bg-white/70 transition-colors"
              @click="openTicket(t.id)"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="font-semibold text-ds-brown truncate">
                  {{ t.subject }}
                </div>
                <span
                  class="text-[10px] font-bold uppercase px-2 py-0.5"
                  :class="STATUS_COLORS[displayStatus(t.status)] ?? 'bg-ds-brown/20 text-ds-brown'"
                >
                  {{ statusLabel(t.status) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-xs text-ds-brown/60 mt-1">
                <span>{{ categoryLabel(t.category) }} / {{ priorityLabel(t.priority) }}</span>
                <span>{{ formatDate(t.updated_at) }}</span>
              </div>
            </li>
          </ul>
        </div>
      </component>
    </div>
  </div>
</template>
