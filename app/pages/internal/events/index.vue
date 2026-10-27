<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";

definePageMeta({ layout: "internal" });

type EventListItem = {
  id: number;
  title: string;
  status: string;
  starts_at: string | null;
  announced_at: string | null;
  attendee_count: number;
  winner_count: number;
  proposed_gift_count: number;
  creator_name: string | null;
};

type PendingGift = {
  attendee_id: number;
  event_id: number;
  event_title: string;
  user_id: string;
  user_name: string | null;
  user_username: string | null;
  gift_kind: string | null;
  gift_gold_amount: number | null;
  gift_shop_item_name: string | null;
  gift_notes: string | null;
};

type PendingEvent = {
  id: number;
  title: string;
  starts_at: string | null;
  creator_name: string | null;
  attendee_count: number;
  proposed_gift_count: number;
};

const router = useRouter();

const { data: me } = useFetch<{
  permissions: { canDecideEventGifts: boolean };
}>("/api/internal/me", { server: false });
const canDecide = computed(
  () => me.value?.permissions?.canDecideEventGifts ?? false,
);

const { data: events, refresh: refreshEvents } = useFetch<EventListItem[]>(
  "/api/internal/events",
  { server: false },
);

const { data: pendingGifts, refresh: refreshGifts } = useFetch<PendingGift[]>(
  "/api/internal/events/pending-gifts",
  { server: false, immediate: false },
);
const { data: pendingEvents, refresh: refreshPendingEvents } = useFetch<
  PendingEvent[]
>("/api/internal/events/pending-events", { server: false, immediate: false });
watchEffect(() => {
  if (canDecide.value) {
    void refreshGifts();
    void refreshPendingEvents();
  }
});

const newTitle = ref("");
const creating = ref(false);
const createError = ref("");

async function createEvent(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title || creating.value) return;
  creating.value = true;
  createError.value = "";
  try {
    const created = await $fetch<{ id: number }>("/api/internal/events", {
      method: "POST",
      body: { title },
    });
    void router.push(`/internal/events/${created.id}`);
  } catch (e) {
    createError.value =
      (e as { data?: { message?: string } })?.data?.message ??
      "Failed to create event";
    creating.value = false;
  }
}

const deciding = ref<number | null>(null);
const denyReasonFor = ref<number | null>(null);
const denyReason = ref("");

async function approve(attendeeId: number, eventId: number): Promise<void> {
  if (deciding.value !== null) return;
  deciding.value = attendeeId;
  try {
    await $fetch(
      `/api/internal/events/${eventId}/attendees/${attendeeId}/decide-gift`,
      { method: "POST", body: { decision: "approve" } },
    );
    await Promise.all([refreshGifts(), refreshEvents()]);
  } catch (e) {
    alert(
      (e as { data?: { message?: string } })?.data?.message ??
        "Failed to approve gift",
    );
  } finally {
    deciding.value = null;
  }
}

async function deny(attendeeId: number, eventId: number): Promise<void> {
  if (deciding.value !== null) return;
  deciding.value = attendeeId;
  try {
    await $fetch(
      `/api/internal/events/${eventId}/attendees/${attendeeId}/decide-gift`,
      { method: "POST", body: { decision: "deny", reason: denyReason.value || undefined } },
    );
    denyReasonFor.value = null;
    denyReason.value = "";
    await Promise.all([refreshGifts(), refreshEvents()]);
  } catch (e) {
    alert(
      (e as { data?: { message?: string } })?.data?.message ??
        "Failed to deny gift",
    );
  } finally {
    deciding.value = null;
  }
}

const selectedIds = ref<Set<number>>(new Set());
const rowErrors = ref<Map<number, string>>(new Map());
const pendingBulkDecision = ref<null | "approve" | "deny">(null);
const bulkReason = ref("");
const bulkBusy = ref(false);
const bulkResult = ref<string | null>(null);

