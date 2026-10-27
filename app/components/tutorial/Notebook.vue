<script setup lang="ts">
import { BookOpen, X, GripHorizontal } from 'lucide-vue-next';
import { useNotebookState } from '~/composables/useNotebookState';

type Phase = 'goal' | 'tinker' | 'explain' | 'apply';

const props = defineProps<{
  stepIndex: number;
  phase: Phase;
}>();

const PHASE_ORDER: Phase[] = ['goal', 'tinker', 'explain', 'apply'];

const { markOpened } = useNotebookState();

// Falls back to the English text in each entry so untranslated locales still render
const { t: tNotebook, te: teNotebook } = useI18n();
function localizeDesc(key: string, fallback: string): string {
  const full = `notebook.desc.${key}`;
  return teNotebook(full) ? tNotebook(full) : fallback;
}

const open = ref(false);
const activeTab = ref<'html' | 'tailwind'>('html');

const pos = ref({ x: 0, y: 0 });
const size = ref({ w: 340, h: 420 });

function openNotebook() {
  pos.value = { x: window.innerWidth - 360, y: window.innerHeight - 460 };
  size.value = { w: 340, h: 420 };
  open.value = true;
  markOpened();
}

const dragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });

function onDragStart(e: MouseEvent) {
  dragging.value = true;
  dragOffset.value = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y };
  e.preventDefault();
}

const resizing = ref(false);
const resizeStart = ref({ x: 0, y: 0, w: 0, h: 0 });

function onResizeStart(e: MouseEvent) {
  resizing.value = true;
  resizeStart.value = { x: e.clientX, y: e.clientY, w: size.value.w, h: size.value.h };
  e.preventDefault();
}

function onGlobalMove(e: MouseEvent) {
  if (dragging.value) {
    pos.value = {
      x: Math.max(0, Math.min(window.innerWidth - size.value.w, e.clientX - dragOffset.value.x)),
      y: Math.max(0, Math.min(window.innerHeight - size.value.h, e.clientY - dragOffset.value.y)),
    };
  }
  if (resizing.value) {
    size.value = {
      w: Math.max(280, Math.min(600, resizeStart.value.w + (e.clientX - resizeStart.value.x))),
      h: Math.max(250, Math.min(800, resizeStart.value.h + (e.clientY - resizeStart.value.y))),
    };
  }
}

function onGlobalUp() {
  dragging.value = false;
  resizing.value = false;
}

onMounted(() => {
  window.addEventListener('mousemove', onGlobalMove);
  window.addEventListener('mouseup', onGlobalUp);
});
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onGlobalMove);
  window.removeEventListener('mouseup', onGlobalUp);
});

// Steps: 0 HTML Structure, 1 Add Content, 2 Add Image, 3 Add Tailwind, 4 Style with Tailwind, 5 README.
// <p> has no phase gate because Step 0 Tinker has the learner edit it before Explain.
const htmlTags = computed<{ tag: string; desc: string; step: number; phase?: Phase }[]>(() => [
  { tag: '&lt;!DOCTYPE html&gt;', desc: localizeDesc('doctype', 'Tells the browser this is an HTML5 page'), step: 0, phase: 'explain' },
  { tag: '&lt;html&gt;', desc: localizeDesc('html', 'Root element that wraps everything'), step: 0, phase: 'explain' },
  { tag: '&lt;head&gt;', desc: localizeDesc('head', 'Invisible settings: title, stylesheets, metadata'), step: 0, phase: 'explain' },
  { tag: '&lt;title&gt;', desc: localizeDesc('title', 'Text shown in the browser tab'), step: 0, phase: 'explain' },
  { tag: '&lt;body&gt;', desc: localizeDesc('body', 'Everything the visitor sees goes here'), step: 0, phase: 'explain' },
  { tag: '&lt;p&gt;', desc: localizeDesc('p', 'A paragraph of text'), step: 0 },
  { tag: '&lt;h1&gt; to &lt;h6&gt;', desc: localizeDesc('headings', 'Headings, h1 is biggest, h6 is smallest'), step: 1, phase: 'explain' },
  { tag: '&lt;img&gt;', desc: localizeDesc('img', 'An image. Uses src for the URL and alt for a description'), step: 2, phase: 'explain' },
  { tag: '&lt;script&gt;', desc: localizeDesc('script', 'Loads external JavaScript or the Tailwind CDN'), step: 3, phase: 'explain' },
]);

