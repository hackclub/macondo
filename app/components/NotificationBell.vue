<script setup lang="ts">
import { Bell, ChevronDown, ChevronUp, X } from "lucide-vue-next";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useFocusTrap } from "~/composables/useFocusTrap";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

type Notification = {
  id: number;
  user_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

type ListResponse = {
  items: Notification[];
  unread_count: number;
  next_cursor: number | null;
};

const { t } = useI18n();
const open = ref(false);
const loading = ref(false);
const items = ref<Notification[]>([]);
const cursor = ref<number | null>(null);
const hasMore = ref(true);
const unreadCount = ref(0);

// notifications without an action_url can't navigate, so clicking expands their clamped body;
// overflowingIds limits the expand affordance to bodies that actually overflow
const expandedIds = ref<Set<number>>(new Set());
const overflowingIds = ref<Set<number>>(new Set());
const bodyEls = new Map<number, HTMLElement>();
// MarkdownContent renders async and the modal rewraps, so a one-shot measure would miss
let bodyObserver: ResizeObserver | null = null;

function setBodyRef(id: number, refObj: unknown): void {
  const el =
    refObj && typeof refObj === "object" && "$el" in refObj
      ? (refObj as { $el: unknown }).$el
      : refObj;
  const prev = bodyEls.get(id);
  if (prev && prev !== el) bodyObserver?.unobserve(prev);
  if (el instanceof HTMLElement) {
    bodyEls.set(id, el);
    bodyObserver?.observe(el);
  } else if (prev) {
    bodyEls.delete(id);
  }
}

// Expanded ids stay flagged so collapse stays available. Only write on change:
// inline `:ref` callbacks re-run every render and would loop with the observer.
function measureOverflow(): void {
  const next = new Set<number>();
  for (const [id, el] of bodyEls) {
    if (expandedIds.value.has(id) || el.scrollHeight - el.clientHeight > 4) {
      next.add(id);
    }
  }
  const cur = overflowingIds.value;
  if (cur.size === next.size && [...next].every((id) => cur.has(id))) return;
  overflowingIds.value = next;
}

function isExpandable(n: Notification): boolean {
  return !n.action_url;
}
function isExpanded(id: number): boolean {
  return expandedIds.value.has(id);
}
function canToggle(n: Notification): boolean {
  return isExpandable(n) && (overflowingIds.value.has(n.id) || isExpanded(n.id));
}
function toggleExpand(id: number): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
  void nextTick(measureOverflow);
}

const titleId = useId();
const dialogEl = ref<HTMLElement | null>(null);
const newNotificationAnnouncement = ref("");
let firstCountLoad = true;
let announcementTimer: ReturnType<typeof setTimeout> | null = null;

useEscapeClose(open, () => { open.value = false; });
useFocusTrap(open, dialogEl);

watch(unreadCount, (next, prev) => {
  if (firstCountLoad) {
    firstCountLoad = false;
    return;
  }
  if (next > prev) {
    const delta = next - prev;
    newNotificationAnnouncement.value = t("a11y.n_new_notifications", delta, { count: delta });
    if (announcementTimer) clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => {
      newNotificationAnnouncement.value = "";
    }, 3000);
  }
});

async function fetchPage(initial: boolean): Promise<void> {
  loading.value = true;
  try {
    const res = await $fetch<ListResponse>(
      `/api/notifications${initial ? "?limit=20" : `?cursor=${cursor.value}&limit=20`}`,
    );
    if (initial) {
      items.value = res.items;
      unreadCount.value = res.unread_count;
    } else {
      items.value.push(...res.items);
    }
    cursor.value = res.next_cursor;
    hasMore.value = res.next_cursor !== null;
    void nextTick(measureOverflow);
  } catch (err) {
    console.error("[notification-bell] fetch failed", err);
  } finally {
    loading.value = false;
  }
}

async function pollCount(): Promise<void> {
  try {
    unreadCount.value = (await $fetch<{ count: number }>(
      "/api/notifications/unread-count",
    )).count;
  } catch {
    // silent
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // pre-warm so opening the bell doesn't flash loading; also seeds unreadCount
  void fetchPage(true);
  pollTimer = setInterval(() => {
    void pollCount();
  }, 30_000);
  if (typeof ResizeObserver !== "undefined") {
    bodyObserver = new ResizeObserver(() => measureOverflow());
    for (const el of bodyEls.values()) bodyObserver.observe(el);
  }
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (announcementTimer) clearTimeout(announcementTimer);
  bodyObserver?.disconnect();
  bodyObserver = null;
});

async function openModal(): Promise<void> {
  open.value = true;
  cursor.value = null;
  hasMore.value = true;
  // items aren't cleared so the old list shows until fetchPage swaps in the fresh one
  void fetchPage(true);
}

async function markRead(n: Notification): Promise<void> {
  if (n.read_at) return;
  try {
    await $fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    n.read_at = new Date().toISOString();
    unreadCount.value = Math.max(0, unreadCount.value - 1);
  } catch (err) {
    console.error("[notification-bell] mark read failed", err);
  }
}

async function markAllRead(): Promise<void> {
  try {
    await $fetch("/api/notifications/read-all", { method: "POST" });
    for (const n of items.value) {
      if (!n.read_at) n.read_at = new Date().toISOString();
    }
    unreadCount.value = 0;
  } catch (err) {
    console.error("[notification-bell] mark all read failed", err);
  }
}