// Grouped by event (first-seen order) so a whole cohort can be selected in one click.
const giftGroups = computed(() => {
  const groups: {
    event_id: number;
    event_title: string;
    gifts: PendingGift[];
  }[] = [];
  const byId = new Map<number, (typeof groups)[number]>();
  for (const g of pendingGifts.value ?? []) {
    let grp = byId.get(g.event_id);
    if (!grp) {
      grp = { event_id: g.event_id, event_title: g.event_title, gifts: [] };
      byId.set(g.event_id, grp);
      groups.push(grp);
    }
    grp.gifts.push(g);
  }
  return groups;
});

const selectedSummary = computed(() => {
  let gold = 0;
  let items = 0;
  for (const g of pendingGifts.value ?? []) {
    if (!selectedIds.value.has(g.attendee_id)) continue;
    if (g.gift_kind === "gold") gold += g.gift_gold_amount ?? 0;
    else items++;
  }
  return { count: selectedIds.value.size, gold, items };
});

function isSelected(id: number): boolean {
  return selectedIds.value.has(id);
}

function toggleRow(id: number): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function groupSelectionState(gifts: PendingGift[]): "all" | "some" | "none" {
  let sel = 0;
  for (const g of gifts) if (selectedIds.value.has(g.attendee_id)) sel++;
  if (sel === 0) return "none";
  return sel === gifts.length ? "all" : "some";
}

function toggleGroup(gifts: PendingGift[]): void {
  const next = new Set(selectedIds.value);
  if (groupSelectionState(gifts) === "all") {
    for (const g of gifts) next.delete(g.attendee_id);
  } else {
    for (const g of gifts) next.add(g.attendee_id);
  }
  selectedIds.value = next;
}

function startBulk(decision: "approve" | "deny"): void {
  if (selectedIds.value.size === 0 || selectedIds.value.size > 100) return;
  bulkResult.value = null;
  bulkReason.value = "";
  pendingBulkDecision.value = decision;
}

function cancelBulk(): void {
  pendingBulkDecision.value = null;
  bulkReason.value = "";
}

async function confirmBulk(): Promise<void> {
  const decision = pendingBulkDecision.value;
  if (!decision || bulkBusy.value) return;
  const attendeeIds = [...selectedIds.value];
  if (attendeeIds.length === 0) return;
  bulkBusy.value = true;
  try {
    const res = await $fetch<{
      requested: number;
      decided: number;
      failed: number;
      results: { id: number; ok: boolean; error?: string }[];
    }>("/api/internal/events/gifts/bulk-decide", {
      method: "POST",
      body: {
        attendee_ids: attendeeIds,
        decision,
        reason: decision === "deny" ? bulkReason.value || undefined : undefined,
      },
    });
    const nextErr = new Map(rowErrors.value);
    const succeeded = new Set<number>();
    for (const r of res.results) {
      if (r.ok) {
        succeeded.add(r.id);
        nextErr.delete(r.id);
      } else if (r.error) {
        nextErr.set(r.id, r.error);
      }
    }
    rowErrors.value = nextErr;
    // Keep failed rows selected so they can be retried; drop the successes.
    selectedIds.value = new Set(
      [...selectedIds.value].filter((id) => !succeeded.has(id)),
    );
    const verb = decision === "approve" ? "Approved" : "Denied";
    bulkResult.value =
      res.failed > 0
        ? `${verb} ${res.decided} · ${res.failed} failed`
        : `${verb} ${res.decided}`;
    pendingBulkDecision.value = null;
    bulkReason.value = "";
    await Promise.all([refreshGifts(), refreshEvents()]);
  } catch (e) {
    bulkResult.value =
      (e as { data?: { message?: string } })?.data?.message ??
      "Bulk decide failed";
  } finally {
    bulkBusy.value = false;
  }
}

// Prune selection and errors to still-pending rows so stale ids don't linger.
watch(pendingGifts, (gifts) => {
  const present = new Set((gifts ?? []).map((g) => g.attendee_id));
  const nextSel = new Set(
    [...selectedIds.value].filter((id) => present.has(id)),
  );
  if (nextSel.size !== selectedIds.value.size) selectedIds.value = nextSel;
  const nextErr = new Map(
    [...rowErrors.value].filter(([id]) => present.has(id)),
  );
  if (nextErr.size !== rowErrors.value.size) rowErrors.value = nextErr;
});

