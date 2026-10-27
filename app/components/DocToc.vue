<script setup lang="ts">
interface TocEntry {
  id: string;
  text: string;
  depth: number;
}

const props = withDefaults(
  defineProps<{
    contentSelector?: string;
    accent?: string;
  }>(),
  {
    contentSelector: ".prose-brown",
    accent: "#684D3A",
  },
);

const { t } = useI18n();
const route = useRoute();
const entries = ref<TocEntry[]>([]);
const activeId = ref<string | null>(null);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function buildToc(): TocEntry[] {
  const container = document.querySelector(props.contentSelector);
  if (!container) return [];
  const list: TocEntry[] = [];
  container.querySelectorAll("h2, h3").forEach((el) => {
    const text = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (!text) return;
    let id = el.id;
    if (!id) {
      id = slugify(text);
      el.id = id;
    }
    list.push({
      id,
      text,
      depth: el.tagName === "H2" ? 2 : 3,
    });
  });
  return list;
}

// Closest heading above a line near the top; unlike IntersectionObserver, no dead zones.
function updateActive() {
  if (entries.value.length === 0) return;
  let best: string | null = entries.value[0]?.id ?? null;
  for (const entry of entries.value) {
    const el = document.getElementById(entry.id);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= 140) { // px from viewport top marking the active heading
      best = entry.id;
    } else {
      break;
    }
  }
  if (best !== activeId.value) activeId.value = best;
}

let rafId: number | null = null;
function scheduleUpdate() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    updateActive();
  });
}

// Vue's out-in page transition can swap the container, so this keeps re-attaching.
let contentObserver: MutationObserver | null = null;
let watchedContainer: Element | null = null;

function ensureContentObserver() {
  const container = document.querySelector(props.contentSelector);
  if (!container) return false;
  if (container === watchedContainer && contentObserver) return true;
  contentObserver?.disconnect();
  watchedContainer = container;
  contentObserver = new MutationObserver(() => {
    const fresh = buildToc();
    if (
      fresh.length !== entries.value.length ||
      fresh.some((e, i) => e.id !== entries.value[i]?.id)
    ) {
      entries.value = fresh;
      updateActive();
    }
  });
  contentObserver.observe(container, { childList: true, subtree: true, characterData: true });
  return true;
}

let bodyObserver: MutationObserver | null = null;

function rebuildNow() {
  ensureContentObserver();
  entries.value = buildToc();
  updateActive();
}

// Retries because content can hydrate late.
function rebuildWithRetries() {
  rebuildNow();
  for (const d of [50, 150, 400, 1000, 2500]) { // ms retry delays after mount
    setTimeout(rebuildNow, d);
  }
}

function scrollTo(id: string, evt: Event) {
  evt.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  activeId.value = id;
  setTimeout(() => {
    history.replaceState(null, "", `#${id}`);
  }, 400); // let the smooth scroll finish before updating the hash
}

onMounted(() => {
  rebuildWithRetries();

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });

  // Watch the whole body so we re-attach when .prose-brown is swapped.
  bodyObserver = new MutationObserver(() => {
    ensureContentObserver();
    scheduleUpdate();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
});

onUnmounted(() => {
  window.removeEventListener("scroll", scheduleUpdate);
  window.removeEventListener("resize", scheduleUpdate);
  contentObserver?.disconnect();
  bodyObserver?.disconnect();
  if (rafId !== null) cancelAnimationFrame(rafId);
});

watch(
  () => route.fullPath,
  () => {
    activeId.value = null;
    entries.value = [];
    nextTick(() => rebuildWithRetries());
  },
);
</script>

<template>
  <nav v-if="entries.length > 0" class="doc-toc text-sm">
    <div
      class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-ds-brown/60 mb-3 pb-2 border-b-2 border-ds-brown/15"
    >
      <span class="w-2 h-2 rounded-full" :style="{ background: accent }" />
      <span>{{ t("docs.on_this_page") }}</span>
    </div>
    <ul class="flex flex-col gap-0.5 list-none m-0 p-0">
      <li
        v-for="entry in entries"
        :key="entry.id"
      >
        <a
          :href="`#${entry.id}`"
          class="doc-toc-link relative block py-1.5 pl-3 pr-2 no-underline leading-snug transition-colors cursor-pointer border-l-2"
          :class="[
            entry.depth === 3 ? 'pl-6 text-xs' : 'text-sm',
            activeId === entry.id
              ? 'text-ds-brown font-semibold bg-ds-brown/5'
              : 'text-ds-brown/55 hover:text-ds-brown hover:bg-ds-brown/5',
          ]"
          :style="activeId === entry.id
            ? { borderLeftColor: accent }
            : { borderLeftColor: 'transparent' }"
          @click="scrollTo(entry.id, $event)"
        >
          {{ entry.text }}
        </a>
      </li>
    </ul>
  </nav>
  <nav v-else class="doc-toc text-sm text-ds-brown/40">
    <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-ds-brown/40">
      {{ t("docs.on_this_page") }}
    </div>
    <p class="mt-2 text-xs m-0">{{ t("docs.toc_empty") }}</p>
  </nav>
</template>
