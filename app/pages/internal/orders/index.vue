<script setup lang="ts">
import {
  ACTIVELY_PENDING_STATUSES,
  ORDER_STATUS_VALUES,
  canCancelOrder,
  canCreateGrant,
  isOrderStatus,
  statusLabel,
  type OrderListItem,
  type ShopOrder,
} from "~/utils/internalOrders";

definePageMeta({ layout: "internal" });

// Filtering and pagination are server-side: the endpoint only enriches (HCB lookups) the page it returns.
const searchQuery = ref("");
const debouncedSearch = ref("");

type ProviderFilter = "all" | "internal" | "theseus" | "hcb";
const filterProvider = ref<ProviderFilter>("all");
const hideTheseus = ref(false);
// Hide orders the fulfillment gate blocks (shadow-ban, unclean ships, pending/flagged fraud review).
const fulfillableOnly = ref(false);
// Applies to every viewer, so it sits outside the canViewAllOrders block below.
const travelStipendsOnly = ref(false);
const filterStatuses = ref<Set<ShopOrder["status"]>>(
  new Set(ACTIVELY_PENDING_STATUSES),
);
const FILTER_STORAGE_KEY = "internal-orders-filters";

// Tall cards make 25 a long scroll. Must match PAGE_SIZE in server/api/internal/shop/orders.get.ts.
const PAGE_SIZE = 25;
const currentPage = ref(1);

// Pending = actively-pending statuses, Fulfilled = the complement, so the tabs partition every status.
type OrderTab = "pending" | "fulfilled";
const ORDER_TABS = ["pending", "fulfilled"] as const satisfies readonly OrderTab[];
const activeTab = ref<OrderTab>("pending");
const FULFILLED_TAB_STATUSES = new Set<ShopOrder["status"]>(
  ORDER_STATUS_VALUES.filter((status) => !ACTIVELY_PENDING_STATUSES.has(status)),
);

function tabStatuses(tab: OrderTab): Set<ShopOrder["status"]> {
  return tab === "pending" ? ACTIVELY_PENDING_STATUSES : FULFILLED_TAB_STATUSES;
}

function toggleStatusFilter(status: ShopOrder["status"]) {
  const next = new Set(filterStatuses.value);
  if (next.has(status)) next.delete(status);
  else next.add(status);
  filterStatuses.value = next;
}

function isStatusChecked(status: ShopOrder["status"]) {
  return filterStatuses.value.has(status);
}

if (import.meta.client) {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        filterProvider?: ProviderFilter;
        hideTheseus?: boolean;
        fulfillableOnly?: boolean;
        travelStipendsOnly?: boolean;
        filterStatuses?: unknown;
        activeTab?: unknown;
      };
      if (parsed.filterProvider) filterProvider.value = parsed.filterProvider;
      if (typeof parsed.hideTheseus === "boolean") hideTheseus.value = parsed.hideTheseus;
      if (typeof parsed.fulfillableOnly === "boolean") fulfillableOnly.value = parsed.fulfillableOnly;
      if (typeof parsed.travelStipendsOnly === "boolean") {
        travelStipendsOnly.value = parsed.travelStipendsOnly;
      }
      if (parsed.activeTab === "pending" || parsed.activeTab === "fulfilled") {
        activeTab.value = parsed.activeTab;
      }
      if (Array.isArray(parsed.filterStatuses)) {
        filterStatuses.value = new Set(parsed.filterStatuses.filter(isOrderStatus));
      }
    }
  } catch (storageError) {
    console.warn("Failed to read orders filter state", storageError);
  }
  // Clamp restored checkboxes to the active tab so a reload never starts on an empty list.
  const restoredTabSet = tabStatuses(activeTab.value);
  const scopedStatuses = new Set(
    [...filterStatuses.value].filter((status) => restoredTabSet.has(status)),
  );
  filterStatuses.value =
    scopedStatuses.size > 0 ? scopedStatuses : new Set(restoredTabSet);
  watch([filterProvider, hideTheseus, fulfillableOnly, travelStipendsOnly, filterStatuses, activeTab], () => {
    try {
      localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({
          filterProvider: filterProvider.value,
          hideTheseus: hideTheseus.value,
          fulfillableOnly: fulfillableOnly.value,
          travelStipendsOnly: travelStipendsOnly.value,
          filterStatuses: Array.from(filterStatuses.value),
          activeTab: activeTab.value,
        }),
      );
    } catch (storageError) {
      console.warn("Failed to persist orders filter state", storageError);
    }
  }, { deep: true });
}

