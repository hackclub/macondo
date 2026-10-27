<script setup lang="ts">
import { MessageCircle } from "lucide-vue-next";

import {
  canCancelOrder,
  canCreateGrant,
  canFallbackGrant,
  canReturnGrant,
  canRetryTheseus,
  canShipInternally,
  canUnshipOrder,
  formatOrderDateTime,
  formatUsdCents,
  hcbGrantStatusClass,
  hcbGrantStatusLabel,
  itemTypeLabel,
  statusClass,
  statusLabel,
  type OrderListItem,
} from "~/utils/internalOrders";

// actions refetch only this order and emit `updated`, since refetching the
// whole queue re-runs an hcb api call per grant order
const props = withDefaults(
  defineProps<{
    row: OrderListItem;
    canSeePii: boolean;
    canAccessShopAdmin: boolean;
    headingLink?: boolean;
  }>(),
  { headingLink: true },
);

const emit = defineEmits<{
  updated: [order: OrderListItem];
  success: [message: string];
  error: [message: string];
}>();

const orderId = computed(() => props.row.order.id);

// app_redirect can't open user dms and we don't store the team id slack://user
// needs, so link the enterprise profile, whose main button is "Message"
const slackDmUrl = computed(() =>
  props.row.orderUser?.slack_id
    ? `https://hackclub.enterprise.slack.com/team/${props.row.orderUser.slack_id}`
    : null,
);

const trackingInput = ref(props.row.order.tracking_number ?? "");
// the parent may swap in a refreshed row while this card stays mounted
watch(
  () => props.row.order.tracking_number,
  (next) => {
    trackingInput.value = next ?? "";
  },
);

const loadingAction = ref<string | null>(null);
function isLoading(action: string) {
  return loadingAction.value === action;
}

function extractErrorMessage(error: unknown, fallback: string) {
  return typeof error === "object" &&
    error &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data &&
    "statusMessage" in error.data &&
    typeof error.data.statusMessage === "string"
    ? error.data.statusMessage
    : fallback;
}

// failure is non-fatal: the action already succeeded, the row just stays stale
async function refreshRow() {
  try {
    emit(
      "updated",
      await $fetch<OrderListItem>(`/api/internal/shop/orders/${orderId.value}`),
    );
  } catch (error) {
    console.error("Failed to refresh order row", error);
  }
}

const showShip = computed(() => canShipInternally(props.row));
// once shipped, the same form edits the tracking number instead of shipping
const alreadyShipped = computed(() => props.row.order.status === "shipped");
const showCreateGrant = computed(() =>
  canCreateGrant(props.row, props.canAccessShopAdmin),
);
const showReturnGrant = computed(() =>
  canReturnGrant(props.row, props.canAccessShopAdmin),
);
const showRetryTheseus = computed(() =>
  canRetryTheseus(props.row, props.canAccessShopAdmin),
);
const showCancel = computed(() =>
  canCancelOrder(props.row, props.canAccessShopAdmin),
);
const showUnship = computed(() =>
  canUnshipOrder(props.row, props.canAccessShopAdmin),
);

async function unshipOrder() {
  loadingAction.value = "unship";
  try {
    await $fetch(`/api/internal/shop/orders/${orderId.value}/unship`, {
      method: "POST",
    });
    emit(
      "success",
      `Order #${orderId.value} unshipped and back to pending fulfillment.`,
    );
  } catch (error) {
    console.error(error);
    emit("error", extractErrorMessage(error, "Failed to unship order"));
  } finally {
    await refreshRow();
    loadingAction.value = null;
  }
}

async function submitInternalShipment() {
  loadingAction.value = "ship";
  try {
    const wasShipped = alreadyShipped.value;
    await $fetch(`/api/internal/shop/orders/${orderId.value}/ship`, {
      method: "PATCH",
      body: { trackingNumber: trackingInput.value },
    });
    emit(
      "success",
      wasShipped
        ? `Order #${orderId.value} tracking updated.`
        : `Order #${orderId.value} marked as shipped.`,
    );
  } catch (error) {
    console.error(error);
    emit("error", extractErrorMessage(error, "Failed to ship order"));
  } finally {
    await refreshRow();
    loadingAction.value = null;
  }
}

