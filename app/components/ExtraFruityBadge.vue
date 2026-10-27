<script setup lang="ts">
const props = defineProps<{
    compact?: boolean;
}>();
</script>

<template>
    <span
        class="inline-flex items-center gap-1 border-[3px] border-ds-brown bg-amber-100 text-ds-brown font-bold uppercase tracking-wider"
        :class="props.compact
            ? 'px-1.5 py-0.5 text-[9px]'
            : 'px-2 py-1 text-[10px]'"
    >
        <img
            src="/images/fruits/starfruit.webp"
            :class="props.compact ? 'w-3 h-3 object-contain' : 'w-3.5 h-3.5 object-contain'"
            alt=""
        >
        <span :class="props.compact ? 'text-xs' : 'text-sm'">
            {{ $t("project_page.extra_fruity_badge") }}
        </span>
    </span>
</template>