const { data: meData } = useFetch<{
  permissions: {
    canSeePii: boolean;
    canAccessShopAdmin: boolean;
    canViewAllOrders: boolean;
  };
}>("/api/internal/me", { server: false });

const canSeePii = computed(() => meData.value?.permissions?.canSeePii ?? false);
const canAccessShopAdmin = computed(
  () => meData.value?.permissions?.canAccessShopAdmin ?? false,
);
// Full-view roles get filters and every order; fulfillers get a server-pre-scoped list and no filters.
const canViewAllOrders = computed(
  () => meData.value?.permissions?.canViewAllOrders ?? false,
);

// An empty checkbox set means the whole tab, so unchecking everything doesn't give a dead page.
const effectiveStatuses = computed(() => {
  const tabSet = tabStatuses(activeTab.value);
  if (canViewAllOrders.value && filterStatuses.value.size > 0) {
    const scoped = [...filterStatuses.value].filter((status) =>
      tabSet.has(status),
    );
    if (scoped.length > 0) return scoped;
  }
  return [...tabSet];
});

type OrdersResponse = {
  orders: OrderListItem[];
  total: number;
  page: number;
  per_page: number;
  status_counts: Record<string, number>;
};

const {
  data: ordersData,
  pending,
  error,
} = useFetch<OrdersResponse>("/api/internal/shop/orders", {
  server: false,
  default: () => null,
  query: computed(() => ({
    q: debouncedSearch.value || undefined,
    statuses: effectiveStatuses.value.join(","),
    provider:
      canViewAllOrders.value && filterProvider.value !== "all"
        ? filterProvider.value
        : undefined,
    hide_theseus: canViewAllOrders.value && hideTheseus.value ? "1" : undefined,
    fulfillable_only:
      canViewAllOrders.value && fulfillableOnly.value ? "1" : undefined,
    travel_stipends: travelStipendsOnly.value ? "1" : undefined,
    page: currentPage.value,
  })),
});

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    debouncedSearch.value = searchQuery.value.trim();
  }, 300);
}

watch(error, (newError) => {
  if (newError?.statusCode === 401) {
    navigateTo("/?login=required");
  }
});

const orders = computed(() => ordersData.value?.orders ?? []);
const total = computed(() => ordersData.value?.total ?? 0);
const statusCounts = computed(() => ordersData.value?.status_counts ?? {});

// Uses the server's pre-refinement buckets so tab badges stay a stable split for every role.
function sumStatusCounts(statuses: Set<ShopOrder["status"]>) {
  let count = 0;
  for (const status of statuses) count += statusCounts.value[status] ?? 0;
  return count;
}
const pendingCount = computed(() => sumStatusCounts(ACTIVELY_PENDING_STATUSES));
const fulfilledCount = computed(() => sumStatusCounts(FULFILLED_TAB_STATUSES));
const universeTotal = computed(() => pendingCount.value + fulfilledCount.value);

// Scoped to the active tab so the checkboxes refine within it instead of fighting the partition.
const statusFilterOptions = computed(() => [...tabStatuses(activeTab.value)]);

function selectTab(tab: OrderTab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  // Snap the checkboxes to the new tab, else the old tab's statuses would render an empty list.
  if (canViewAllOrders.value) {
    filterStatuses.value = new Set(tabStatuses(tab));
  }
}

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

// A filter that shrinks the list would otherwise strand you on a page that
// no longer exists.
watch(totalPages, (pages) => {
  if (currentPage.value > pages) currentPage.value = pages;
});

const actionError = ref("");
const actionSuccess = ref("");

// Replace one row in place: a full refetch re-runs a live HCB call for every grant order on the page.
function replaceRow(fresh: OrderListItem) {
  const current = ordersData.value;
  if (current) {
    ordersData.value = {
      ...current,
      orders: current.orders.map((row) =>
        row.order.id === fresh.order.id ? fresh : row,
      ),
    };
  }
  // Keep the selection snapshot in sync and drop rows that became non-selectable (e.g. cancelled).
  if (selectedRows.value.has(fresh.order.id)) {
    const next = new Map(selectedRows.value);
    if (isSelectable(fresh)) next.set(fresh.order.id, fresh);
    else next.delete(fresh.order.id);
    selectedRows.value = next;
  }
}

function onRowUpdated(fresh: OrderListItem) {
  replaceRow(fresh);
}

function onRowSuccess(message: string) {
  actionSuccess.value = message;
  actionError.value = "";
}

