<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

const props = defineProps<{ eventId: number }>();

type Attendee = {
  id: number;
  user_id: string;
  user_name: string | null;
  user_username: string | null;
  user_image: string | null;
  is_winner: boolean;
  attended_at: string | null;
  rsvp_status: string | null;
  gift_kind: string | null;
  gift_gold_amount: number | null;
  gift_shop_item_id: number | null;
  gift_shop_item_name: string | null;
  gift_status: string | null;
  gift_notes: string | null;
  gift_decision_reason: string | null;
  gift_shop_order_id: number | null;
};
type EventDetail = {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  status: string;
  announced_at: string | null;
  creator_name: string | null;
  attendees: Attendee[];
};
type GiftableItem = {
  id: number;
  name: string;
  kind: string;
  fulfillment_provider: string;
  inventory_mode: string | null;
  stock_remaining: number | null;
};
type UserHit = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
};

const { data: ev, refresh } = useFetch<EventDetail>(
  () => `/api/internal/events/${props.eventId}`,
  { server: false },
);
const { data: me } = useFetch<{ permissions: { canDecideEventGifts: boolean } }>(
  "/api/internal/me",
  { server: false },
);
const canDecide = computed(() => me.value?.permissions?.canDecideEventGifts ?? false);
const { data: giftableItems } = useFetch<GiftableItem[]>(
  "/api/internal/events/giftable-items",
  { server: false },
);

const browserTz =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

// the picker holds wall-clock time in the chosen zone; starts_at/ends_at
// are stored as the resolved utc instant so reminders fire at the real time

function buildTimezones(): string[] {
  const utc = ["UTC"];
  for (let h = 1; h <= 14; h++) utc.push(`UTC+${h}`); // utc offsets range from +14
  for (let h = 1; h <= 12; h++) utc.push(`UTC-${h}`);
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  return [
    ...utc,
    ...(typeof intl.supportedValuesOf === "function"
      ? intl.supportedValuesOf("timeZone")
      : []),
  ];
}
const ALL_TIMEZONES = buildTimezones();

const tzOpen = ref(false);
const filteredTimezones = computed(() => {
  const q = form.timezone.trim().toLowerCase();
  return (q
    ? ALL_TIMEZONES.filter((tz) => tz.toLowerCase().includes(q))
    : ALL_TIMEZONES
  ).slice(0, 60); // cap dropdown results
});
function selectTz(tz: string): void {
  form.timezone = tz;
  tzOpen.value = false;
}

// offset (tz - utc) in ms at the instant; unrecognized zones fall back to utc
function tzOffsetMs(utcMs: number, tz: string): number {
  const m = tz.match(/^UTC([+-])(\d{1,2})$/);
  if (m) return (m[1] === "+" ? 1 : -1) * Number(m[2]) * 3_600_000; // hours to ms
  if (!tz || tz === "UTC") return 0;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p: Record<string, string> = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
    return (
      Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second),
      ) - utcMs
    );
  } catch {
    return 0;
  }
}