// Intentionally narrow: only the class families the tutorial challenges teach
const catTextColor = computed(() => localizeDesc('cat_text_color', 'Text color'));
const catBgColor = computed(() => localizeDesc('cat_bg_color', 'Background color'));
const catTextSize = computed(() => localizeDesc('cat_text_size', 'Text size'));
const catTextStyle = computed(() => localizeDesc('cat_text_style', 'Text style'));
const catImageSize = computed(() => localizeDesc('cat_image_size', 'Image size'));

const tailwindClasses = computed<{ cls: string; desc: string; category: string; step: number; phase?: Phase }[]>(() => [
  { cls: 'text-blue-500', desc: localizeDesc('tw_text_blue_500', 'Blue text'), category: catTextColor.value, step: 3, phase: 'explain' },
  { cls: 'text-red-500', desc: localizeDesc('tw_text_red_500', 'Red text'), category: catTextColor.value, step: 3, phase: 'explain' },
  { cls: 'text-gray-800', desc: localizeDesc('tw_text_gray_800', 'Near-black text'), category: catTextColor.value, step: 3, phase: 'explain' },
  { cls: 'text-white', desc: localizeDesc('tw_text_white', 'White text'), category: catTextColor.value, step: 3, phase: 'explain' },

  { cls: 'bg-pink-100', desc: localizeDesc('tw_bg_pink_100', 'Light pink background'), category: catBgColor.value, step: 4, phase: 'explain' },
  { cls: 'bg-blue-100', desc: localizeDesc('tw_bg_blue_100', 'Light blue background'), category: catBgColor.value, step: 4, phase: 'explain' },
  { cls: 'bg-yellow-100', desc: localizeDesc('tw_bg_yellow_100', 'Light yellow background'), category: catBgColor.value, step: 4, phase: 'explain' },
  { cls: 'bg-gray-900', desc: localizeDesc('tw_bg_gray_900', 'Near-black background'), category: catBgColor.value, step: 4, phase: 'explain' },

  { cls: 'text-sm', desc: localizeDesc('tw_text_sm', 'Small text'), category: catTextSize.value, step: 4, phase: 'explain' },
  { cls: 'text-base', desc: localizeDesc('tw_text_base', 'Default text size'), category: catTextSize.value, step: 4, phase: 'explain' },
  { cls: 'text-lg', desc: localizeDesc('tw_text_lg', 'Large text'), category: catTextSize.value, step: 4, phase: 'explain' },
  { cls: 'text-xl', desc: localizeDesc('tw_text_xl', 'Extra large text'), category: catTextSize.value, step: 4, phase: 'explain' },
  { cls: 'text-4xl', desc: localizeDesc('tw_text_4xl', 'Much larger text'), category: catTextSize.value, step: 4, phase: 'explain' },
  { cls: 'text-6xl', desc: localizeDesc('tw_text_6xl', 'Huge text'), category: catTextSize.value, step: 4, phase: 'explain' },

  { cls: 'text-left', desc: localizeDesc('tw_text_left', 'Left-align text'), category: catTextStyle.value, step: 4, phase: 'explain' },
  { cls: 'text-center', desc: localizeDesc('tw_text_center', 'Center-align text'), category: catTextStyle.value, step: 4, phase: 'explain' },
  { cls: 'text-right', desc: localizeDesc('tw_text_right', 'Right-align text'), category: catTextStyle.value, step: 4, phase: 'explain' },
  { cls: 'font-bold', desc: localizeDesc('tw_font_bold', 'Bold text'), category: catTextStyle.value, step: 4, phase: 'explain' },
  { cls: 'italic', desc: localizeDesc('tw_italic', 'Italic text'), category: catTextStyle.value, step: 4, phase: 'explain' },
  { cls: 'underline', desc: localizeDesc('tw_underline', 'Underlined text'), category: catTextStyle.value, step: 4, phase: 'explain' },
  { cls: 'uppercase', desc: localizeDesc('tw_uppercase', 'ALL CAPS text'), category: catTextStyle.value, step: 4, phase: 'explain' },

  { cls: 'w-32', desc: localizeDesc('tw_w_32', 'Small image (~128px wide)'), category: catImageSize.value, step: 4, phase: 'explain' },
  { cls: 'w-64', desc: localizeDesc('tw_w_64', 'Medium image (~256px wide)'), category: catImageSize.value, step: 4, phase: 'explain' },
  { cls: 'w-96', desc: localizeDesc('tw_w_96', 'Large image (~384px wide)'), category: catImageSize.value, step: 4, phase: 'explain' },
  { cls: 'w-full', desc: localizeDesc('tw_w_full', 'Full width of its container'), category: catImageSize.value, step: 4, phase: 'explain' },
  { cls: 'rounded-lg', desc: localizeDesc('tw_rounded_lg', 'Rounded corners'), category: catImageSize.value, step: 4, phase: 'explain' },
  { cls: 'rounded-full', desc: localizeDesc('tw_rounded_full', 'Circle shape (great for avatars)'), category: catImageSize.value, step: 4, phase: 'explain' },
]);

