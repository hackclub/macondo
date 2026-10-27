<script setup lang="ts">
// gsap loaded on demand; SSR renders the list statically.
let gsapPromise: Promise<typeof import("gsap")["gsap"]> | null = null;
function loadGsap() {
  if (!gsapPromise) gsapPromise = import("gsap").then((m) => m.gsap);
  return gsapPromise;
}

definePageMeta({ layout: "dashboard", hideNavbar: true });

const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

function onNotifEnter(el: Element, done: () => void) {
    if (prefersReducedMotion()) { done(); return; }
    void loadGsap().then((gsap) => {
        gsap.fromTo(
            el as HTMLElement,
            { opacity: 0, y: -6 },
            { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", onComplete: done },
        );
    });
}

function onNotifLeave(el: Element, done: () => void) {
    if (prefersReducedMotion()) { done(); return; }
    void loadGsap().then((gsap) => {
        gsap.to(el as HTMLElement, {
            opacity: 0,
            x: 40,
            duration: 0.3,
            ease: "power2.in",
            onComplete: done,
        });
    });
}

function onFadeEnter(el: Element, done: () => void) {
    if (prefersReducedMotion()) { done(); return; }
    void loadGsap().then((gsap) => {
        gsap.fromTo(
            el as HTMLElement,
            { opacity: 0 },
            { opacity: 1, duration: 0.3, ease: "power1.out", onComplete: done },
        );
    });
}

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

// useFetch so SSR pre-populates the list; getCachedData shows the last result while a background refresh runs.
const { data: initialData } = await useFetch<ListResponse>(
  "/api/notifications",
  {
    key: "notifications-initial",
    query: { limit: 20 },
    default: () => ({ items: [], unread_count: 0, next_cursor: null }),
    getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
  },
);

const items = ref<Notification[]>([]);
const cursor = ref<number | null>(null);
const loading = ref(false);
const hasMore = ref(true);

// the empty-items guard stops a background SWR refresh clobbering "load more" pagination.
watch(
  initialData,
  (res) => {
    if (res && items.value.length === 0) {
      items.value = res.items;
      cursor.value = res.next_cursor;
      hasMore.value = res.next_cursor !== null;
    }
  },
  { immediate: true },
);

async function loadMore(): Promise<void> {
  if (loading.value || !hasMore.value) return;
  loading.value = true;
  try {
    const res = await $fetch<ListResponse>(`/api/notifications${cursor.value ? `?cursor=${cursor.value}&limit=20` : "?limit=20"}`);
    items.value.push(...res.items);
    cursor.value = res.next_cursor;
    hasMore.value = res.next_cursor !== null;
  } catch (err) {
    console.error("[notifications] load failed", err);
  } finally {
    loading.value = false;
  }
}

async function markRead(n: Notification): Promise<void> {
  if (n.read_at) return;
  try {
    await $fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    n.read_at = new Date().toISOString();
  } catch (err) {
    console.error("[notifications] mark read failed", err);
  }
}

async function markAllRead(): Promise<void> {
  try {
    await $fetch("/api/notifications/read-all", { method: "POST" });
    for (const n of items.value) {
      if (!n.read_at) n.read_at = new Date().toISOString();
    }
  } catch (err) {
    console.error("[notifications] mark all read failed", err);
  }
}

function handleClick(n: Notification): void {
  void markRead(n);
  if (n.action_url) {
    navigateTo(n.action_url, { external: n.action_url.startsWith("http") });
  }
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="min-h-screen bg-parchment pt-6 pb-12">
    <div class="max-w-3xl mx-auto px-4 flex flex-col gap-4">
      <NuxtLink
        to="/dashboard"
        class="text-sm text-ds-brown flex items-center gap-1 self-start hover:opacity-70 transition-opacity"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ $t("notifications_page.back_to_farm") }}
      </NuxtLink>

      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-ds-brown">
          {{ $t("notifications_page.heading") }}
        </h1>
        <button
          class="ds-btn-ghost text-xs active:scale-95 transition-transform"
          @click="markAllRead"
        >
          {{ $t("notifications_page.mark_all_read") }}
        </button>
      </div>

      <Transition :css="false" appear @enter="onFadeEnter">
        <div
          v-if="items.length === 0 && !loading"
          class="border-[3px] border-ds-brown/20 bg-parchment/60 p-6 text-center text-ds-brown/60"
        >
          {{ $t("notifications_page.empty") }}
        </div>
      </Transition>

      <TransitionGroup
        v-if="items.length > 0"
        tag="ul"
        :css="false"
        appear
        class="flex flex-col gap-2"
        @enter="onNotifEnter"
        @leave="onNotifLeave"
      >
        <li
          v-for="n in items"
          :key="n.id"
          class="border-[3px] border-ds-brown/25 bg-parchment/60 p-3 cursor-pointer transition-all duration-300 hover:bg-parchment/90 hover:translate-x-1"
          :class="n.read_at ? 'opacity-60' : 'border-l-[6px] border-l-ds-brown'"
          @click="handleClick(n)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="font-semibold text-ds-brown">{{ n.title }}</div>
            <div class="text-xs text-ds-brown/50 shrink-0 whitespace-nowrap">{{ formatDate(n.created_at) }}</div>
          </div>
          <MarkdownContent
            v-if="n.type === 'admin_announcement'"
            :source="n.body"
            class="mt-1 text-sm"
          />
          <div v-else class="text-sm text-ds-brown/80 mt-1">{{ n.body }}</div>
        </li>
      </TransitionGroup>

      <div v-if="hasMore" class="text-center">
        <button
          class="ds-btn-ghost text-sm active:scale-95 transition-transform"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? $t("notifications_page.loading") : $t("notifications_page.load_more") }}
        </button>
      </div>
    </div>
  </div>
</template>