// Wall-clock "YYYY-MM-DDTHH:mm" interpreted in tz -> UTC ISO instant.
function wallToUtcIso(wall: string, tz: string): string | null {
  if (!wall) return null;
  const [dPart, tPart] = wall.split("T");
  if (!dPart || !tPart) return null;
  const dp = dPart.split("-");
  const tp = tPart.split(":");
  const y = Number(dp[0]);
  const mo = Number(dp[1]);
  const d = Number(dp[2]);
  const h = Number(tp[0]);
  const mi = Number(tp[1]);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = tzOffsetMs(guess, tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(utc, tz); // re-check across a DST boundary
  if (off2 !== off) utc = guess - off2;
  return new Date(utc).toISOString();
}

// UTC ISO instant -> wall-clock "YYYY-MM-DDTHH:mm" in tz.
function utcIsoToWall(iso: string | null, tz: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + tzOffsetMs(date.getTime(), tz));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

const form = reactive({
  title: "",
  description: "",
  image_url: "",
  timezone: "",
  starts_at_local: "",
  ends_at_local: "",
});

watch(
  ev,
  (v) => {
    if (!v) return;
    form.title = v.title;
    form.description = v.description ?? "";
    form.image_url = v.image_url ?? "";
    form.timezone = v.timezone ?? browserTz;
    form.starts_at_local = utcIsoToWall(v.starts_at, form.timezone);
    form.ends_at_local = utcIsoToWall(v.ends_at, form.timezone);
  },
  { immediate: true },
);

const saving = ref(false);
const saveMsg = ref("");
async function save(): Promise<void> {
  if (saving.value) return;
  saveMsg.value = "";
  const startIso = wallToUtcIso(form.starts_at_local, form.timezone);
  const endIso = wallToUtcIso(form.ends_at_local, form.timezone);
  if (startIso && endIso && endIso <= startIso) {
    saveMsg.value = "End time must be after the start time.";
    return;
  }
  saving.value = true;
  try {
    await $fetch(`/api/internal/events/${props.eventId}`, {
      method: "PATCH",
      body: {
        title: form.title.trim(),
        description: form.description,
        image_url: form.image_url.trim() || null,
        timezone: form.timezone.trim() || null,
        starts_at: startIso,
        ends_at: endIso,
      },
    });
    saveMsg.value = "Saved";
    await refresh();
  } catch (e) {
    saveMsg.value =
      (e as { data?: { message?: string } })?.data?.message ?? "Save failed";
  } finally {
    saving.value = false;
  }
}

const imageUploading = ref(false);
const imageUploadError = ref("");
async function uploadImageFile(file: File): Promise<void> {
  imageUploading.value = true;
  imageUploadError.value = "";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await $fetch<{ url?: string; file?: string }>("/api/upload-image", {
      method: "POST",
      body: fd,
    });
    const url = res.url || res.file || "";
    if (!url) throw new Error("Upload returned no URL");
    form.image_url = url;
  } catch (e) {
    imageUploadError.value =
      (e as { data?: { message?: string } })?.data?.message ?? "Image upload failed";
  } finally {
    imageUploading.value = false;
  }
}
function onImagePaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) void uploadImageFile(file);
      return;
    }
  }
}
function onImageFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void uploadImageFile(file);
}

const isDraft = computed(() => ev.value?.status === "draft");
const isPendingReview = computed(() => ev.value?.status === "pending_review");

const showSubmit = ref(false);
const submitting = ref(false);
async function submitForReview(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await $fetch(`/api/internal/events/${props.eventId}/submit`, { method: "POST" });
    showSubmit.value = false;
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Submit failed");
  } finally {
    submitting.value = false;
  }
}

const launching = ref(false);
async function launch(): Promise<void> {
  if (launching.value) return;
  launching.value = true;
  try {
    await $fetch(`/api/internal/events/${props.eventId}/launch`, { method: "POST" });
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Launch failed");
  } finally {
    launching.value = false;
  }
}

const showReject = ref(false);
const rejectReason = ref("");
const rejecting = ref(false);
async function reject(): Promise<void> {
  if (rejecting.value) return;
  rejecting.value = true;
  try {
    await $fetch(`/api/internal/events/${props.eventId}/reject`, {
      method: "POST",
      body: { reason: rejectReason.value.trim() || undefined },
    });
    showReject.value = false;
    rejectReason.value = "";
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Send back failed");
  } finally {
    rejecting.value = false;
  }
}

const search = ref("");
const hits = ref<UserHit[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  if (!q.trim()) {
    hits.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      hits.value = await $fetch<UserHit[]>("/api/internal/events/user-search", {
        params: { q: q.trim() },
      });
    } catch {
      hits.value = [];
    }
  }, 180); // debounce user search while typing
});

async function addAttendee(u: UserHit): Promise<void> {
  try {
    await $fetch(`/api/internal/events/${props.eventId}/attendees`, {
      method: "POST",
      body: { user_ids: [u.id] },
    });
    search.value = "";
    hits.value = [];
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Failed to add");
  }
}

async function toggleWinner(a: Attendee): Promise<void> {
  try {
    await $fetch(`/api/internal/events/${props.eventId}/attendees/${a.id}`, {
      method: "PATCH",
      body: { is_winner: !a.is_winner },
    });
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Failed");
  }
}

// attendance confirmation unlocks the certificate, so this is the manual approval step
async function toggleAttended(a: Attendee): Promise<void> {
  try {
    await $fetch(`/api/internal/events/${props.eventId}/attendees/${a.id}`, {
      method: "PATCH",
      body: { attended: !a.attended_at },
    });
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Failed");
  }
}