const launchingId = ref<number | null>(null);
async function launchEvent(id: number): Promise<void> {
  if (launchingId.value !== null) return;
  launchingId.value = id;
  try {
    await $fetch(`/api/internal/events/${id}/launch`, { method: "POST" });
    await Promise.all([refreshPendingEvents(), refreshEvents()]);
  } catch (e) {
    alert(
      (e as { data?: { message?: string } })?.data?.message ??
        "Failed to launch event",
    );
  } finally {
    launchingId.value = null;
  }
}

const rejectEventFor = ref<number | null>(null);
const rejectEventReason = ref("");
async function rejectEvent(id: number): Promise<void> {
  if (launchingId.value !== null) return;
  launchingId.value = id;
  try {
    await $fetch(`/api/internal/events/${id}/reject`, {
      method: "POST",
      body: { reason: rejectEventReason.value || undefined },
    });
    rejectEventFor.value = null;
    rejectEventReason.value = "";
    await Promise.all([refreshPendingEvents(), refreshEvents()]);
  } catch (e) {
    alert(
      (e as { data?: { message?: string } })?.data?.message ??
        "Failed to send event back",
    );
  } finally {
    launchingId.value = null;
  }
}

function statusClass(status: string): string {
  if (status === "published") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (status === "pending_review") return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  if (status === "completed") return "border-zinc-600 bg-zinc-700/20 text-zinc-300";
  return "border-amber-500/40 bg-amber-500/10 text-amber-300";
}

function statusLabel(status: string): string {
  return status === "pending_review" ? "pending review" : status;
}

