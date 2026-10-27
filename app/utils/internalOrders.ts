export type ResolvedModifierSelection = {
  modifier_id: string;
  modifier_label: string;
  type: "single" | "multi" | "text";
  options: Array<{
    option_id: string;
    label: string;
    price_delta_hours: number;
  }>;
  // Also mirrored as options[0].label so generic renderers need no special case.
  text_value?: string;
};

export type ShopItemSnapshot = {
  id: number;
  // Missing on snapshots written before slugs existed.
  slug?: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  kind: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
  fulfillment_provider: "internal" | "theseus" | "hcb" | "internal_synthetic";
  price_hours: number;
  price_gold: number;
  grant_amount_cents: number | null;
  attachment_urls: string[];
  selected_modifiers?: ResolvedModifierSelection[];
  modifiers_config?: unknown;
  price_hours_per_unit?: number;
  price_gold_per_unit?: number;
};

export type HcbGrantTransaction = {
  id: string;
  date: string | null;
  amount_cents: number | null;
  memo: string | null;
  pending: boolean;
  declined: boolean;
  reversed: boolean;
  missing_receipt: boolean;
  code: string | null;
};

export type HcbGrantInfo = {
  id: string;
  amount_cents: number | null;
  balance_cents: number | null;
  spent_cents: number;
  purpose: string | null;
  status: string | null;
  returned: boolean;
  email: string | null;
  expires_on: string | null;
  card_id: string | null;
  transactions_total_count: number;
  transactions_has_more: boolean;
  transactions: HcbGrantTransaction[];
  fetch_error: string | null;
};