async function createGrant() {
  loadingAction.value = "grant";
  try {
    await $fetch(`/api/internal/shop/orders/${orderId.value}/grant`, {
      method: "POST",
    });
    emit("success", `Grant created for order #${orderId.value}.`);
  } catch (error) {
    console.error(error);
    emit("error", extractErrorMessage(error, "Failed to create HCB grant"));
  } finally {
    await refreshRow();
    loadingAction.value = null;
  }
}

async function retryTheseus() {
  loadingAction.value = "theseus";
  try {
    await $fetch(`/api/internal/shop/orders/${orderId.value}/theseus`, {
      method: "POST",
    });
    emit("success", `Theseus retried for order #${orderId.value}.`);
  } catch (error) {
    console.error(error);
    emit("error", extractErrorMessage(error, "Failed to retry Theseus order"));
  } finally {
    await refreshRow();
    loadingAction.value = null;
  }
}

// amount is fixed at the order's usd value: gold / 10 = dollars, so gold * 10 = cents
const showFallbackGrant = computed(() =>
  canFallbackGrant(props.row, props.canAccessShopAdmin),
);
const fallbackGrantModalOpen = ref(false);
const fallbackGrantSaving = ref(false);
const fallbackGrantError = ref("");

const fallbackGrantAmountCents = computed(
  () => (props.row.order.total_price_gold ?? 0) * 10,
);
const fallbackGrantAmountDetail = computed(
  () =>
    `$${(fallbackGrantAmountCents.value / 100).toFixed(2)} (${props.row.order.total_price_gold ?? 0} gold)`,
);

function openFallbackGrant() {
  fallbackGrantError.value = "";
  fallbackGrantModalOpen.value = true;
}

function closeFallbackGrantModal() {
  if (fallbackGrantSaving.value) return;
  fallbackGrantModalOpen.value = false;
  fallbackGrantError.value = "";
}

async function confirmFallbackGrant() {
  fallbackGrantError.value = "";
  fallbackGrantSaving.value = true;
  loadingAction.value = "fallback-grant";

  try {
    await $fetch(`/api/internal/shop/orders/${orderId.value}/fallback-grant`, {
      method: "POST",
      body: { amount_cents: fallbackGrantAmountCents.value },
    });
    emit(
      "success",
      `Order #${orderId.value} replaced with a ${fallbackGrantAmountDetail.value} HCB grant.`,
    );
    fallbackGrantModalOpen.value = false;
  } catch (error) {
    console.error(error);
    const message = extractErrorMessage(error, "Failed to create fallback grant");
    fallbackGrantError.value = message;
    emit("error", message);
  } finally {
    fallbackGrantSaving.value = false;
    await refreshRow();
    loadingAction.value = null;
  }
}

const returnGrantModalOpen = ref(false);
const returnGrantSaving = ref(false);
const returnGrantError = ref("");

// mirrors server decideHcbGrantRefundEligibility; a cancelled grant reports
// balance_cents 0 regardless of spend, so it's judged on merchant spend
const returnGrantIsUntouched = computed(() => {
  const grant = props.row.order.hcb_card_grant;
  if (!grant) return false;
  const amount = grant.amount_cents ?? 0;
  if (amount === 0) return true;
  if ((grant.balance_cents ?? 0) === amount) return true;
  return grant.returned && grant.spent_cents === 0 && !grant.transactions_has_more;
});

const returnGrantRefundDetail = computed(() => {
  const totalGold = props.row.order.total_price_gold ?? 0;
  return totalGold > 0
    ? `${totalGold} gold (~$${(totalGold / 10).toFixed(2)})`
    : "the original currency";
});

const returnGrantSpentDetail = computed(() => {
  const grant = props.row.order.hcb_card_grant;
  if (!grant) return "";
  return `$${((grant.spent_cents ?? 0) / 100).toFixed(2)}`;
});