function handleClick(n: Notification): void {
  void markRead(n);
  if (n.action_url) {
    open.value = false;
    navigateTo(n.action_url, { external: n.action_url.startsWith("http") });
    return;
  }
  if (canToggle(n)) toggleExpand(n.id);
}

function formatRelative(ts: string): string {
  const diffMins = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}
</script>

<template>
  <div>
    <!-- explicit heights match the adjacent text chips; icon-only would be 4px shorter -->
    <button
      type="button"
      class="relative flex items-center justify-center gap-2 h-[34px] sm:h-[38px] md:h-[46px] px-3 md:px-4 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown text-xs sm:text-sm md:text-base font-bold text-ds-brown hover:bg-parchment transition-colors"
      :aria-label="unreadCount > 0 ? t('a11y.notifications_with_unread', unreadCount, { count: unreadCount }) : t('a11y.notifications')"
      @click="openModal"
    >
      <Bell class="w-4 h-4 md:w-5 md:h-5" />
      <span
        v-if="unreadCount > 0"
        class="absolute -top-2 -right-2 bg-ds-danger text-ds-cream text-[10px] md:text-xs font-bold min-w-[18px] md:min-w-[22px] h-[18px] md:h-[22px] px-1 rounded-full flex items-center justify-center border-2 border-ds-brown"
      >
        {{ unreadCount > 99 ? "99+" : unreadCount }}
      </span>
    </button>

    <div aria-live="polite" aria-atomic="true" class="sr-only">
      <span v-if="newNotificationAnnouncement">{{ newNotificationAnnouncement }}</span>
    </div>

    <Teleport to="body">
      <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
        <div
          v-if="open"
          class="fixed inset-0 z-[499] bg-black/40"
          @click.self="open = false"
        />
      </Transition>
      <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
        <div
          v-if="open"
          class="fixed inset-0 z-[500] flex items-center justify-center p-4 pointer-events-none"
          @click.self="open = false"
        >
        <div
          ref="dialogEl"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          class="w-full max-w-xl max-h-[80vh] flex flex-col pointer-events-auto"
        >
          <WoodFrame class="w-full flex-1 min-h-0">
            <div class="p-2 sm:p-3 flex flex-col min-h-0 max-h-[70vh]">
            <div class="flex items-center justify-between mb-4">
              <h2 :id="titleId" class="text-xl font-bold text-ds-brown">{{ t('notifications.heading') }}</h2>
              <div class="flex items-center gap-3">
                <button
                  v-if="unreadCount > 0"
                  class="text-xs text-ds-brown/70 hover:text-ds-brown underline"
                  type="button"
                  @click="markAllRead"
                >
                  {{ t('notifications.mark_all_read') }}
                </button>
                <button
                  type="button"
                  class="text-ds-brown/60 hover:text-ds-brown"
                  :aria-label="t('common.close')"
                  @click="open = false"
                >
                  <X class="w-5 h-5" />
                </button>
              </div>
            </div>

            <div
              v-if="loading && items.length === 0"
              class="text-center text-ds-brown/60 py-10"
            >
              {{ t('common.loading') }}...
            </div>
            <div
              v-else-if="items.length === 0"
              class="text-center text-ds-brown/60 py-10"
            >
              {{ t('notifications.empty') }}
            </div>
            <ul v-else class="space-y-2 overflow-y-auto pr-1 min-h-0">
              <li
                v-for="n in items"
                :key="n.id"
                class="border border-ds-brown/20 bg-white/40 p-3 cursor-pointer transition-colors hover:bg-white/70"
                :class="n.read_at ? 'opacity-70' : 'border-l-4 border-l-ds-brown'"
                :aria-expanded="canToggle(n) ? isExpanded(n.id) : undefined"
                @click="handleClick(n)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="font-semibold text-ds-brown text-sm">
                    {{ n.title }}
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <div class="text-[11px] text-ds-brown/50 whitespace-nowrap">
                      {{ formatRelative(n.created_at) }}
                    </div>
                    <component
                      :is="isExpanded(n.id) ? ChevronUp : ChevronDown"
                      v-if="canToggle(n)"
                      class="w-3.5 h-3.5 text-ds-brown/40"
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <MarkdownContent
                  v-if="n.type === 'admin_announcement'"
                  :ref="(el) => setBodyRef(n.id, el)"
                  :source="n.body"
                  class="mt-1 text-xs"
                  :class="isExpanded(n.id) ? '' : 'max-h-32 overflow-hidden'"
                />
                <div
                  v-else
                  :ref="(el) => setBodyRef(n.id, el)"
                  class="text-xs text-ds-brown/80 mt-1"
                  :class="isExpanded(n.id) ? '' : 'line-clamp-3'"
                >
                  {{ n.body }}
                </div>
              </li>
            </ul>

            <div v-if="hasMore && items.length > 0" class="mt-3 text-center">
              <button
                class="ds-btn-ghost text-xs"
                type="button"
                :disabled="loading"
                @click="fetchPage(false)"
              >
                {{ loading ? `${t('common.loading')}...` : t('notifications.load_more') }}
              </button>
            </div>
            </div>
          </WoodFrame>
        </div>
      </div>
      </Transition>
    </Teleport>
  </div>
</template>
