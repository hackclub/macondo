<script setup lang="ts">
import { computed, ref } from "vue";
import { X } from "lucide-vue-next";
import WoodFrame from "../WoodFrame.vue";
import { getFruitsByLevelAndCategory } from "~/data/fruitLevels";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useFocusTrap } from "~/composables/useFocusTrap";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

const props = defineProps<{
  deployed: boolean;
  hasGithub: boolean;
}>();

const emit = defineEmits<{
  (e: "deploy" | "download" | "continueCss" | "backToFarm"): void;
}>();

// Never randomize: must match the level 1 software fruit projects.post.ts assigns server-side
const starter = computed(() => getFruitsByLevelAndCategory(1, "software")[0]);

const titleId = useId();
const dialogEl = ref<HTMLElement | null>(null);

// The parent mounts this via v-if, so there's nothing to gate internally
const alwaysVisible = ref(true);
useEscapeClose(alwaysVisible, () => emit("backToFarm"));
useFocusTrap(alwaysVisible, dialogEl);
</script>

<template>
  <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
    <div class="fixed inset-0 z-[49] bg-black/40" />
  </Transition>
  <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
  <div
    ref="dialogEl"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
  >
    <WoodFrame class="w-full max-w-xl relative pointer-events-auto">
      <button
        type="button"
        class="absolute top-3 right-3 text-ds-brown/50 hover:text-ds-brown transition-colors z-10"
        :title="$t('common.close')"
        :aria-label="$t('common.close')"
        @click="emit('backToFarm')"
      >
        <X :size="20" />
      </button>
      <div class="flex flex-col items-center text-center gap-4 py-4">
        <h2 :id="titleId" class="text-2xl font-bold text-[#3b1d08]">{{ $t("reward_modal.heading") }}</h2>

        <img
          v-if="starter"
          :src="starter.icon"
          :alt="starter.name"
          class="w-28 h-28 object-contain"
          draggable="false"
        >

        <p class="text-[#3b1d08] text-base">
          {{ $t("reward_modal.earned_prefix") }} <strong>{{ starter?.name ?? $t("reward_modal.starter_fallback") }}</strong>{{ $t("reward_modal.earned_suffix") }}
        </p>

        <p v-if="!props.deployed" class="text-sm text-[#3b1d08]/70">
          {{ $t("reward_modal.save_hint") }}
        </p>
        <p v-else class="text-sm text-[#3b1d08]/70">
          {{ $t("reward_modal.deployed_hint") }}
        </p>

        <div class="flex flex-col sm:flex-row flex-wrap gap-3 justify-center pt-2">
          <button
            v-if="!props.deployed"
            type="button"
            class="px-5 py-2 bg-[#8b4513] text-white rounded shadow font-semibold hover:bg-[#6b3410] transition"
            @click="emit('deploy')"
          >
            {{ $t("reward_modal.deploy") }}
          </button>
          <button
            v-if="!props.deployed"
            type="button"
            class="px-5 py-2 bg-[#d2b48c] text-[#3b1d08] rounded shadow font-semibold hover:bg-[#c2a47c] transition"
            @click="emit('download')"
          >
            {{ $t("reward_modal.download") }}
          </button>
          <button
            v-if="props.deployed || props.hasGithub"
            type="button"
            class="px-5 py-2 bg-[#8b4513] text-white rounded shadow font-semibold hover:bg-[#6b3410] transition"
            @click="emit('continueCss')"
          >
            {{ $t("reward_modal.start_css") }}
          </button>
          <button
            type="button"
            class="px-5 py-2 bg-white/80 text-[#3b1d08] border border-[#8b4513]/40 rounded shadow font-semibold hover:bg-white transition"
            @click="emit('backToFarm')"
          >
            {{ $t("reward_modal.back_to_farm") }}
          </button>
        </div>
      </div>
    </WoodFrame>
  </div>
  </Transition>
</template>