function onRowError(message: string) {
  actionError.value = message;
  actionSuccess.value = "";
}

// Chunked so a bulk action doesn't fire dozens of HCB lookups at once.
async function refreshRows(ids: number[]) {
  const chunkSize = 5;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const fresh = await Promise.all(
      ids.slice(i, i + chunkSize).map((id) =>
        $fetch<OrderListItem>(`/api/internal/shop/orders/${id}`).catch(
          () => null,
        ),
      ),
    );
    for (const row of fresh) if (row) replaceRow(row);
  }
}

// Selections persist across pages, so keep the full row snapshot keyed by order id.
const selectedRows = ref<Map<number, OrderListItem>>(new Map());

function isSelectable(row: OrderListItem) {
  return (
    canCreateGrant(row, canAccessShopAdmin.value) ||
    canCancelOrder(row, canAccessShopAdmin.value)
  );
}

// Scoped to the visible page so a bulk cancel never hits rows the operator can't see.
const pageSelectableOrders = computed(() =>
  orders.value.filter((row) => isSelectable(row)),
);
const allSelectableSelected = computed(
  () =>
    pageSelectableOrders.value.length > 0 &&
    pageSelectableOrders.value.every((row) =>
      selectedRows.value.has(row.order.id),
    ),
);
const someSelected = computed(() => selectedRows.value.size > 0);
const selectedCount = computed(() => selectedRows.value.size);
const selectedGrantable = computed(() =>
  [...selectedRows.value.values()].filter((row) =>
    canCreateGrant(row, canAccessShopAdmin.value),
  ),
);
const selectedCancellable = computed(() =>
  [...selectedRows.value.values()].filter((row) =>
    canCancelOrder(row, canAccessShopAdmin.value),
  ),
);

function toggleRow(row: OrderListItem) {
  if (!isSelectable(row)) return;
  const next = new Map(selectedRows.value);
  if (next.has(row.order.id)) next.delete(row.order.id);
  else next.set(row.order.id, row);
  selectedRows.value = next;
}

function toggleSelectAll() {
  const next = new Map(selectedRows.value);
  if (allSelectableSelected.value) {
    for (const row of pageSelectableOrders.value) next.delete(row.order.id);
  } else {
    for (const row of pageSelectableOrders.value) next.set(row.order.id, row);
  }
  selectedRows.value = next;
}

type BulkAction = null | "cancel";
const bulkAction = ref<BulkAction>(null);
const bulkReason = ref("");
const bulkLoading = ref(false);
const bulkError = ref<string | null>(null);
const bulkResultsMessage = ref<string | null>(null);
const bulkFailures = ref<{ id: number; error: string }[]>([]);

function clearSelection() {
  selectedRows.value = new Map();
  bulkAction.value = null;
  bulkReason.value = "";
  bulkError.value = null;
}

// Reset page and selection on any result-set change so bulk actions never hit invisible rows.
watch(
  [filterProvider, hideTheseus, fulfillableOnly, travelStipendsOnly, filterStatuses, activeTab, debouncedSearch],
  () => {
    currentPage.value = 1;
    clearSelection();
  },
);