function giftLabel(g: PendingGift): string {
  if (g.gift_kind === "gold") return `${g.gift_gold_amount ?? 0} gold`;
  if (g.gift_kind === "shop_item") return g.gift_shop_item_name ?? "shop item";
  return "gift";
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 md:px-8 pt-32 md:pt-24 pb-8 flex flex-col gap-8">
    <div>
      <h1 class="text-xl font-bold text-white">Events</h1>
      <p class="text-sm text-zinc-400 mt-1">
        Create events, record attendees and winners, and propose gifts. A
        supaadmin runs the second pass: launching submitted events and approving
        gifts.
      </p>
    </div>

    <div class="border border-zinc-800 bg-zinc-900/40 p-4">
      <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase mb-3">
        New event
      </div>
      <div class="flex gap-2">
        <input
          v-model="newTitle"
          type="text"
          placeholder="Event title"
          class="flex-1 bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          @keydown.enter="createEvent"
        >
        <button
          class="px-4 py-2 text-sm font-bold border border-zinc-600 bg-zinc-700/30 text-white hover:bg-zinc-700/50 disabled:opacity-50"
          :disabled="creating || !newTitle.trim()"
          @click="createEvent"
        >
          Create
        </button>
      </div>
      <p v-if="createError" class="text-xs text-rose-400 mt-2">{{ createError }}</p>
    </div>

    <div v-if="canDecide && (pendingEvents?.length ?? 0) > 0" class="border border-sky-500/30 bg-sky-500/5 p-4">
      <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase mb-1">
        Second pass: pending events ({{ pendingEvents?.length ?? 0 }})
      </div>
      <p class="text-xs text-zinc-500 mb-3">
        Accepting launches the event and announces it to every user.
      </p>
      <div class="flex flex-col divide-y divide-zinc-800">
        <div
          v-for="pe in pendingEvents"
          :key="pe.id"
          class="py-3 flex flex-wrap items-center gap-3 justify-between"
        >
          <div class="text-sm text-zinc-300 min-w-0">
            <NuxtLink :to="`/internal/events/${pe.id}`" class="text-zinc-100 hover:underline">{{ pe.title }}</NuxtLink>
            <template v-if="pe.creator_name">
              <span class="text-zinc-600"> · </span>
              <span class="text-zinc-500">by {{ pe.creator_name }}</span>
            </template>
            <span class="text-zinc-600"> · </span>
            <span class="text-zinc-500">{{ pe.attendee_count }} attendee(s)</span>
          </div>
          <div class="flex items-center gap-2">
            <template v-if="rejectEventFor === pe.id">
              <input
                v-model="rejectEventReason"
                type="text"
                placeholder="Reason (optional)"
                class="bg-black/30 border border-zinc-700 px-2 py-1 text-xs text-white"
              >
              <button class="px-2 py-1 text-xs border border-rose-500/50 bg-rose-500/20 text-rose-200" :disabled="launchingId !== null" @click="rejectEvent(pe.id)">Confirm send back</button>
              <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300" @click="rejectEventFor = null">Cancel</button>
            </template>
            <template v-else>
              <button class="px-3 py-1 text-xs font-bold border border-emerald-500/50 bg-emerald-500/20 text-emerald-200 disabled:opacity-50" :disabled="launchingId !== null" @click="launchEvent(pe.id)">Accept &amp; launch</button>
              <button class="px-3 py-1 text-xs font-bold border border-zinc-700 text-zinc-300" @click="rejectEventFor = pe.id; rejectEventReason = ''">Send back</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="canDecide && (pendingGifts?.length ?? 0) > 0" class="border border-zinc-800 bg-zinc-900/40 p-4">
      <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase mb-3">
        Pending gifts ({{ pendingGifts?.length ?? 0 }})
      </div>

      <div
        v-if="selectedIds.size > 0"
        class="sticky top-20 z-20 mb-3 border border-zinc-700 bg-zinc-900/95 backdrop-blur px-3 py-2 flex flex-wrap items-center gap-3"
      >
        <span class="text-sm text-zinc-200">
          {{ selectedSummary.count }} selected
          <span class="text-zinc-600">·</span>
          <span class="text-emerald-300">{{ selectedSummary.gold }} gold</span>
          <template v-if="selectedSummary.items > 0">
            <span class="text-zinc-600">+</span>
            <span class="text-zinc-300">{{ selectedSummary.items }} item(s)</span>
          </template>
        </span>
        <span v-if="selectedIds.size > 100" class="text-xs text-rose-400">Select at most 100</span>
        <div class="flex items-center gap-2 ml-auto">
          <template v-if="pendingBulkDecision === 'approve'">
            <span class="text-xs text-zinc-400">Send gifts to {{ selectedSummary.count }} people?</span>
            <button class="px-3 py-1 text-xs font-bold border border-emerald-500/50 bg-emerald-500/20 text-emerald-200 disabled:opacity-50" :disabled="bulkBusy" @click="confirmBulk">Confirm approve</button>
            <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300 disabled:opacity-50" :disabled="bulkBusy" @click="cancelBulk">Cancel</button>
          </template>
          <template v-else-if="pendingBulkDecision === 'deny'">
            <input
              v-model="bulkReason"
              type="text"
              placeholder="Reason (optional)"
              class="bg-black/30 border border-zinc-700 px-2 py-1 text-xs text-white"
            >
            <button class="px-3 py-1 text-xs font-bold border border-rose-500/50 bg-rose-500/20 text-rose-200 disabled:opacity-50" :disabled="bulkBusy" @click="confirmBulk">Confirm deny</button>
            <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300 disabled:opacity-50" :disabled="bulkBusy" @click="cancelBulk">Cancel</button>
          </template>
          <template v-else>
            <button class="px-3 py-1 text-xs font-bold border border-emerald-500/50 bg-emerald-500/20 text-emerald-200 disabled:opacity-50" :disabled="selectedIds.size > 100" @click="startBulk('approve')">Approve selected</button>
            <button class="px-3 py-1 text-xs font-bold border border-rose-500/50 bg-rose-500/20 text-rose-200 disabled:opacity-50" :disabled="selectedIds.size > 100" @click="startBulk('deny')">Deny selected</button>
            <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300" @click="selectedIds = new Set()">Clear</button>
          </template>
        </div>
      </div>
      <p v-if="bulkResult" class="text-xs text-zinc-400 mb-3">{{ bulkResult }}</p>

      <div class="flex flex-col gap-4">
        <div v-for="grp in giftGroups" :key="grp.event_id" class="border border-zinc-800/70">
          <label class="flex items-center gap-2 px-3 py-2 bg-black/20 cursor-pointer select-none">
            <input
              type="checkbox"
              class="accent-emerald-500"
              :checked="groupSelectionState(grp.gifts) === 'all'"
              :indeterminate.prop="groupSelectionState(grp.gifts) === 'some'"
              @change="toggleGroup(grp.gifts)"
            >
            <NuxtLink :to="`/internal/events/${grp.event_id}`" class="text-sm text-zinc-100 hover:underline" @click.stop>{{ grp.event_title }}</NuxtLink>
            <span class="text-xs text-zinc-500">{{ grp.gifts.length }} gift(s)</span>
          </label>
          <div class="flex flex-col divide-y divide-zinc-800">
            <div
              v-for="g in grp.gifts"
              :key="g.attendee_id"
              class="py-3 px-3 flex flex-wrap items-center gap-3 justify-between"
              :class="isSelected(g.attendee_id) ? 'bg-emerald-500/5' : ''"
            >
              <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  class="accent-emerald-500 shrink-0"
                  :checked="isSelected(g.attendee_id)"
                  @change="toggleRow(g.attendee_id)"
                >
                <span>{{ g.user_name ?? g.user_username ?? g.user_id }}</span>
                <span class="text-zinc-600"> · </span>
                <span class="text-emerald-300">{{ giftLabel(g) }}</span>
                <span v-if="g.gift_notes" class="text-zinc-500"> · {{ g.gift_notes }}</span>
                <span v-if="rowErrors.get(g.attendee_id)" class="text-rose-400"> · {{ rowErrors.get(g.attendee_id) }}</span>
              </label>
              <div class="flex items-center gap-2">
                <template v-if="denyReasonFor === g.attendee_id">
                  <input
                    v-model="denyReason"
                    type="text"
                    placeholder="Reason (optional)"
                    class="bg-black/30 border border-zinc-700 px-2 py-1 text-xs text-white"
                  >
                  <button class="px-2 py-1 text-xs border border-rose-500/50 bg-rose-500/20 text-rose-200" :disabled="deciding !== null" @click="deny(g.attendee_id, g.event_id)">Confirm deny</button>
                  <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300" @click="denyReasonFor = null">Cancel</button>
                </template>
                <template v-else>
                  <button class="px-3 py-1 text-xs font-bold border border-emerald-500/50 bg-emerald-500/20 text-emerald-200 disabled:opacity-50" :disabled="deciding !== null" @click="approve(g.attendee_id, g.event_id)">Approve</button>
                  <button class="px-3 py-1 text-xs font-bold border border-zinc-700 text-zinc-300" @click="denyReasonFor = g.attendee_id; denyReason = ''">Deny</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="border border-zinc-800 bg-zinc-900/40">
      <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase p-4 pb-2">
        All events
      </div>
      <div v-if="(events?.length ?? 0) === 0" class="px-4 pb-4 text-sm text-zinc-500">
        No events yet.
      </div>
      <div v-else class="flex flex-col divide-y divide-zinc-800">
        <NuxtLink
          v-for="ev in events"
          :key="ev.id"
          :to="`/internal/events/${ev.id}`"
          class="px-4 py-3 flex items-center gap-3 hover:bg-black/20"
        >
          <span class="text-[10px] font-bold uppercase px-2 py-1 border tracking-widest" :class="statusClass(ev.status)">
            {{ statusLabel(ev.status) }}
          </span>
          <span class="text-sm text-white flex-1 truncate">{{ ev.title }}</span>
          <span class="text-xs text-zinc-500 shrink-0">
            {{ ev.attendee_count }} attendee(s)<template v-if="ev.proposed_gift_count > 0"> · {{ ev.proposed_gift_count }} pending gift(s)</template>
          </span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