export type ShopOrder = {
  id: number;
  user_id: string;
  item_id: number;
  quantity: number;
  status:
    | "pending_internal_fulfillment"
    | "shipped"
    | "service_activated"
    | "grant_pending"
    | "grant_created"
    | "theseus_submitted"
    | "external_failure"
    | "cancelled";
  item_snapshot: ShopItemSnapshot | null;
  shipping_address: {
    firstName: string;
    lastName: string;
    address1: string;
    address2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
  phone: string | null;
  tracking_number: string | null;
  external_reference: string | null;
  fulfillment_error: string | null;
  fulfillment_note: string | null;
  hcb_card_grant: HcbGrantInfo | null;
  total_price_gold: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OrderListItem = {
  order: ShopOrder;
  item: {
    id: number;
    available: boolean;
    store_url: string | null;
  } | null;
  orderUser: {
    id: string;
    name: string;
    image: string | null;
    email: string | null;
    hcb_email: string | null;
    slack_id: string | null;
  } | null;
  fulfillable: boolean;
  hackatime_red?: boolean;
};

export const ORDER_STATUS_VALUES = [
  "pending_internal_fulfillment",
  "grant_pending",
  "external_failure",
  "shipped",
  "service_activated",
  "grant_created",
  "theseus_submitted",
  "cancelled",
] as const satisfies ReadonlyArray<ShopOrder["status"]>;

// external_failure counts because failed orders usually need a human to retry or cancel.
export const ACTIVELY_PENDING_STATUSES = new Set<ShopOrder["status"]>([
  "pending_internal_fulfillment",
  "grant_pending",
  "external_failure",
]);

export function isOrderStatus(value: unknown): value is ShopOrder["status"] {
  return (
    typeof value === "string" &&
    (ORDER_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function statusLabel(status: ShopOrder["status"]) {
  switch (status) {
    case "pending_internal_fulfillment":
      return "Pending Internal Fulfillment";
    case "shipped":
      return "Shipped";
    case "service_activated":
      return "Service Activated";
    case "grant_pending":
      return "Grant Pending";
    case "grant_created":
      return "Grant Created";
    case "theseus_submitted":
      return "Theseus Submitted";
    case "external_failure":
      return "External Failure";
    case "cancelled":
      return "Cancelled";
  }
}

export function statusClass(status: ShopOrder["status"]) {
  switch (status) {
    case "pending_internal_fulfillment":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "shipped":
    case "service_activated":
    case "grant_created":
    case "theseus_submitted":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "grant_pending":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "external_failure":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    case "cancelled":
      return "border-red-500/40 bg-zinc-900/40 text-red-300";
  }
}

export function itemTypeLabel(snapshot: ShopItemSnapshot | null) {
  if (!snapshot) return "Unknown";
  if (snapshot.kind === "grant") return "Grant";
  if (snapshot.kind === "virtual_service") return "Virtual Service";
  if (snapshot.kind === "consumable") return "Consumable";
  if (snapshot.kind === "experience") return "Experience";
  return snapshot.fulfillment_provider === "theseus" ? "Theseus Mail" : "Physical";
}

export function formatOrderDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown time";
}

export function formatUsdCents(value: number | null | undefined) {
  return value == null ? "Unknown" : `$${(value / 100).toFixed(2)}`;
}

export function hcbGrantStatusLabel(grant: HcbGrantInfo | null) {
  if (!grant) return "Unknown";
  if (grant.fetch_error) return "Unavailable";
  if (grant.returned) return "Returned";
  return grant.status ? grant.status.replaceAll("_", " ") : "Unknown";
}

export function hcbGrantStatusClass(grant: HcbGrantInfo | null) {
  if (!grant || grant.fetch_error) return "border-zinc-700 text-zinc-400";
  if (grant.returned) return "border-red-500/30 bg-red-500/10 text-red-300";
  if (grant.status === "active")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export function transactionAmountClass(transaction: HcbGrantTransaction) {
  if (transaction.declined || transaction.reversed) return "text-zinc-500";
  return (transaction.amount_cents ?? 0) < 0 ? "text-red-300" : "text-emerald-300";
}

// Matched off the frozen snapshot so renaming or deleting the item doesn't change it.
export const TRAVEL_STIPEND_SLUG = "travel_stipend";

export function canShipInternally(row: OrderListItem) {
  return (
    row.order.item_snapshot?.kind === "physical" &&
    row.order.item_snapshot?.fulfillment_provider === "internal" &&
    ["pending_internal_fulfillment", "shipped"].includes(row.order.status)
  );
}

export function canCreateGrant(row: OrderListItem, canAccessShopAdmin: boolean) {
  return (
    canAccessShopAdmin &&
    row.order.item_snapshot?.kind === "grant" &&
    row.order.item_snapshot?.fulfillment_provider === "hcb" &&
    !row.order.external_reference &&
    ["grant_pending", "external_failure"].includes(row.order.status)
  );
}

export function canReturnGrant(row: OrderListItem, canAccessShopAdmin: boolean) {
  return (
    canAccessShopAdmin &&
    row.order.item_snapshot?.kind === "grant" &&
    row.order.item_snapshot?.fulfillment_provider === "hcb" &&
    !!row.order.external_reference &&
    row.order.hcb_card_grant?.returned !== true &&
    ["grant_created", "external_failure"].includes(row.order.status)
  );
}

export function canRetryTheseus(row: OrderListItem, canAccessShopAdmin: boolean) {
  return (
    canAccessShopAdmin &&
    row.order.item_snapshot?.kind === "physical" &&
    row.order.item_snapshot?.fulfillment_provider === "theseus" &&
    row.order.status === "external_failure"
  );
}

// "Replace with grant": an HCB card grant worth the gold price instead of the physical item.
export function canFallbackGrant(row: OrderListItem, canAccessShopAdmin: boolean) {
  return (
    canAccessShopAdmin &&
    row.order.item_snapshot?.kind === "physical" &&
    !row.order.external_reference &&
    (row.order.total_price_gold ?? 0) > 0 &&
    ["pending_internal_fulfillment", "external_failure"].includes(row.order.status)
  );
}

export function canUnshipOrder(row: OrderListItem, canAccessShopAdmin: boolean) {
  return canAccessShopAdmin && row.order.status === "shipped";
}

export function canCancelOrder(row: OrderListItem, canAccessShopAdmin: boolean) {
  if (!canAccessShopAdmin) return false;
  return (
    row.order.status === "pending_internal_fulfillment" ||
    row.order.status === "grant_pending" ||
    row.order.status === "theseus_submitted" ||
    row.order.status === "external_failure" ||
    // A virtual service auto-activates at purchase, so this never means "already delivered".
    row.order.status === "service_activated"
  );
}
