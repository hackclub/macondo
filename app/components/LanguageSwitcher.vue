<script setup lang="ts">
import { Languages } from "lucide-vue-next";

const { locale, setLocale } = useI18n();
const { user } = useAuth();

defineProps<{
  dropUp?: boolean;
}>();

const languages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
] as const;

type LocaleCode = (typeof languages)[number]["code"];

const supportedLocales = languages.map((l) => l.code);

function resolveLocale(code: string): string {
  const base = code.split("-")[0]!.split("_")[0]!.toLowerCase();
  return (supportedLocales as readonly string[]).includes(base) ? base : "en";
}

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

onMounted(() => {
  // don't fall back to navigator.language: i18n's detectBrowserLanguage owns first visits,
  // and setting it here would overwrite the cookie-restored locale on every load
  const userLocale = user.value?.locale as string | undefined;
  if (userLocale && (supportedLocales as readonly string[]).includes(userLocale) && userLocale !== locale.value) {
    setLocale(userLocale as LocaleCode);
  }

  document.addEventListener("click", handleClickOutside);
});

// the session resolves after first render, so sync the saved locale once it arrives
watch(
  () => user.value?.locale,
  (next) => {
    if (!next) return;
    if (!(supportedLocales as readonly string[]).includes(next)) return;
    if (next !== locale.value) setLocale(next as LocaleCode);
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutside);
});

function handleClickOutside(e: MouseEvent) {
  if (!rootRef.value) return;
  if (!rootRef.value.contains(e.target as Node)) open.value = false;
}

async function switchLang(code: LocaleCode) {
  setLocale(code);
  open.value = false;

  if (user.value) {
    try {
      await $fetch("/api/user/locale", {
        method: "PATCH",
        body: { locale: code },
      });
    } catch {
      // best-effort: the cookie-based locale still works
    }
  }
}
</script>

<template>
  <div ref="rootRef">
    <div class="relative inline-block">
      <button
        type="button"
        class="flex items-center gap-1.5 md:gap-2 border-[3px] border-ds-brown bg-parchment text-ds-brown px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm font-bold uppercase tracking-wider hover:bg-ds-cream transition-colors"
        :aria-expanded="open"
        :aria-label="$t('common.language')"
        @click="open = !open"
      >
        <Languages class="w-3.5 h-3.5 md:w-4 md:h-4" :stroke-width="2.5" />
        {{ locale.toUpperCase() }}
        <svg
          class="w-3 h-3 md:w-3.5 md:h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="3"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      <div
        v-if="open"
        class="absolute w-40"
        :class="dropUp ? 'left-0 bottom-full mb-2' : 'right-0 mt-2'"
      >
        <WoodFrame>
          <!-- -m-4 reaches past WoodFrame's inset panel, so bg-parchment is needed or the
               items are see-through -->
          <div class="flex flex-col -m-4 bg-parchment">
            <button
              v-for="lang in languages"
              :key="lang.code"
              type="button"
              class="w-full text-left px-3 py-2 text-sm font-bold transition-colors"
              :class="
                locale === lang.code
                  ? 'text-ds-brown bg-ds-cream'
                  : 'text-ds-brown/70 hover:text-ds-brown hover:bg-ds-cream/60'
              "
              @click="switchLang(lang.code)"
            >
              {{ lang.label }}
            </button>
          </div>
        </WoodFrame>
      </div>
    </div>
  </div>
</template>