async function removeAttendee(a: Attendee): Promise<void> {
  try {
    await $fetch(`/api/internal/events/${props.eventId}/attendees/${a.id}`, {
      method: "DELETE",
    });
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Failed to remove");
  }
}

async function decide(a: Attendee, decision: "approve" | "deny"): Promise<void> {
  try {
    await $fetch(
      `/api/internal/events/${props.eventId}/attendees/${a.id}/decide-gift`,
      { method: "POST", body: { decision } },
    );
    await refresh();
  } catch (e) {
    alert((e as { data?: { message?: string } })?.data?.message ?? "Failed");
  }
}

const giftModal = reactive({
  open: false,
  bulk: false as boolean,
  bulkScope: "winners" as "winners" | "all",
  attendeeId: null as number | null,
  kind: "gold" as "gold" | "shop_item",
  gold: 10,
  itemId: null as number | null,
  notes: "",
  error: "",
  saving: false,
});

function openGift(a: Attendee): void {
  giftModal.open = true;
  giftModal.bulk = false;
  giftModal.attendeeId = a.id;
  giftModal.kind = a.gift_kind === "shop_item" ? "shop_item" : "gold";
  giftModal.gold = a.gift_gold_amount ?? 10;
  giftModal.itemId = a.gift_shop_item_id ?? null;
  giftModal.notes = a.gift_notes ?? "";
  giftModal.error = "";
}
function openBulk(scope: "winners" | "all"): void {
  giftModal.open = true;
  giftModal.bulk = true;
  giftModal.bulkScope = scope;
  giftModal.attendeeId = null;
  giftModal.kind = "gold";
  giftModal.gold = 10;
  giftModal.itemId = null;
  giftModal.notes = "";
  giftModal.error = "";
}

async function saveGift(): Promise<void> {
  if (giftModal.saving) return;
  giftModal.error = "";
  if (giftModal.kind === "shop_item" && !giftModal.itemId) {
    giftModal.error = "Pick a shop item";
    return;
  }
  giftModal.saving = true;
  const payload = {
    gift_kind: giftModal.kind,
    gift_gold_amount: giftModal.kind === "gold" ? giftModal.gold : undefined,
    gift_shop_item_id: giftModal.kind === "shop_item" ? giftModal.itemId : undefined,
    gift_notes: giftModal.notes || undefined,
  };
  try {
    if (giftModal.bulk) {
      const ids = (ev.value?.attendees ?? [])
        .filter((a) => (giftModal.bulkScope === "winners" ? a.is_winner : true))
        .filter((a) => a.gift_status === null || a.gift_status === "denied")
        .map((a) => a.id);
      if (ids.length === 0) {
        giftModal.error = "No eligible attendees";
        giftModal.saving = false;
        return;
      }
      await $fetch(`/api/internal/events/${props.eventId}/gifts/bulk-propose`, {
        method: "POST",
        body: { attendee_ids: ids, ...payload },
      });
    } else {
      await $fetch(
        `/api/internal/events/${props.eventId}/attendees/${giftModal.attendeeId}`,
        { method: "PATCH", body: payload },
      );
    }
    giftModal.open = false;
    await refresh();
  } catch (e) {
    giftModal.error =
      (e as { data?: { message?: string } })?.data?.message ?? "Failed to save gift";
  } finally {
    giftModal.saving = false;
  }
}

function giftChip(a: Attendee): { label: string; cls: string } | null {
  if (!a.gift_kind) return null;
  return {
    label:
      (a.gift_kind === "gold" ? `${a.gift_gold_amount ?? 0} gold` : a.gift_shop_item_name ?? "item") +
      ` · ${a.gift_status ?? "proposed"}`,
    cls:
      a.gift_status === "approved"
        ? "border-emerald-500/40 text-emerald-300"
        : a.gift_status === "denied"
          ? "border-rose-500/40 text-rose-300"
          : "border-amber-500/40 text-amber-300",
  };
}

const isPublished = computed(() => !!ev.value?.announced_at);
</script>

<template>
  <div v-if="ev" class="max-w-4xl mx-auto px-4 md:px-8 pt-32 md:pt-24 pb-8 flex flex-col gap-6">
    <div class="flex items-center gap-3">
      <NuxtLink to="/internal/events" class="text-xs text-zinc-500 hover:text-zinc-300">&larr; Events</NuxtLink>
      <span
