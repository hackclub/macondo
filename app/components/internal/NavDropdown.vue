<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

interface DropdownItem {
    to: string;
    label: string;
    show?: boolean;
}

const props = defineProps<{
    label: string;
    items: DropdownItem[];
}>();

const route = useRoute();
const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const buttonEl = ref<HTMLButtonElement | null>(null);
const panelPos = ref<{ top: number; left: number }>({ top: 0, left: 0 });

const visibleItems = computed(() =>
    props.items.filter((i) => i.show !== false),
);
const hasItems = computed(() => visibleItems.value.length > 0);

const isSectionActive = computed(() =>
    visibleItems.value.some(
        (i) => route.path === i.to || route.path.startsWith(i.to + "/"),
    ),
);

function updatePanelPos() {
    if (!buttonEl.value) return;
    const rect = buttonEl.value.getBoundingClientRect();
    panelPos.value = {
        top: rect.bottom + 8,
        left: rect.left,
    };
}

function toggle() {
    if (isOpen.value) {
        isOpen.value = false;
        return;
    }
    updatePanelPos();
    isOpen.value = true;
}

function closeNow() {
    isOpen.value = false;
}

function menuItems(): HTMLElement[] {
    const panel = document.querySelector<HTMLElement>(
        `[data-nav-dropdown-panel="${props.label}"]`,
    );
    if (!panel) return [];
    return Array.from(
        panel.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
}

function focusItem(index: number) {
    const items = menuItems();
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
}

async function openAndFocusFirst() {
    if (!isOpen.value) {
        updatePanelPos();
        isOpen.value = true;
        await nextTick();
    }
    focusItem(0);
}

function onButtonKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void openAndFocusFirst();
    } else if (e.key === "Escape" && isOpen.value) {
        e.preventDefault();
        closeNow();
    }
}

function onPanelKeydown(e: KeyboardEvent) {
    const items = menuItems();
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIdx = active ? items.indexOf(active) : -1;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        focusItem(currentIdx + 1);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusItem(currentIdx - 1);
    } else if (e.key === "Home") {
        e.preventDefault();
        focusItem(0);
    } else if (e.key === "End") {
        e.preventDefault();
        focusItem(items.length - 1);
    } else if (e.key === "Escape") {
        e.preventDefault();
        closeNow();
        buttonEl.value?.focus();
    } else if (e.key === "Tab") {
        // close so focus moves on to the next navbar element instead of getting stuck
        closeNow();
    }
}

function onDocumentClick(e: MouseEvent) {
    if (!isOpen.value) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (rootEl.value && rootEl.value.contains(target)) return;
    // panel is teleported, so find it via its data attribute
    const panel = document.querySelector(
        `[data-nav-dropdown-panel="${props.label}"]`,
    );
    if (panel && panel.contains(target)) return;
    closeNow();
}

function onScrollOrResize() {
    if (!isOpen.value) return;
    updatePanelPos();
}

onMounted(() => {
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
});

onBeforeUnmount(() => {
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("resize", onScrollOrResize);
    window.removeEventListener("scroll", onScrollOrResize, true);
});

watch(
    () => route.path,
    () => {
        closeNow();
    },
);

watch(isOpen, async (open) => {
    if (open) {
        await nextTick();
        updatePanelPos();
    }
});
</script>

<template>
    <div
        v-if="hasItems"
        ref="rootEl"
        class="relative pointer-events-auto"
    >
        <button
            ref="buttonEl"
            type="button"
            :aria-expanded="isOpen"
            aria-haspopup="menu"
            class="text-sm font-medium text-zinc-400 hover:text-white transition-colors inline-flex items-center gap-1 whitespace-nowrap"
            :class="{ '!text-white': isSectionActive || isOpen }"
            @click="toggle"
            @keydown="onButtonKeydown"
        >
            {{ label }}
            <svg
                class="w-3 h-3 transition-transform"
                :class="{ 'rotate-180': isOpen }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <polyline points="6 9 12 15 18 9" />
            </svg>
        </button>
        <Teleport to="body">
            <Transition
                enter-active-class="transition duration-150 ease-out"
                enter-from-class="opacity-0 -translate-y-1"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition duration-100 ease-in"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-1"
            >
                <div
                    v-if="isOpen"
                    :data-nav-dropdown-panel="label"
                    role="menu"
                    :aria-label="label"
                    class="fixed min-w-[160px] bg-zinc-950/95 backdrop-blur-md border border-zinc-700/50 shadow-2xl py-1 z-[200] pointer-events-auto"
                    :style="{ top: `${panelPos.top}px`, left: `${panelPos.left}px` }"
                    @keydown="onPanelKeydown"
                >
                    <NuxtLink
                        v-for="item in visibleItems"
                        :key="item.to"
                        :to="item.to"
                        role="menuitem"
                        class="block px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors whitespace-nowrap"
                        active-class="!text-white bg-zinc-800/40"
                        @click="closeNow"
                    >
                        {{ item.label }}
                    </NuxtLink>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>
