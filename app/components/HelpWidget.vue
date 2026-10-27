<script setup lang="ts">
import { HelpCircle, X } from "lucide-vue-next";
import { useEscapeClose } from "~/composables/useEscapeClose";
import { useModalAnimation } from "~/composables/useModalAnimation";

const { onBackdropEnter, onBackdropLeave, onPanelEnter, onPanelLeave } = useModalAnimation();

type Attachment = {
  url: string;
  filename: string;
  size_bytes?: number;
  mime_type?: string;
  sha?: string;
};

const { t } = useI18n();

const open = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

useEscapeClose(open, () => { open.value = false; });

const CATEGORIES = computed(() => [
  { value: "project", label: t("support.category.project") },
  { value: "payout", label: t("support.category.payout") },
  { value: "account", label: t("support.category.account") },
  { value: "shop", label: t("support.category.shop") },
  { value: "bug", label: t("support.category.bug") },
  { value: "other", label: t("support.category.other") },
]);

const PRIORITIES = computed(() => [
  { value: "low", label: t("support.priority.low") },
  { value: "normal", label: t("support.priority.normal") },
  { value: "high", label: t("support.priority.high") },
  { value: "urgent", label: t("support.priority.urgent") },
]);

const subject = ref("");
const body = ref("");
const category = ref("other");
const priority = ref("normal");
const attachments = ref<Attachment[]>([]);

const route = useRoute();

function openTicketInDashboard(id: number | null): void {
  const nextQuery: Record<string, string> = { ...route.query as Record<string, string>, support: "1" };
  if (id != null) nextQuery.ticketId = String(id);
  else delete nextQuery.ticketId;
  // on /dashboard its watcher opens the modal; elsewhere go there so the ticket shows in the game window
  navigateTo({ path: route.path === "/dashboard" ? "/dashboard" : "/dashboard", query: nextQuery });
}

function viewAllTickets(): void {
  open.value = false;
  openTicketInDashboard(null);
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  error.value = null;
  try {
    const ticket = await $fetch<{ id: number }>("/api/support/tickets", {
      method: "POST",
      body: {
        subject: subject.value,
        body: body.value,
        category: category.value,
        priority: priority.value,
        attachments: attachments.value,
      },
    });
    open.value = false;
    subject.value = "";
    body.value = "";
    category.value = "other";
    priority.value = "normal";
    attachments.value = [];
    openTicketInDashboard(ticket.id);
  } catch (err) {
    error.value =
      (err as { statusMessage?: string })?.statusMessage ||
      (err as Error)?.message ||
      t("support.widget.create_failed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="fixed bottom-6 right-6 z-40 w-12 h-12 md:w-16 md:h-16 bg-parchment/90 backdrop-blur-sm border-[3px] border-ds-brown text-ds-brown flex items-center justify-center shadow-xl hover:bg-parchment active:scale-95 transition-all"
      :aria-label="$t('support.widget.aria_help')"
      @click="open = true"
    >
      <HelpCircle class="w-6 h-6 md:w-8 md:h-8" />
    </button>

    <Teleport to="body">
      <Transition :css="false" appear @enter="onBackdropEnter" @leave="onBackdropLeave">
        <div
          v-if="open"
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          @click="open = false"
        />
      </Transition>
      <Transition :css="false" appear @enter="onPanelEnter" @leave="onPanelLeave">
      <div
        v-if="open"
        class="fixed inset-0 z-[51] flex items-center justify-center p-4 pointer-events-none"
      >
        <div class="w-full max-w-lg pointer-events-auto">
          <WoodFrame class="w-full">
            <div class="p-6 sm:p-8">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-xl font-bold text-ds-brown">{{ $t("support.widget.heading") }}</h2>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    class="text-xs text-ds-brown/70 hover:text-ds-brown underline"
                    @click="viewAllTickets"
                  >
                    {{ $t("support.widget.view_my_tickets") }}
                  </button>
                  <button
                    type="button"
                    class="text-ds-brown/60 hover:text-ds-brown"
                    :aria-label="$t('support.close')"
                    @click="open = false"
                  >
                    <X class="w-5 h-5" />
                  </button>
                </div>
              </div>
              <p class="text-sm text-ds-brown/70 mb-5">
                {{ $t("support.widget.intro") }}
              </p>

              <form class="space-y-4" @submit.prevent="submit">
                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span class="text-xs text-ds-brown/70">{{ $t("support.widget.category") }}</span>
                    <select v-model="category" class="ds-input ds-select w-full mt-1 text-sm">
                      <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
                    </select>
                  </label>
                  <label class="block">
                    <span class="text-xs text-ds-brown/70">{{ $t("support.widget.priority") }}</span>
                    <select v-model="priority" class="ds-input ds-select w-full mt-1 text-sm">
                      <option v-for="p in PRIORITIES" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                  </label>
                </div>

                <label class="block">
                  <span class="text-xs text-ds-brown/70">{{ $t("support.widget.subject") }}</span>
                  <input
                    v-model="subject"
                    type="text"
                    required
                    minlength="3"
                    maxlength="200"
                    class="ds-input w-full mt-1 text-sm"
                    :placeholder="$t('support.widget.subject_placeholder')"
                  >
                </label>

                <label class="block">
                  <span class="text-xs text-ds-brown/70">{{ $t("support.widget.details") }}</span>
                  <textarea
                    v-model="body"
                    required
                    rows="5"
                    class="ds-input w-full mt-1 text-sm resize-none"
                    :placeholder="$t('support.widget.details_placeholder')"
                  />
                </label>

                <AttachmentUploader v-model="attachments" />

                <div v-if="error" class="text-sm text-ds-danger">{{ error }}</div>

                <div class="flex items-center gap-3 pt-1">
                  <button class="ds-btn-primary" :disabled="submitting" type="submit">
                    {{ submitting ? $t("support.widget.sending") : $t("support.widget.send_ticket") }}
                  </button>
                  <button class="ds-btn-ghost" type="button" @click="open = false">
                    {{ $t("support.widget.cancel") }}
                  </button>
                </div>
              </form>
            </div>
          </WoodFrame>
        </div>
      </div>
      </Transition>
    </Teleport>
  </div>
</template>