class="text-[10px] font-bold uppercase px-2 py-1 border tracking-widest"
        :class="ev.status === 'published' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : ev.status === 'pending_review' ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'">
        {{ ev.status === 'pending_review' ? 'pending review' : ev.status }}
      </span>
    </div>

    <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
      <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase">Details</div>
      <label class="text-xs text-zinc-400">Title
        <input v-model="form.title" type="text" class="mt-1 w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white" >
      </label>
      <label class="text-xs text-zinc-400">Description (Markdown)
        <textarea v-model="form.description" rows="4" class="mt-1 w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white"/>
      </label>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="text-xs text-zinc-400 sm:col-span-2">Timezone
          <div class="relative mt-1">
            <input
              v-model="form.timezone"
              type="text"
              placeholder="Search a timezone or UTC offset"
              class="w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500"
              @focus="tzOpen = true"
              @input="tzOpen = true"
              @blur="tzOpen = false"
            >
            <div
              v-if="tzOpen && filteredTimezones.length"
              class="absolute z-30 left-0 right-0 mt-1 border border-zinc-700 bg-zinc-950 max-h-60 overflow-y-auto"
            >
              <button
                v-for="tz in filteredTimezones"
                :key="tz"
                type="button"
                class="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
                @mousedown.prevent="selectTz(tz)"
              >
                {{ tz }}
              </button>
            </div>
          </div>
        </label>
        <InternalEventDateTimePicker
          v-model="form.starts_at_local"
          label="Starts at (in the selected timezone)"
        />
        <InternalEventDateTimePicker
          v-model="form.ends_at_local"
          :min="form.starts_at_local"
          label="Ends at (optional, selected timezone)"
          clearable
        />
        <div class="text-xs text-zinc-400 sm:col-span-2 flex flex-col gap-1">
          <span>Image URL (optional)</span>
          <input
            v-model="form.image_url"
            type="url"
            placeholder="https://cdn.hackclub.com/... or paste an image"
            class="w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500"
            @paste="onImagePaste"
          >
          <div class="flex items-center gap-2 text-[11px]">
            <span v-if="imageUploading" class="text-zinc-500">Uploading image...</span>
            <span v-else-if="imageUploadError" class="text-rose-300">{{ imageUploadError }}</span>
            <template v-else>
              <span class="text-zinc-600">Paste an image to upload, or</span>
              <label class="underline cursor-pointer text-zinc-400 hover:text-white">
                choose a file
                <input type="file" accept="image/*" class="hidden" @change="onImageFile">
              </label>
            </template>
          </div>
          <img
            v-if="form.image_url"
            :src="form.image_url"
            alt=""
            class="mt-1 max-h-32 w-auto border border-zinc-800 object-contain"
          >
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button class="px-4 py-2 text-sm font-bold border border-zinc-600 bg-zinc-700/30 text-white hover:bg-zinc-700/50 disabled:opacity-50" :disabled="saving" @click="save">Save</button>
        <span v-if="saveMsg" class="text-xs text-zinc-400">{{ saveMsg }}</span>
      </div>
    </div>

    <div class="border border-zinc-800 bg-zinc-900/40 p-4">
      <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase mb-2">Launch</div>
      <template v-if="isPublished">
        <p class="text-sm text-emerald-300">Announced {{ new Date(ev.announced_at as string).toLocaleString() }}. Editing details does not re-announce, but it updates the #macondo-bulletin message, the dashboard popup / notification bell, and the events tab.</p>
      </template>
      <template v-else-if="isPendingReview">
        <p class="text-sm text-amber-300 mb-3">Submitted for the second pass. A supaadmin has to accept it before it launches.</p>
        <div v-if="canDecide" class="flex items-center gap-2">
          <button class="px-4 py-2 text-sm font-bold border border-emerald-500/50 bg-emerald-500/20 text-emerald-200 disabled:opacity-50" :disabled="launching" @click="launch">Accept &amp; launch</button>
          <button class="px-3 py-2 text-sm border border-rose-500/50 bg-rose-500/20 text-rose-200 disabled:opacity-50" :disabled="launching" @click="showReject = true">Send back</button>
        </div>
        <p v-else class="text-xs text-zinc-500">Waiting on a supaadmin.</p>
      </template>
      <template v-else>
        <p class="text-sm text-zinc-400 mb-3">Submitting sends this event to a supaadmin for the second pass. On launch it is announced to every user (dashboard popup, notification bell, and #macondo-bulletin).</p>
        <button v-if="isDraft" class="px-4 py-2 text-sm font-bold border border-emerald-500/50 bg-emerald-500/20 text-emerald-200" @click="showSubmit = true">Submit for review</button>
      </template>
    </div>

    <div class="border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="text-xs tracking-widest font-bold text-zinc-500 uppercase">Attendees ({{ ev.attendees.length }})</div>
        <div class="flex gap-2">
          <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300 hover:bg-black/20" @click="openBulk('winners')">Gift all winners</button>
          <button class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300 hover:bg-black/20" @click="openBulk('all')">Gift all attendees</button>
        </div>
      </div>

      <div class="relative">
        <input v-model="search" type="text" placeholder="Search users to add by name, username, or slack id" class="w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500" >
        <div v-if="hits.length > 0" class="absolute z-20 left-0 right-0 mt-1 border border-zinc-700 bg-zinc-950 max-h-60 overflow-y-auto">
          <button v-for="u in hits" :key="u.id" class="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 flex items-center gap-2" @click="addAttendee(u)">
            <img v-if="u.image" :src="u.image" class="w-5 h-5 object-cover" alt="" >
            <span>{{ u.name ?? u.username ?? u.id }}</span>
            <span v-if="u.username" class="text-zinc-500 text-xs">@{{ u.username }}</span>
          </button>
        </div>
      </div>

      <div v-if="ev.attendees.length === 0" class="text-sm text-zinc-500">No attendees yet.</div>
      <div v-else class="flex flex-col divide-y divide-zinc-800">
        <div v-for="a in ev.attendees" :key="a.id" class="py-2 flex flex-wrap items-center gap-2 justify-between">
          <div class="flex items-center gap-2 min-w-0">
            <img v-if="a.user_image" :src="a.user_image" class="w-6 h-6 object-cover shrink-0" alt="" >
            <span class="text-sm text-zinc-200 truncate">{{ a.user_name ?? a.user_username ?? a.user_id }}</span>
            <span v-if="a.rsvp_status === 'interested'" class="text-[10px] text-emerald-400 uppercase tracking-widest">rsvp</span>
            <button class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 border" :class="a.is_winner ? 'border-amber-500/50 text-amber-300' : 'border-zinc-700 text-zinc-500'" @click="toggleWinner(a)">winner</button>
            <button title="Confirmed attendance unlocks their certificate" class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 border" :class="a.attended_at ? 'border-emerald-500/50 text-emerald-300' : 'border-zinc-700 text-zinc-500'" @click="toggleAttended(a)">attended</button>
            <span v-if="giftChip(a)" class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 border" :class="giftChip(a)!.cls">{{ giftChip(a)!.label }}</span>
            <NuxtLink v-if="a.gift_shop_order_id" :to="`/internal/orders/${a.gift_shop_order_id}`" class="text-[10px] text-zinc-400 underline">order #{{ a.gift_shop_order_id }}</NuxtLink>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button v-if="a.gift_status !== 'approved'" class="px-2 py-1 text-xs border border-zinc-700 text-zinc-300 hover:bg-black/20" @click="openGift(a)">{{ a.gift_kind ? "Edit gift" : "Add gift" }}</button>
            <template v-if="canDecide && a.gift_status === 'proposed'">
              <button class="px-2 py-1 text-xs border border-emerald-500/50 bg-emerald-500/20 text-emerald-200" @click="decide(a, 'approve')">Approve</button>
              <button class="px-2 py-1 text-xs border border-rose-500/50 bg-rose-500/20 text-rose-200" @click="decide(a, 'deny')">Deny</button>
            </template>
            <button class="px-2 py-1 text-xs border border-zinc-800 text-zinc-500 hover:text-rose-300" @click="removeAttendee(a)">Remove</button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="modal-fade" appear>
        <div
          v-if="showSubmit"
          class="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          @click.self="!submitting && (showSubmit = false)"
        >
          <div class="modal-fade-panel relative w-full max-w-md border border-zinc-700 bg-zinc-950 p-6 flex flex-col gap-4 internal-modal-grid-bg">
            <h3 class="text-sm font-bold uppercase tracking-widest text-emerald-300">Submit for review?</h3>
            <p class="text-sm text-zinc-400">This sends "{{ ev.title }}" to a supaadmin for the second pass. They accept it to announce it to every user and post to #macondo-bulletin.</p>
            <div class="flex justify-end gap-2">
              <button class="px-3 py-2 text-sm border border-zinc-700 text-zinc-300" :disabled="submitting" @click="showSubmit = false">Cancel</button>
              <button class="px-3 py-2 text-sm border border-emerald-500/50 bg-emerald-500/20 text-emerald-200" :disabled="submitting" @click="submitForReview">Submit</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal-fade" appear>
        <div
          v-if="showReject"
          class="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          @click.self="!rejecting && (showReject = false)"
        >
          <div class="modal-fade-panel relative w-full max-w-md border border-zinc-700 bg-zinc-950 p-6 flex flex-col gap-4 internal-modal-grid-bg">
            <h3 class="text-sm font-bold uppercase tracking-widest text-rose-300">Send back to draft?</h3>
            <p class="text-sm text-zinc-400">This returns "{{ ev.title }}" to the organizer as a draft. It will not be announced.</p>
            <label class="text-xs text-zinc-400">Reason (optional)
              <textarea v-model="rejectReason" rows="2" class="mt-1 w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white"/>
            </label>
            <div class="flex justify-end gap-2">
              <button class="px-3 py-2 text-sm border border-zinc-700 text-zinc-300" :disabled="rejecting" @click="showReject = false">Cancel</button>
              <button class="px-3 py-2 text-sm border border-rose-500/50 bg-rose-500/20 text-rose-200" :disabled="rejecting" @click="reject">Send back</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal-fade" appear>
        <div
          v-if="giftModal.open"
          class="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          @click.self="!giftModal.saving && (giftModal.open = false)"
        >
          <div class="modal-fade-panel relative w-full max-w-md border border-zinc-700 bg-zinc-950 p-6 flex flex-col gap-4 internal-modal-grid-bg">
            <h3 class="text-sm font-bold uppercase tracking-widest text-zinc-300">
              {{ giftModal.bulk ? (giftModal.bulkScope === 'all' ? 'Gift all attendees' : 'Gift all winners') : 'Propose gift' }}
            </h3>
            <div class="flex gap-2">
              <button class="flex-1 px-3 py-2 text-sm border" :class="giftModal.kind === 'gold' ? 'border-zinc-400 text-white' : 'border-zinc-700 text-zinc-500'" @click="giftModal.kind = 'gold'">Gold</button>
              <button class="flex-1 px-3 py-2 text-sm border" :class="giftModal.kind === 'shop_item' ? 'border-zinc-400 text-white' : 'border-zinc-700 text-zinc-500'" @click="giftModal.kind = 'shop_item'">Shop item</button>
            </div>
            <label v-if="giftModal.kind === 'gold'" class="text-xs text-zinc-400">Gold amount
              <input v-model.number="giftModal.gold" type="number" min="1" max="10000" class="mt-1 w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white" >
            </label>
            <label v-else class="text-xs text-zinc-400">Shop item
              <select v-model.number="giftModal.itemId" class="mt-1 w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white">
                <option :value="null">Select an item</option>
                <option v-for="it in giftableItems" :key="it.id" :value="it.id">{{ it.name }}</option>
              </select>
            </label>
            <label class="text-xs text-zinc-400">Notes (optional)
              <input v-model="giftModal.notes" type="text" class="mt-1 w-full bg-black/30 border border-zinc-700 px-3 py-2 text-sm text-white" >
            </label>
            <p v-if="giftModal.error" class="text-xs text-rose-400">{{ giftModal.error }}</p>
            <div class="flex justify-end gap-2">
              <button class="px-3 py-2 text-sm border border-zinc-700 text-zinc-300" :disabled="giftModal.saving" @click="giftModal.open = false">Cancel</button>
              <button class="px-3 py-2 text-sm border border-zinc-500 bg-zinc-700/40 text-white" :disabled="giftModal.saving" @click="saveGift">Propose</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