function isItemVisible(item: { step: number; phase?: Phase }): boolean {
  if (props.stepIndex > item.step) return true;
  if (props.stepIndex < item.step) return false;
  if (!item.phase) return true;
  // Back-navigation re-hides items gated by a later phase; the tinker challenge relies on this
  return PHASE_ORDER.indexOf(props.phase) >= PHASE_ORDER.indexOf(item.phase);
}

const visibleHtmlTags = computed(() => htmlTags.value.filter(isItemVisible));
const visibleTailwindClasses = computed(() => tailwindClasses.value.filter(isItemVisible));
const hasTailwind = computed(() => visibleTailwindClasses.value.length > 0);

const groupedTailwindClasses = computed(() => {
  const groups = new Map<string, typeof visibleTailwindClasses.value>();
  for (const item of visibleTailwindClasses.value) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category)!.push(item);
  }
  return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
});

watch(hasTailwind, (val) => {
  if (!val && activeTab.value === 'tailwind') activeTab.value = 'html';
});

// Exposed so TutorialStep can open the panel on mobile, where the floating launcher is hidden
defineExpose({ openNotebook });
</script>

<template>
  <button
    v-if="!open"
    class="hidden md:flex fixed bottom-5 right-5 z-40 items-center gap-2 px-4 py-2.5 bg-ds-brown text-ds-cream text-sm font-bold shadow-lg hover:bg-ds-brown/90 transition-all border-[3px] border-ds-brown"
    @click="openNotebook"
  >
    <BookOpen :size="16" />
    {{ $t("notebook.heading") }}
  </button>

  <Transition name="notebook-slide">
    <div
      v-if="open"
      class="fixed z-40 flex flex-col bg-parchment border-[3px] border-ds-brown shadow-2xl"
      :class="{ 'select-none': dragging || resizing }"
      :style="{
        left: pos.x + 'px',
        top: pos.y + 'px',
        width: size.w + 'px',
        height: size.h + 'px',
      }"
    >
      <div
        class="flex items-center justify-between px-3 py-2 border-b-[3px] border-ds-brown bg-ds-brown text-ds-cream cursor-move shrink-0"
        @mousedown="onDragStart"
      >
        <div class="flex items-center gap-2">
          <GripHorizontal :size="14" class="opacity-50" />
          <BookOpen :size="14" />
          <span class="font-bold text-sm">{{ $t("notebook.heading") }}</span>
        </div>
        <button class="hover:opacity-70 transition-opacity" @mousedown.stop @click="open = false">
          <X :size="14" />
        </button>
      </div>

      <div v-if="hasTailwind" class="flex border-b-2 border-ds-brown/20 shrink-0">
        <button
          class="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
          :class="activeTab === 'html' ? 'bg-ds-brown/10 text-ds-brown border-b-2 border-ds-brown' : 'text-ds-brown/50 hover:text-ds-brown/70'"
          @click="activeTab = 'html'"
        >
          {{ $t("notebook.html_tags") }}
        </button>
        <button
          class="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
          :class="activeTab === 'tailwind' ? 'bg-ds-brown/10 text-ds-brown border-b-2 border-ds-brown' : 'text-ds-brown/50 hover:text-ds-brown/70'"
          @click="activeTab = 'tailwind'"
        >
          {{ $t("notebook.tailwind_classes") }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="activeTab === 'html'" class="p-3 space-y-1">
          <div
            v-for="item in visibleHtmlTags"
            :key="item.tag"
            class="flex gap-2 px-2 py-1.5 rounded hover:bg-ds-brown/5 transition-colors"
          >
            <code class="text-xs font-mono text-ds-brown font-bold shrink-0 bg-ds-brown/8 px-1.5 py-0.5 rounded" v-html="item.tag" />
            <span class="text-xs text-ds-brown/70 leading-relaxed">{{ item.desc }}</span>
          </div>
        </div>

        <div v-if="activeTab === 'tailwind'" class="p-3 space-y-3">
          <div class="px-2 py-2 bg-ds-brown/5 rounded border border-ds-brown/10">
            <div class="text-[10px] font-bold uppercase tracking-wider text-ds-brown/50 mb-1.5">{{ $t("notebook.how_tailwind_works") }}</div>
            <pre class="text-xs font-mono text-ds-brown leading-relaxed m-0 p-0 bg-transparent">&lt;element <span class="text-ds-brown/50">class</span>="<span class="text-ds-brown/50">utility utility</span>"&gt;

&lt;h1 class="<span class="font-bold">text-4xl font-bold text-blue-500</span>"&gt;
  Cat Cattington
&lt;/h1&gt;</pre>
            <p class="text-[10px] text-ds-brown/50 mt-2 leading-relaxed">
              {{ $t("notebook.tailwind_class_explainer") }}
            </p>
          </div>

          <div
            v-for="group in groupedTailwindClasses"
            :key="group.category"
            class="space-y-0.5"
          >
            <div class="text-[10px] font-bold uppercase tracking-wider text-ds-brown/50 px-2 pt-1">
              {{ group.category }}
            </div>
            <div
              v-for="item in group.items"
              :key="item.cls"
              class="flex items-baseline gap-2 px-2 py-1 rounded hover:bg-ds-brown/5 transition-colors"
            >
              <code class="text-xs font-mono text-ds-brown font-bold shrink-0 bg-ds-brown/8 px-1.5 py-0.5 rounded">{{ item.cls }}</code>
              <span class="text-[11px] text-ds-brown/60 leading-relaxed">{{ item.desc }}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        class="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-50 flex items-end justify-end pr-0.5 pb-0.5 text-ds-brown/30"
        @mousedown="onResizeStart"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" />
          <line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notebook-slide-enter-active {
  transition: transform 0.2s ease, opacity 0.15s ease;
}
.notebook-slide-leave-active {
  transition: transform 0.15s ease, opacity 0.1s ease;
}
.notebook-slide-enter-from {
  transform: translateY(20px);
  opacity: 0;
}
.notebook-slide-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
