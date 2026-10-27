<script setup lang="ts">
import { X } from "lucide-vue-next";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } =
  useModalAnimation();
const { t } = useI18n();

type ActiveAnnouncement = {
  id: number;
  title: string;
  body: string;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
};

const open = ref(false);
const dismissing = ref(false);
const announcement = ref<ActiveAnnouncement | null>(null);
const titleId = useId();

const isEvent = computed(
  () =>
    announcement.value?.entity_type === "event" && !!announcement.value?.entity_id,
);
const rsvpDone = ref(false);
const rsvpLoading = ref(false);

async function rsvpInterested(): Promise<void> {
  const ev = announcement.value;
  if (!ev || ev.entity_type !== "event" || !ev.entity_id || rsvpLoading.value) {
    return;
  }
  rsvpLoading.value = true;
  try {
    await $fetch(`/api/events/${ev.entity_id}/rsvp`, {
      method: "POST",
      body: { status: "interested" },
    });
    rsvpDone.value = true;
  } catch {
    // Non-fatal: the event view also exposes the RSVP toggle.
  } finally {
    rsvpLoading.value = false;
  }
}

useEscapeClose(open, () => {
  void dismiss();
});

onMounted(() => {
  void load();
});

async function load(): Promise<void> {
  try {
    const res = await $fetch<{ announcement: ActiveAnnouncement | null }>(
      "/api/announcements/active",
    );
    if (res.announcement) {
      announcement.value = res.announcement;
      open.value = true;
    }
  } catch {
    // Non-fatal: the announcement is also in the notification center.
  }
}

// Any close marks it read so it shows once; guarded so repeated closes send one request.
async function dismiss(): Promise<void> {
  if (dismissing.value) return;
  const current = announcement.value;
  open.value = false;
  if (!current) return;
  dismissing.value = true;
  try {
    await $fetch(`/api/notifications/${current.id}/read`, { method: "POST" });
  } catch {
    // A failed mark-read only means it may reappear next visit.
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
      <div
        v-if="open"
        class="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm"
        @click="dismiss"
      />
    </Transition>
    <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
      <div
        v-if="open"
        class="fixed inset-0 z-[121] flex items-center justify-center p-2 sm:p-4 pointer-events-none"
      >
        <div
          class="w-full max-w-lg max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] flex pointer-events-auto"
        >
          <WoodFrame class="w-full flex flex-col min-h-0">
            <div
              role="dialog"
              aria-modal="true"
              :aria-labelledby="titleId"
              class="overflow-y-auto -m-1 p-1 px-4 pt-4 pb-5 sm:p-8"
            >
              <div class="flex items-start justify-between gap-3 mb-3 sm:mb-4">
                <h2
                  :id="titleId"
                  class="text-lg sm:text-xl font-bold text-ds-brown leading-tight"
                >
                  {{ announcement?.title }}
                </h2>
                <button
                  type="button"
                  class="shrink-0 -mt-1 -mr-1 w-8 h-8 flex items-center justify-center text-ds-brown/60 hover:text-ds-brown hover:bg-ds-brown/10 transition-colors"
                  :aria-label="t('common.close')"
                  @click="dismiss"
                >
                  <X class="w-5 h-5" />
                </button>
              </div>

              <MarkdownContent
                v-if="announcement"
                :source="announcement.body"
                class="text-ds-brown/90"
              />

              <button
                v-if="isEvent"
                type="button"
                class="ds-btn-success w-full mt-5"
                :disabled="rsvpLoading || rsvpDone"
                @click="rsvpInterested"
              >
                {{ rsvpDone ? t("announcement_popup.interested_done") : t("announcement_popup.interested") }}
              </button>
              <p v-if="isEvent" class="text-xs text-ds-brown/60 text-center mt-2">
                {{ t("announcement_popup.rsvp_disclaimer") }}
              </p>

              <button
                type="button"
                class="w-full"
                :class="isEvent ? 'ds-btn-ghost mt-3' : 'ds-btn-primary mt-5'"
                @click="dismiss"
              >
                {{ t("announcement_popup.dismiss") }}
              </button>
            </div>
          </WoodFrame>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