function openReturnGrant() {
  returnGrantError.value = "";
  returnGrantModalOpen.value = true;
}

function closeReturnGrantModal() {
  if (returnGrantSaving.value) return;
  returnGrantModalOpen.value = false;
  returnGrantError.value = "";
}

async function confirmReturnGrant() {
  returnGrantError.value = "";
  returnGrantSaving.value = true;
  loadingAction.value = "return-grant";

  try {
    const response = await $fetch<{
      refunded: boolean;
      refundAmount: number | null;
      refundFruitType: string | null;
    }>(`/api/internal/shop/orders/${orderId.value}/return-grant`, {
      method: "POST",
    });
    const userName = props.row.orderUser?.name ?? "the user";
    if (response?.refunded) {
      emit(
        "success",
        `Grant returned for order #${orderId.value}. Refunded ${response.refundAmount} ${response.refundFruitType ?? "gold"} to ${userName}.`,
      );
    } else {
      emit(
        "success",
        `Grant returned for order #${orderId.value}. No refund (HCB card was already used).`,
      );
    }
    returnGrantModalOpen.value = false;
  } catch (error) {
    console.error(error);
    const message = extractErrorMessage(error, "Failed to return HCB grant");
    returnGrantError.value = message;
    emit("error", message);
  } finally {
    returnGrantSaving.value = false;
    await refreshRow();
    loadingAction.value = null;
  }
}

const cancelModalOpen = ref(false);
const cancelReason = ref("");
const cancelSaving = ref(false);
const cancelError = ref("");

const cancelModalRefundDetail = computed(() => {
  const totalGold = props.row.order.total_price_gold ?? 0;
  return totalGold > 0
    ? `${totalGold} gold (~$${(totalGold / 10).toFixed(2)})`
    : "the original currency";
});

const cancelModalIsTheseus = computed(
  () => props.row.order.item_snapshot?.fulfillment_provider === "theseus",
);

function openCancel() {
  cancelReason.value = "";
  cancelError.value = "";
  cancelModalOpen.value = true;
}

function closeCancelModal() {
  if (cancelSaving.value) return;
  cancelModalOpen.value = false;
  cancelReason.value = "";
  cancelError.value = "";
}

async function confirmCancelOrder() {
  cancelError.value = "";
  cancelSaving.value = true;
  loadingAction.value = "cancel";

  try {
    const response = await $fetch<{ theseusWarning: string | null }>(
      `/api/internal/shop/orders/${orderId.value}/cancel`,
      {
        method: "POST",
        body: { reason: cancelReason.value.trim() || undefined },
      },
    );
    emit(
      "success",
      response?.theseusWarning
        ? `Order #${orderId.value} cancelled. ${response.theseusWarning}`
        : `Order #${orderId.value} cancelled and refunded.`,
    );
    cancelModalOpen.value = false;
    cancelReason.value = "";
  } catch (error) {
    console.error(error);
    const message = extractErrorMessage(error, "Failed to cancel order");
    cancelError.value = message;
    emit("error", message);
  } finally {
    cancelSaving.value = false;
    await refreshRow();
    loadingAction.value = null;
  }
}

function modifierDeltaSum(options: { price_delta_hours: number }[]) {
  return options.reduce((sum, opt) => sum + opt.price_delta_hours, 0);
}

// full country name for fulfillers, keeping the code since shipping labels want it
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code: string) {
  const upper = code.trim().toUpperCase();
  try {
    const name = regionNames.of(upper);
    return name && name !== upper ? `${name} (${upper})` : code;
  } catch {
    return code;
  }
}
</script>