function resetBulkResults() {
  bulkError.value = null;
  bulkResultsMessage.value = null;
  bulkFailures.value = [];
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

type BulkResponse = {
  requested: number;
  succeeded: number;
  failed: number;
  results: { id: number; ok: boolean; error?: string }[];
};

async function bulkCreateGrants() {
  const ids = selectedGrantable.value.map((row) => row.order.id);
  resetBulkResults();
  if (ids.length === 0) {
    bulkError.value = "Select at least one grant-pending order.";
    return;
  }
  bulkLoading.value = true;
  try {
    const res = await $fetch<BulkResponse>(
      "/api/internal/shop/orders/bulk-grant",
      { method: "POST", body: { ids } },
    );
    bulkResultsMessage.value = `Created ${res.succeeded} grant(s).${
      res.failed > 0 ? ` ${res.failed} failed.` : ""
    }`;
    bulkFailures.value = res.results
      .filter((result) => !result.ok)
      .map((result) => ({ id: result.id, error: result.error ?? "Failed" }));
    await refreshRows(ids);
  } catch (err) {
    bulkError.value = extractErrorMessage(err, "Bulk grant failed");
  } finally {
    bulkLoading.value = false;
  }
}

function startBulkCancel() {
  resetBulkResults();
  if (selectedCancellable.value.length === 0) {
    bulkError.value = "Select at least one cancellable order.";
    return;
  }
  bulkAction.value = "cancel";
}

async function submitBulkCancel() {
  const ids = selectedCancellable.value.map((row) => row.order.id);
  resetBulkResults();
  if (ids.length === 0) {
    bulkError.value = "Select at least one cancellable order.";
    return;
  }
  bulkLoading.value = true;
  try {
    const res = await $fetch<BulkResponse>(
      "/api/internal/shop/orders/bulk-cancel",
      {
        method: "POST",
        body: { ids, reason: bulkReason.value.trim() || undefined },
      },
    );
    bulkResultsMessage.value = `Cancelled ${res.succeeded} order(s).${
      res.failed > 0 ? ` ${res.failed} failed.` : ""
    }`;
    bulkFailures.value = res.results
      .filter((result) => !result.ok)
      .map((result) => ({ id: result.id, error: result.error ?? "Failed" }));
    bulkAction.value = null;
    bulkReason.value = "";
    await refreshRows(ids);
  } catch (err) {
    bulkError.value = extractErrorMessage(err, "Bulk cancel failed");
  } finally {
    bulkLoading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-6xl mx-auto flex flex-col gap-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="flex flex-col gap-1">
          <h1 class="text-3xl font-bold text-white tracking-tight">Orders</h1>
          <p class="text-zinc-400 text-sm mt-1">
            Manual fulfillment, grant creation, and external routing status for shop orders.
          </p>
        </div>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Item, name, email, slack, hackatime, HCB ref..."
          class="px-3 py-2 bg-black/40 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400 w-80"
          @input="onSearchInput"
        >
      </div>

      <div class="flex items-center gap-1 border-b border-zinc-800">
        <button
          v-for="tab in ORDER_TABS"
          :key="tab"
          type="button"
          class="px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors"
          :class="activeTab === tab
            ? 'border-white text-white'
            : 'border-transparent text-zinc-500 hover:text-zinc-300'"
          @click="selectTab(tab)"
        >
          {{ tab === "pending" ? "Pending" : "Fulfilled" }}
          <span class="font-normal text-zinc-600">
            ({{ tab === "pending" ? pendingCount : fulfilledCount }})
          </span>
        </button>
      </div>

      <div v-if="canViewAllOrders" class="flex flex-col gap-3 text-sm text-zinc-400">
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2">
            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Provider</span>
            <select
              v-model="filterProvider"
              class="bg-black/40 border border-zinc-700 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-zinc-400"
            >
              <option value="all">All</option>
              <option value="internal">Internal</option>
              <option value="theseus">Theseus</option>
              <option value="hcb">HCB Grant</option>
            </select>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="hideTheseus"
              type="checkbox"
              class="w-4 h-4 accent-zinc-300"
            >
            <span class="text-xs">Hide Theseus stickers</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="fulfillableOnly"
              type="checkbox"
              class="w-4 h-4 accent-zinc-300"
            >
            <span class="text-xs">Only fulfillable</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="travelStipendsOnly"
              type="checkbox"
              class="w-4 h-4 accent-zinc-300"
            >
            <span class="text-xs">Travel stipends only</span>
          </label>
          <span class="text-xs text-zinc-600">
            {{ total }} of {{ universeTotal }} shown<template
              v-if="totalPages > 1"
            >
              · page {{ currentPage }} of {{ totalPages }}</template>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Status</span>
          <label
            v-for="status in statusFilterOptions"
            :key="status"
            class="flex items-center gap-1.5 cursor-pointer px-2 py-1 border border-zinc-800 bg-black/30 hover:bg-black/50 transition-colors"
          >
            <input
              type="checkbox"
              class="w-3.5 h-3.5 accent-zinc-300"
              :checked="isStatusChecked(status)"
              @change="toggleStatusFilter(status)"
            >
            <span class="text-xs">{{ statusLabel(status) }}</span>
          </label>
        </div>
      </div>

      <p v-if="actionError" class="text-sm text-red-300">
        <InternalLinkifyText :text="actionError" />
      </p>
      <p v-if="actionSuccess" class="text-sm text-emerald-300">
        <InternalLinkifyText :text="actionSuccess" />
      </p>

      <div
        v-if="canAccessShopAdmin && (pageSelectableOrders.length > 0 || someSelected)"
        class="sticky top-20 z-20 border border-zinc-700 bg-zinc-950/90 backdrop-blur px-4 py-3 flex flex-col gap-3"
      >
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-3 flex-wrap">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                class="w-5 h-5 accent-white cursor-pointer"
                :checked="allSelectableSelected"
                @change="toggleSelectAll"
              >
              <span class="text-sm text-zinc-300">
                <strong class="text-white">{{ selectedCount }}</strong> selected
                <span class="text-zinc-500">
                  ({{ selectedGrantable.length }} grantable, {{ selectedCancellable.length }} cancellable)
                </span>
              </span>
            </label>
            <button
              v-if="someSelected"
              type="button"
              class="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-200 px-2 py-1 border border-transparent hover:border-zinc-700 transition-colors"
              @click="clearSelection"
            >
              Clear
            </button>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              class="px-3 py-2 text-sm font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              :disabled="bulkLoading || selectedGrantable.length === 0"
              @click="bulkCreateGrants"
            >
              {{ bulkLoading ? "Working..." : `Create ${selectedGrantable.length} grant(s)` }}
            </button>
            <button
              type="button"
              class="px-3 py-2 text-sm font-bold border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              :disabled="bulkLoading || selectedCancellable.length === 0"
              @click="startBulkCancel"
            >
              Cancel & refund {{ selectedCancellable.length }}
            </button>
          </div>
        </div>

        <div
          v-if="bulkAction === 'cancel'"
          class="border border-zinc-800 bg-black/30 p-3 flex flex-col gap-2"
        >
          <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
            Reason (optional, applied to all)
          </label>
          <textarea
            v-model="bulkReason"
            rows="2"
            placeholder="e.g. duplicate orders, event cancelled"
            class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
          />
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              class="text-sm text-zinc-400 hover:text-white px-3 py-1.5 transition-colors disabled:opacity-50"
              :disabled="bulkLoading"
              @click="bulkAction = null"
            >
              Back
            </button>
            <button
              type="button"
              class="text-sm font-bold bg-red-700/40 text-red-100 hover:bg-red-700/60 border border-red-700 px-3 py-1.5 transition-colors disabled:opacity-50"
              :disabled="bulkLoading"
              @click="submitBulkCancel"
            >
              {{ bulkLoading ? "Cancelling..." : `Cancel ${selectedCancellable.length} order(s)` }}
            </button>
          </div>
        </div>

        <p v-if="bulkError" class="text-sm text-red-300">{{ bulkError }}</p>
        <p v-if="bulkResultsMessage" class="text-sm text-emerald-300">{{ bulkResultsMessage }}</p>
        <div v-if="bulkFailures.length > 0" class="flex flex-col gap-1 text-xs text-red-300">
          <p class="font-bold uppercase tracking-widest text-[10px] text-zinc-500">Failed</p>
          <p v-for="failure in bulkFailures" :key="failure.id">
            <InternalEntityRef :id="failure.id" type="order" :label="`Order #${failure.id}`" /> — {{ failure.error }}
          </p>
        </div>
      </div>

      <div v-if="pending" class="text-sm text-zinc-500">Loading orders...</div>

      <div
        v-else-if="universeTotal === 0"
        class="border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-sm text-zinc-500"
      >
        No shop orders have been created yet.
      </div>

      <div
        v-else-if="orders.length === 0"
        class="border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-sm text-zinc-500"
      >
        No {{ activeTab === "pending" ? "pending" : "fulfilled" }} orders to show.
      </div>

      <div v-else class="flex flex-col gap-4">
        <div
          v-for="row in orders"
          :key="row.order.id"
          class="flex items-start gap-3"
        >
          <div v-if="canAccessShopAdmin" class="w-5 shrink-0 pt-5">
            <input
              v-if="isSelectable(row)"
              type="checkbox"
              class="w-5 h-5 accent-white cursor-pointer"
              :checked="selectedRows.has(row.order.id)"
              @change="toggleRow(row)"
            >
          </div>
          <div class="flex-1 min-w-0">
            <InternalOrderCard
              :row="row"
              :can-see-pii="canSeePii"
              :can-access-shop-admin="canAccessShopAdmin"
              @updated="onRowUpdated"
              @success="onRowSuccess"
              @error="onRowError"
            />
          </div>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-between gap-4 flex-wrap pt-2">
          <span class="text-xs text-zinc-500">
            Showing {{ (currentPage - 1) * PAGE_SIZE + 1 }}–{{
              (currentPage - 1) * PAGE_SIZE + orders.length
            }}
            of {{ total }}
          </span>
          <InternalPagination
            v-model:current-page="currentPage"
            :total-pages="totalPages"
          />
        </div>
      </div>
    </div>
  </div>
</template>
