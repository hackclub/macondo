<script setup lang="ts">
import {
  Music,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from "lucide-vue-next";

const { t } = useI18n();

const {
  currentTrack,
  isPlaying,
  isMuted,
  volume,
  currentTime,
  duration,
  unavailable,
  init,
  toggle,
  next,
  prev,
  seek,
  setVolume,
  toggleMute,
} = useMusicPlayer();

const seekPct = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0,
);
const volPct = computed(() => volume.value * 100);

function fillStyle(pct: number): Record<string, string> {
  return {
    background: `linear-gradient(to right, #684D3A ${pct}%, rgba(104,77,58,0.25) ${pct}%)`,
  };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function onSeek(e: Event): void {
  seek(Number((e.target as HTMLInputElement).value));
}

function onVolume(e: Event): void {
  setVolume(Number((e.target as HTMLInputElement).value));
}

onMounted(() => init());
</script>

<template>
  <div
    role="region"
    :aria-label="t('music_player.label')"
    class="fixed left-5 bottom-20 z-[140] w-72 max-w-[calc(100vw_-_2.5rem)] select-none border-[3px] border-ds-brown bg-parchment/90 px-3 py-2.5 text-ds-brown shadow-xl backdrop-blur-sm"
  >
    <div class="flex items-center gap-2">
      <Music class="h-4 w-4 shrink-0 opacity-60" />
      <div class="min-w-0 flex-1">
        <div class="font-satoro text-lg leading-tight truncate">
          {{ currentTrack.title }}
        </div>
        <div class="text-[11px] leading-tight text-ds-brown/70 truncate">
          {{ t("music_player.by_artist", { artist: currentTrack.artist }) }}
        </div>
      </div>
    </div>

    <div class="mt-2">
      <input
        type="range"
        class="music-range w-full"
        min="0"
        :max="duration || 0"
        step="0.1"
        :value="currentTime"
        :style="fillStyle(seekPct)"
        :aria-label="t('music_player.seek')"
        @input="onSeek"
      >
      <div
        class="mt-0.5 flex justify-between text-[10px] tabular-nums text-ds-brown/60"
      >
        <span>{{ formatTime(currentTime) }}</span>
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>

    <div class="mt-1.5 flex items-center gap-1">
      <button
        type="button"
        class="flex items-center justify-center p-1 transition hover:bg-ds-brown/10 active:scale-95"
        :aria-label="t('music_player.previous')"
        @click="prev"
      >
        <SkipBack class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="flex items-center justify-center p-1 transition hover:bg-ds-brown/10 active:scale-95"
        :aria-label="isPlaying ? t('music_player.pause') : t('music_player.play')"
        @click="toggle"
      >
        <Pause v-if="isPlaying" class="h-5 w-5" />
        <Play v-else class="h-5 w-5" />
      </button>
      <button
        type="button"
        class="flex items-center justify-center p-1 transition hover:bg-ds-brown/10 active:scale-95"
        :aria-label="t('music_player.next')"
        @click="next"
      >
        <SkipForward class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="flex items-center justify-center p-1 transition hover:bg-ds-brown/10 active:scale-95"
        :aria-label="isMuted ? t('music_player.unmute') : t('music_player.mute')"
        @click="toggleMute"
      >
        <VolumeX v-if="isMuted" class="h-4 w-4" />
        <Volume2 v-else class="h-4 w-4" />
      </button>
      <input
        type="range"
        class="music-range ml-1 min-w-0 flex-1"
        min="0"
        max="1"
        step="0.05"
        :value="volume"
        :style="fillStyle(volPct)"
        :aria-label="t('music_player.volume')"
        @input="onVolume"
      >
    </div>

    <p v-if="unavailable" class="mt-1 text-[10px] leading-tight text-ds-danger">
      {{ t("music_player.unavailable") }}
    </p>
  </div>
</template>

<style scoped>
.music-range {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  cursor: pointer;
  border: none;
}
.music-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: #684d3a;
  border: none;
  border-radius: 0;
}
.music-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: #684d3a;
  border: none;
  border-radius: 0;
}
</style>