<template>
  <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-3 flex-wrap">
          <h2 class="text-xl font-bold text-white">
            <a
              v-if="row.item?.store_url"
              :href="row.item.store_url"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-amber-200 transition-colors underline-offset-4 decoration-zinc-600 hover:decoration-amber-400 hover:underline inline-flex items-baseline gap-1.5"
            >
              <span>{{ row.order.item_snapshot?.name ?? `Item #${row.order.item_id}` }}</span>
              <span class="text-sm text-zinc-500" aria-hidden="true">↗</span>
            </a>
            <span v-else>
              {{ row.order.item_snapshot?.name ?? `Item #${row.order.item_id}` }}
            </span>
          </h2>
          <span
            class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
            :class="statusClass(row.order.status)"
          >
            {{ statusLabel(row.order.status) }}
          </span>
          <span
            class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400"
          >
            {{ itemTypeLabel(row.order.item_snapshot) }}
          </span>
          <span
            v-if="!row.fulfillable"
            class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-red-500/30 bg-red-500/10 text-red-300"
          >
            Not Fulfillable
          </span>
          <span
            v-if="row.hackatime_red"
            class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-rose-500/30 bg-rose-500/10 text-rose-300"
            title="Buyer is Hackatime red. Open orders are cancelled and refunded automatically; this order can't be fulfilled."
          >
            Hackatime Red
          </span>
          <span
            v-if="row.order.hcb_card_grant"
            class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
            :class="hcbGrantStatusClass(row.order.hcb_card_grant)"
          >
            HCB {{ hcbGrantStatusLabel(row.order.hcb_card_grant) }}
          </span>
        </div>
        <p class="text-sm text-zinc-400">
          <InternalEntityRef
            v-if="headingLink"
            :id="row.order.id"
            type="order"
            :label="`Order #${row.order.id}`"
          />
          <span v-else>Order #{{ row.order.id }}</span>
          · {{ row.order.quantity }} qty ·
          ${{ ((row.order.total_price_gold ?? 0) / 10).toFixed(2) }} ({{ row.order.total_price_gold ?? 0 }} gold)
        </p>
        <p class="text-xs text-zinc-500">
          {{ formatOrderDateTime(row.order.created_at) }}
          <template v-if="row.orderUser">
            ·
            <NuxtLink
              :to="`/internal/users/${row.orderUser.id}`"
              class="text-zinc-300 hover:text-amber-200 transition-colors"
            >
              {{ row.orderUser.name }}
            </NuxtLink>
          </template>
        </p>
      </div>

      <div class="text-sm text-zinc-400 flex flex-col items-end gap-1">
        <span v-if="row.order.item_snapshot?.grant_amount_cents != null">
          Grant amount: {{ formatUsdCents(row.order.item_snapshot.grant_amount_cents * (row.order.quantity ?? 1)) }}
        </span>
        <span v-if="row.order.hcb_card_grant && !row.order.hcb_card_grant.fetch_error">
          HCB balance: {{ formatUsdCents(row.order.hcb_card_grant.balance_cents) }}
        </span>
        <span v-if="row.order.external_reference">External ref: {{ row.order.external_reference }}</span>
        <span v-if="row.order.tracking_number">Tracking: {{ row.order.tracking_number }}</span>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2">
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Buyer</p>
        <p class="text-sm text-white">{{ row.orderUser?.name ?? "Unknown user" }}</p>
        <p v-if="canSeePii" class="text-sm text-zinc-400">
          Email: {{ row.orderUser?.email ?? "—" }}
        </p>
        <p v-if="canSeePii" class="text-sm text-zinc-400">
          HCB Email: {{ row.orderUser?.hcb_email ?? row.orderUser?.email ?? "—" }}
        </p>
        <a
          v-if="slackDmUrl"
          :href="slackDmUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-1 inline-flex items-center gap-1.5 w-fit px-3 py-1.5 text-xs font-bold border border-zinc-700 text-zinc-300 hover:border-amber-400 hover:text-amber-200 transition-colors"
          title="Open this buyer's Slack profile to DM them (e.g. about missing shipping info)"
        >
          <MessageCircle class="w-3.5 h-3.5" />
          DM on Slack
        </a>
      </div>

      <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2 lg:col-span-2">
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Fulfillment Notes</p>
        <p class="text-sm text-zinc-300">
          Provider: {{ row.order.item_snapshot ? row.order.item_snapshot.fulfillment_provider : "unknown" }}
        </p>
        <div
          v-if="row.order.item_snapshot?.selected_modifiers && row.order.item_snapshot.selected_modifiers.length > 0"
          class="flex flex-col gap-1 pt-2 border-t border-zinc-800/60"
        >
          <p class="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Variants</p>
          <ul class="text-sm text-zinc-200 flex flex-col gap-0.5">
            <li
              v-for="modifier in row.order.item_snapshot.selected_modifiers"
              :key="modifier.modifier_id"
              class="flex flex-wrap items-baseline gap-1"
            >
              <span class="text-zinc-400">{{ modifier.modifier_label }}:</span>
              <!-- quoted and mono so buyer text isn't mistaken for an option name -->
              <span
                v-if="modifier.type === 'text'"
                class="font-mono text-amber-200"
              >&quot;{{ modifier.text_value ?? modifier.options[0]?.label ?? "" }}&quot;</span>
              <span v-else>{{ modifier.options.map((opt) => opt.label).join(", ") }}</span>
              <span
                v-if="modifier.options.some((opt) => opt.price_delta_hours !== 0)"
                class="text-[10px] text-zinc-500"
              >
                ({{ modifierDeltaSum(modifier.options) > 0 ? "+" : "" }}{{ modifierDeltaSum(modifier.options) * 10 }}g/unit)
              </span>
            </li>
          </ul>
        </div>
        <div
          v-if="row.order.fulfillment_note"
          class="flex flex-col gap-1 pt-2 border-t border-zinc-800/60"
        >
          <p class="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Note from buyer</p>
          <PlainTextWithLinks
            :text="row.order.fulfillment_note"
            class="text-sm text-zinc-200 break-words"
          />
        </div>
        <p v-if="row.order.fulfillment_error" class="text-sm text-red-300">
          Last external error: {{ row.order.fulfillment_error }}
        </p>
        <p v-if="row.order.status === 'theseus_submitted'" class="text-sm text-zinc-400">
          Theseus orders do not require manual Macondo fulfillment once submitted.
        </p>
        <p v-if="row.order.status === 'grant_created'" class="text-sm text-zinc-400">
          This order has an HCB card grant reference. Live HCB status is shown below.
        </p>
        <p v-if="row.order.status === 'service_activated'" class="text-sm text-zinc-400">
          This virtual service was activated automatically at purchase time.
        </p>
      </div>
    </div>

    <InternalHcbGrantDetail
      v-if="row.order.hcb_card_grant"
      :info="row.order.hcb_card_grant"
    />

    <div
      v-if="canSeePii && row.order.shipping_address"
      class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2"
    >
      <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Shipping Address</p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-zinc-500">Name:</dt>
        <dd class="text-white">
          {{ row.order.shipping_address.firstName }} {{ row.order.shipping_address.lastName }}
        </dd>
        <dt class="text-zinc-500">Street address:</dt>
        <dd class="text-white">{{ row.order.shipping_address.address1 }}</dd>
        <template v-if="row.order.shipping_address.address2">
          <dt class="text-zinc-500">Apartment/building:</dt>
          <dd class="text-white">{{ row.order.shipping_address.address2 }}</dd>
        </template>
        <dt class="text-zinc-500">City:</dt>
        <dd class="text-white">{{ row.order.shipping_address.city }}</dd>
        <template v-if="row.order.shipping_address.state">
          <dt class="text-zinc-500">State/province:</dt>
          <dd class="text-white">{{ row.order.shipping_address.state }}</dd>
        </template>
        <dt class="text-zinc-500">Postcode/zipcode:</dt>
        <dd class="text-white">{{ row.order.shipping_address.postalCode }}</dd>
        <dt class="text-zinc-500">Country:</dt>
        <dd class="text-white">{{ countryName(row.order.shipping_address.country) }}</dd>
        <template v-if="row.order.phone">
          <dt class="text-zinc-500">Phone:</dt>
          <dd class="text-white">{{ row.order.phone }}</dd>
        </template>
      </dl>
    </div>

    <div
      v-else-if="canSeePii && row.order.item_snapshot?.kind === 'physical'"
      class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2"
    >
      <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Shipping Address</p>
      <p class="text-sm text-zinc-500">
        Stored on the order, hidden after fulfillment or external handoff.
      </p>
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-if="showShip"
        class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3"
      >
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
          {{ alreadyShipped ? "Update Tracking" : "Internal Shipment" }}
        </p>
        <div class="flex flex-col md:flex-row gap-3">
          <input
            v-model="trackingInput"
            type="text"
            class="flex-1 bg-black/40 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
            placeholder="Enter any tracking code"
          >
          <button
            class="px-4 py-2.5 text-sm font-bold border border-amber-400 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
            :disabled="isLoading('ship')"
            @click="submitInternalShipment"
          >
            <template v-if="isLoading('ship')">Saving...</template>
            <template v-else>{{ alreadyShipped ? "Update Tracking" : "Mark Shipped" }}</template>
          </button>
        </div>
        <p class="text-xs text-zinc-500">
          {{
            alreadyShipped
              ? "Saving a changed tracking number re-notifies the buyer."
              : "Marking shipped notifies the buyer with this tracking number."
          }}
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <button
          v-if="showCreateGrant"
          class="px-4 py-2.5 text-sm font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-colors disabled:opacity-60"
          :disabled="isLoading('grant')"
          @click="createGrant"
        >
          {{ isLoading("grant") ? "Creating..." : "Create HCB Grant" }}
        </button>

        <button
          v-if="showReturnGrant"
          class="px-4 py-2.5 text-sm font-bold border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition-colors disabled:opacity-60"
          :disabled="isLoading('return-grant')"
          @click="openReturnGrant"
        >
          {{ isLoading("return-grant") ? "Returning..." : "Return HCB Grant" }}
        </button>

        <button
          v-if="showRetryTheseus"
          class="px-4 py-2.5 text-sm font-bold border border-blue-500/40 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 transition-colors disabled:opacity-60"
          :disabled="isLoading('theseus')"
          @click="retryTheseus"
        >
          {{ isLoading("theseus") ? "Retrying..." : "Retry Theseus" }}
        </button>

        <button
          v-if="showFallbackGrant"
          class="px-4 py-2.5 text-sm font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-colors disabled:opacity-60"
          :disabled="isLoading('fallback-grant')"
          title="Skip fulfillment and send the buyer a one-time HCB card grant worth the order's gold price instead."
          @click="openFallbackGrant"
        >
          {{ isLoading("fallback-grant") ? "Creating..." : "Replace with Grant" }}
        </button>

        <button
          v-if="showUnship"
          class="px-4 py-2.5 text-sm font-bold border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
          :disabled="isLoading('unship')"
          title="Revert to pending fulfillment so cancel and re-ship become available. Does not notify the buyer."
          @click="unshipOrder"
        >
          {{ isLoading("unship") ? "Unshipping..." : "Unship" }}
        </button>

        <button
          v-if="showCancel"
          class="px-4 py-2.5 text-sm font-bold border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition-colors disabled:opacity-60"
          :disabled="isLoading('cancel')"
          @click="openCancel"
        >
          {{ isLoading("cancel") ? "Cancelling..." : "Cancel & refund" }}
        </button>
      </div>
    </div>
  </section>

  <Transition name="modal-fade">
    <div
      v-if="cancelModalOpen"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="closeCancelModal"
    >
      <div class="modal-fade-panel relative bg-zinc-950 border border-red-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg">
        <h2 class="text-red-200 font-bold text-lg">
          Cancel order #{{ row.order.id }}
        </h2>
        <p class="text-zinc-300 text-sm">
          Refund <strong class="text-white">{{ cancelModalRefundDetail }}</strong>
          to {{ row.orderUser?.name ?? "the user" }}.
          <span class="text-red-400">This cannot be undone.</span>
        </p>
        <p
          v-if="cancelModalIsTheseus"
          class="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 p-2"
        >
          This is a Theseus order. The letter may already be in the
          mail, contact the user separately if recall is needed.
        </p>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
            Reason (optional)
          </label>
          <textarea
            v-model="cancelReason"
            rows="3"
            placeholder="e.g. user requested refund, wrong item shipped"
            class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
          />
        </div>
        <p v-if="cancelError" class="text-red-400 text-xs">{{ cancelError }}</p>
        <div class="flex gap-2 justify-end">
          <button
            class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors disabled:opacity-50"
            :disabled="cancelSaving"
            @click="closeCancelModal"
          >
            Keep order
          </button>
          <button
            class="text-sm font-bold bg-red-700/40 text-red-100 hover:bg-red-700/60 border border-red-700 px-4 py-2 transition-colors disabled:opacity-50"
            :disabled="cancelSaving"
            @click="confirmCancelOrder"
          >
            {{ cancelSaving ? "Cancelling..." : "Cancel & refund" }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="modal-fade">
    <div
      v-if="returnGrantModalOpen"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="closeReturnGrantModal"
    >
      <div class="modal-fade-panel relative bg-zinc-950 border border-red-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg">
        <h2 class="text-red-200 font-bold text-lg">
          Return HCB grant for order #{{ row.order.id }}
        </h2>
        <p v-if="returnGrantIsUntouched" class="text-zinc-300 text-sm">
          This will cancel the HCB card grant AND refund
          <strong class="text-white">{{ returnGrantRefundDetail }}</strong>
          to {{ row.orderUser?.name ?? "the user" }}.
          The order will move back to <code class="text-zinc-100">grant_created</code>.
        </p>
        <p v-else class="text-zinc-300 text-sm">
          This will cancel the HCB card grant.
          <strong class="text-amber-300">{{ row.orderUser?.name ?? "The user" }} will NOT be refunded</strong>
          because
          <span v-if="row.order.hcb_card_grant">
            {{ returnGrantSpentDetail }} has already been spent on the card.
          </span>
          <span v-else>
            live HCB grant data is unavailable, so we can't confirm the card is untouched.
          </span>
        </p>
        <p v-if="returnGrantError" class="text-red-400 text-xs">{{ returnGrantError }}</p>
        <div class="flex gap-2 justify-end">
          <button
            class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors disabled:opacity-50"
            :disabled="returnGrantSaving"
            @click="closeReturnGrantModal"
          >
            Keep grant
          </button>
          <button
            class="text-sm font-bold bg-red-700/40 text-red-100 hover:bg-red-700/60 border border-red-700 px-4 py-2 transition-colors disabled:opacity-50"
            :disabled="returnGrantSaving"
            @click="confirmReturnGrant"
          >
            {{ returnGrantSaving ? "Returning..." : returnGrantIsUntouched ? "Return & refund" : "Return without refund" }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="modal-fade">
    <div
      v-if="fallbackGrantModalOpen"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="closeFallbackGrantModal"
    >
      <div class="modal-fade-panel relative bg-zinc-950 border border-emerald-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg">
        <h2 class="text-emerald-200 font-bold text-lg">
          Replace order #{{ row.order.id }} with a grant
        </h2>
        <p class="text-zinc-300 text-sm">
          Sends {{ row.orderUser?.name ?? "the user" }} a one-time-use HCB card
          grant of <strong class="text-white">{{ fallbackGrantAmountDetail }}</strong>
          so they can buy the item themselves. The buyer is notified by email
          and Slack, and this item will no longer be shipped by us.
        </p>
        <p v-if="fallbackGrantError" class="text-red-400 text-xs">{{ fallbackGrantError }}</p>
        <div class="flex gap-2 justify-end">
          <button
            class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors disabled:opacity-50"
            :disabled="fallbackGrantSaving"
            @click="closeFallbackGrantModal"
          >
            Keep order
          </button>
          <button
            class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors disabled:opacity-50"
            :disabled="fallbackGrantSaving"
            @click="confirmFallbackGrant"
          >
            {{ fallbackGrantSaving ? "Creating grant..." : "Create grant" }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
