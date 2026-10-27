<script setup lang="ts">
import { AlertTriangle } from "lucide-vue-next";
import { SHOP_ITEM_CATEGORIES, SHOP_ITEM_CATEGORY_LABELS, isShopItemCategory, type ShopItemCategory } from "~/data/shopCategories";
// regions.ts is pure data, safe for the client bundle; importing it keeps this list in sync
import { REGION_LABEL as REGION_LABELS, SHOP_REGIONS, type ShopRegion } from "~~/server/lib/regions";

const GOLD_PER_HOUR = 10;

// v-model on <input type="number"> casts to number once the user types, even
// without `.number`, so always coerce with String(...) before .trim()
type RegionalPricingEntry = {
    priceUsd: string | number;
    available: boolean;
    storeUrl: string;
};

type RegionalPricingStored = Partial<
    Record<ShopRegion, { price_hours?: number; available?: boolean; store_url?: string }>
>;

// matches ShopItemModifier in server/lib/shop.ts
type StoredModifierOption = {
    id: string;
    label: string;
    label_translations?: Record<string, string>;
    price_delta_hours: number;
};
type StoredModifier = {
    id: string;
    label: string;
    label_translations?: Record<string, string>;
    type: "single" | "multi" | "text";
    required?: boolean;
    options: StoredModifierOption[];
    max_length?: number;
    placeholder?: string;
    placeholder_translations?: Record<string, string>;
    price_delta_hours?: number;
};

// deltas are entered in usd, sent as gold (* GOLD_PER_HOUR), stored by the server as hours
type ModifierOptionForm = {
    id: string;
    label: string;
    priceDeltaUsd: number;
};
type ModifierForm = {
    id: string;
    label: string;
    type: "single" | "multi" | "text";
    required: boolean;
    options: ModifierOptionForm[];
    // Text-modifier fields (ignored for single/multi).
    maxLength: number;
    placeholder: string;
    priceDeltaUsd: number;
};

type ShopItem = {
    id: number;
    slug: string | null;
    name: string;
    description: string | null;
    name_translations: Record<string, string> | null;
    description_translations: Record<string, string> | null;
    image_url: string | null;
    kind: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
    fulfillment_provider: "internal" | "theseus" | "hcb" | "internal_synthetic";
    source: "hq" | "local" | null;
    price_hours: number;
    // effective price; the editor loads regular_* so re-saving an on-sale item keeps the regular price
    price_gold: number;
    regular_price_gold: number;
    is_on_sale: boolean;
    sale_price_hours: number | null;
    grant_amount_cents: number | null;
    attachment_urls: string[];
    inventory_mode: "unlimited" | "limited";
    stock_remaining: number | null;
    max_per_user: number | null;
    available_until: string | null;
    available: boolean;
    coming_soon: boolean;
    requires_shipped_project: boolean;
    pinned: boolean;
    extra_fruity: boolean;
    priority_eligible: boolean;
    category: string | null;
    is_expired: boolean;
    is_sold_out: boolean;
    is_purchasable: boolean;
    created_at: string | null;
    updated_at: string | null;
    regional_pricing: RegionalPricingStored | null;
    modifiers: StoredModifier[] | null;
};

type ShopAuditEntry = {
    id: number;
    action: string;
    entity_id: string;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    public_message: string | null;
    change_summary: string | null;
    created_at: string | null;
    actor: {
        id: string;
        name: string;
        image: string | null;
        username: string | null;
    } | null;
};

type ShopItemDetail = {
    item: ShopItem;
    audits: ShopAuditEntry[];
};

type SupportedLocale = "en" | "es";

const LOCALE_LABELS: Record<SupportedLocale, string> = {
    en: "English (source)",
    es: "Español",
};

const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "es"];

type ShopItemForm = {
    name: string;
    description: string;
    nameTranslations: Record<SupportedLocale, string>;
    descriptionTranslations: Record<SupportedLocale, string>;
    translationLocale: SupportedLocale;
    imageUrl: string;
    kind: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
    fulfillmentProvider: "internal" | "theseus" | "hcb" | "internal_synthetic";
    source: "hq" | "local";
    priceUsd: number;
    // gold = usd * 10; null = not on sale
    salePriceUsd: number | null;
    grantAmountDollars: number | null;
    attachmentUrlsText: string;
    inventoryMode: "unlimited" | "limited";
    stockRemaining: number | null;
    maxPerUser: number | null;
    availableUntil: string;
    available: boolean;
    comingSoon: boolean;
    requiresShippedProject: boolean;
    pinned: boolean;
    extraFruity: boolean;
    priorityEligible: boolean;
    category: ShopItemCategory | "";
    regionalPricing: Record<ShopRegion, RegionalPricingEntry>;
    modifiers: ModifierForm[];
};

function blankRegionalPricing(): Record<ShopRegion, RegionalPricingEntry> {
    const out = {} as Record<ShopRegion, RegionalPricingEntry>;
    for (const region of SHOP_REGIONS) {
        out[region] = { priceUsd: "", available: true, storeUrl: "" };
    }
    return out;
}

const props = withDefaults(defineProps<{
    mode: "create" | "edit";
    itemId?: number | null;
}>(), {
    itemId: null,
});

const auditFieldLabels: Record<string, string> = {
    name: "Name",
    description: "Description",
    name_translations: "Name translations",
    description_translations: "Description translations",
    image_url: "Image URL",
    kind: "Kind",
    fulfillment_provider: "Fulfillment",
    source: "Source",
    price_hours: "Price (USD)",
    sale_price_hours: "Sale Price (USD)",
    grant_amount_cents: "Grant Amount",
    attachment_urls: "Attachment URLs",
    inventory_mode: "Inventory",
    stock_remaining: "Stock Remaining",
    max_per_user: "Max per user",
    available_until: "Available Until",
    available: "Public Availability",
    coming_soon: "Coming Soon",
    requires_shipped_project: "Requires Shipped Project",
    pinned: "Pinned to top",
    extra_fruity: "Extra fruity (starfruit-gated)",
    priority_eligible: "Priority-payout eligible",
    category: "Category",
    modifiers: "Modifiers",
};

const selectedItemDetail = ref<ShopItemDetail | null>(null);
const loadingDetail = ref(false);
const detailError = ref("");
const saveError = ref("");
const saveSuccess = ref("");
const saving = ref(false);
const deleting = ref(false);
const deleteModal = ref(false);
const deleteError = ref("");
const imageUploading = ref(false);
const imageUploadError = ref("");

const { data: meData } = useFetch<{
    permissions: { canAccessShopAdmin: boolean };
}>("/api/internal/me", { server: false });
const canDelete = computed(
    () => meData.value?.permissions?.canAccessShopAdmin === true,
);

const form = ref<ShopItemForm>(createBlankForm());

const isCreatingNew = computed(() => props.mode === "create");
const selectedItem = computed(() => selectedItemDetail.value?.item ?? null);
const canSave = computed(() => isCreatingNew.value || selectedItem.value != null);

const previewImageUrl = computed(() => form.value.imageUrl.trim());
const previewAttachmentUrls = computed(() =>
    form.value.attachmentUrlsText
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
);
const previewAvailableUntilLabel = computed(() => {
    if (!form.value.availableUntil) return "None";

    const availableUntil = new Date(form.value.availableUntil);
    if (Number.isNaN(availableUntil.getTime())) return "Invalid date";

    return availableUntil.toLocaleString();
});

// free items need a cap, or one user could drain stock and rack up fulfilment tickets
const maxPerUserRequired = computed(() => {
    if (form.value.kind !== "physical" && form.value.kind !== "virtual_service") {
        return (form.value.priceUsd ?? 0) <= 0;
    }
    if ((form.value.priceUsd ?? 0) <= 0) return true;
    for (const entry of Object.values(form.value.regionalPricing)) {
        const trimmed = String(entry.priceUsd).trim();
        if (trimmed.length > 0 && Number(trimmed) === 0) return true;
    }
    return false;
});

function createBlankForm(): ShopItemForm {
    return {
        name: "",
        description: "",
        nameTranslations: { en: "", es: "" },
        descriptionTranslations: { en: "", es: "" },
        translationLocale: "en",
        imageUrl: "",
        kind: "physical",
        fulfillmentProvider: "internal",
        source: "hq",
        priceUsd: 1,
        salePriceUsd: null,
        grantAmountDollars: null,
        attachmentUrlsText: "",
        inventoryMode: "unlimited",
        stockRemaining: null,
        maxPerUser: null,
        availableUntil: "",
        available: true,
        comingSoon: false,
        requiresShippedProject: false,
        pinned: false,
        extraFruity: false,
        priorityEligible: false,
        category: "",
        regionalPricing: blankRegionalPricing(),
        modifiers: [],
    };
}

function blankModifier(): ModifierForm {
    return {
        id: "",
        label: "",
        type: "single",
        required: false,
        options: [blankModifierOption()],
        maxLength: 64,
        placeholder: "",
        priceDeltaUsd: 0,
    };
}

function blankModifierOption(): ModifierOptionForm {
    return { id: "", label: "", priceDeltaUsd: 0 };
}

function addModifier() {
    form.value.modifiers.push(blankModifier());
}

function removeModifier(index: number) {
    form.value.modifiers.splice(index, 1);
}

function moveModifier(index: number, delta: -1 | 1) {
    const next = index + delta;
    if (next < 0 || next >= form.value.modifiers.length) return;
    const list = form.value.modifiers;
    [list[index], list[next]] = [list[next]!, list[index]!];
}

function addModifierOption(modifierIndex: number) {
    form.value.modifiers[modifierIndex]?.options.push(blankModifierOption());
}

function removeModifierOption(modifierIndex: number, optionIndex: number) {
    const modifier = form.value.modifiers[modifierIndex];
    if (!modifier) return;
    if (modifier.options.length <= 1) return;
    modifier.options.splice(optionIndex, 1);
}

function formatDate(value: string | null) {
    return value ? new Date(value).toLocaleString() : "Unknown time";
}

function formatStatusTag(item: ShopItem) {
    if (!item.available) return "Archived";
    if (item.is_expired) return "Expired";
    if (item.is_sold_out) return "Sold Out";
    if (item.coming_soon) return "Coming Soon";
    return "Live";
}

function statusTagClass(item: ShopItem) {
    if (!item.available) return "border-zinc-700 text-zinc-400";
    if (item.is_expired) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    if (item.is_sold_out) return "border-red-500/30 bg-red-500/10 text-red-300";
    if (item.coming_soon) return "border-purple-500/30 bg-purple-500/10 text-purple-300";
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function providerLabel(provider: ShopItem["fulfillment_provider"] | ShopItemForm["fulfillmentProvider"]) {
    if (provider === "theseus") return "Theseus";
    if (provider === "hcb") return "HCB";
    if (provider === "internal_synthetic") return "Code-fulfilled";
    return "Internal";
}

function kindLabel(kind: ShopItem["kind"] | ShopItemForm["kind"]) {
    if (kind === "grant") return "Grant";
    if (kind === "consumable") return "Consumable";
    if (kind === "experience") return "Experience";
    if (kind === "virtual_service") return "Virtual Service";
    return "Physical";
}

function inventoryLabel(mode: ShopItem["inventory_mode"] | ShopItemForm["inventoryMode"]) {
    return mode === "limited" ? "Limited" : "Unlimited";
}

function isFulfillmentProvider(value: string): value is ShopItem["fulfillment_provider"] {
    return ["internal", "theseus", "hcb", "internal_synthetic"].includes(value);
}

function isShopItemKind(value: string): value is ShopItem["kind"] {
    return ["physical", "grant", "consumable", "experience", "virtual_service"].includes(value);
}

function isInventoryMode(value: string): value is ShopItem["inventory_mode"] {
    return ["unlimited", "limited"].includes(value);
}

function toDatetimeLocal(value: string | null) {
    if (!value) return "";

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";

    const pad = (part: number) => String(part).padStart(2, "0");

    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function populateForm(item: ShopItem) {
    const nameT = item.name_translations ?? {};
    const descT = item.description_translations ?? {};

    const regionalPricing = blankRegionalPricing();
    const rp = item.regional_pricing ?? null;
    if (rp) {
        for (const region of SHOP_REGIONS) {
            const entry = rp[region];
            if (!entry) continue;
            if (typeof entry.price_hours === "number") {
                regionalPricing[region].priceUsd = String(entry.price_hours);
            }
            if (typeof entry.available === "boolean") {
                regionalPricing[region].available = entry.available;
            }
            if (typeof entry.store_url === "string") {
                regionalPricing[region].storeUrl = entry.store_url;
            }
        }
    }

    const formModifiers: ModifierForm[] = (Array.isArray(item.modifiers) ? item.modifiers : []).map((mod) => ({
        id: mod.id,
        label: mod.label,
        type: mod.type,
        required: mod.required === true,
        options: (mod.options ?? []).map((opt) => ({
            id: opt.id,
            label: opt.label,
            // hours and usd share a unit (1 hour = $1)
            priceDeltaUsd: opt.price_delta_hours ?? 0,
        })),
        maxLength: mod.max_length ?? 64,
        placeholder: mod.placeholder ?? "",
        priceDeltaUsd: mod.price_delta_hours ?? 0,
    }));

    form.value = {
        name: item.name,
        description: item.description ?? "",
        nameTranslations: {
            en: "",
            es: typeof nameT.es === "string" && nameT.es.trim().length > 0 ? (nameT.es as string) : "",
        },
        descriptionTranslations: {
            en: "",
            es: typeof descT.es === "string" && descT.es.trim().length > 0 ? (descT.es as string) : "",
        },
        translationLocale: "en",
        imageUrl: item.image_url ?? "",
        kind: item.kind,
        fulfillmentProvider: item.fulfillment_provider,
        source: item.source ?? "hq",
        priceUsd: (item.regular_price_gold ?? item.price_gold) / GOLD_PER_HOUR,
        salePriceUsd:
            item.sale_price_hours != null ? item.sale_price_hours : null,
        grantAmountDollars:
            item.grant_amount_cents != null
                ? item.grant_amount_cents / 100
                : null,
        attachmentUrlsText: item.attachment_urls.join("\n"),
        inventoryMode: item.inventory_mode,
        stockRemaining: item.stock_remaining ?? null,
        maxPerUser: item.max_per_user ?? null,
        availableUntil: toDatetimeLocal(item.available_until),
        available: item.available,
        comingSoon: item.coming_soon ?? false,
        requiresShippedProject: item.requires_shipped_project ?? false,
        pinned: item.pinned ?? false,
        extraFruity: item.extra_fruity ?? false,
        priorityEligible: item.priority_eligible ?? false,
        category: isShopItemCategory(item.category) ? item.category : "",
        regionalPricing,
        modifiers: formModifiers,
    };
}

function resetForCreateMode() {
    selectedItemDetail.value = null;
    detailError.value = "";
    saveError.value = "";
    saveSuccess.value = "";
    form.value = createBlankForm();
}

function extractStatusMessage(error: unknown, fallbackMessage: string) {
    if (
        typeof error === "object" &&
        error &&
        "data" in error &&
        typeof error.data === "object" &&
        error.data &&
        "statusMessage" in error.data &&
        typeof error.data.statusMessage === "string"
    ) {
        return error.data.statusMessage;
    }

    return fallbackMessage;
}

const prefillingTranslation = ref(false);

async function loadItem(id: number) {
    loadingDetail.value = true;
    detailError.value = "";
    saveError.value = "";
    saveSuccess.value = "";

    try {
        const detail = await $fetch<ShopItemDetail>(`/api/internal/shop/items/${id}`);
        selectedItemDetail.value = detail;
        populateForm(detail.item);
        // failures are ignored: the admin can still type the translation
        void prefillAiTranslation(detail.item);
    } catch (error) {
        console.error(error);
        detailError.value = extractStatusMessage(error, "Failed to load item details");
        selectedItemDetail.value = null;
    } finally {
        loadingDetail.value = false;
    }
}

async function prefillAiTranslation(item: ShopItem) {
    const needName = !form.value.nameTranslations.es;
    const needDesc = !form.value.descriptionTranslations.es;
    if (!needName && !needDesc) return;

    prefillingTranslation.value = true;
    try {
        const res = await $fetch<{ name: string; description: string }>(
            `/api/internal/shop/items/${item.id}/translation`,
            { query: { locale: "es" } },
        );
        // don't clobber what the admin typed while waiting
        if (needName && !form.value.nameTranslations.es) {
            form.value.nameTranslations.es = res.name ?? "";
        }
        if (needDesc && !form.value.descriptionTranslations.es) {
            form.value.descriptionTranslations.es = res.description ?? "";
        }
    } catch (error) {
        console.error("AI translation prefill failed", error);
    } finally {
        prefillingTranslation.value = false;
    }
}

watch(
    () => form.value.kind,
    (kind) => {
        if (kind === "grant") {
            form.value.fulfillmentProvider = "hcb";
        } else if (kind === "virtual_service") {
            form.value.fulfillmentProvider = "internal";
            form.value.grantAmountDollars = null;
        } else {
            if (form.value.fulfillmentProvider === "hcb") {
                form.value.fulfillmentProvider = "internal";
                form.value.grantAmountDollars = null;
            }
            if (form.value.source !== "hq" && form.value.source !== "local") {
                form.value.source = "hq";
            }
        }
    },
);

watch(
    () => form.value.inventoryMode,
    (mode) => {
        if (mode === "unlimited") {
            form.value.stockRemaining = null;
        } else if (form.value.stockRemaining == null) {
            form.value.stockRemaining = 0;
        }
    },
);

watch(
    [() => isCreatingNew.value, () => props.itemId],
    ([creatingNew, itemId]) => {
        if (creatingNew) {
            resetForCreateMode();
            return;
        }

        if (!itemId || itemId <= 0) {
            selectedItemDetail.value = null;
            detailError.value = "Invalid item ID";
            saveError.value = "";
            saveSuccess.value = "";
            return;
        }

        void loadItem(itemId);
    },
    { immediate: true },
);

async function uploadImageFile(file: File) {
    imageUploading.value = true;
    imageUploadError.value = "";

    try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await $fetch<{ url?: string; file?: string }>("/api/upload-image", {
            method: "POST",
            body: formData,
        });
        const url = res.url || res.file || "";
        if (!url) throw new Error("Upload returned no URL");
        form.value.imageUrl = url;
    } catch (error) {
        console.error(error);
        imageUploadError.value = extractStatusMessage(error, "Image upload failed");
    } finally {
        imageUploading.value = false;
    }
}

function onImagePaste(e: ClipboardEvent) {
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

async function saveItem() {
    if (!canSave.value) return;

    saving.value = true;
    saveError.value = "";
    saveSuccess.value = "";

    const attachmentUrls = previewAttachmentUrls.value;

    // drop empty translations so the db stores null instead of {}
    const pickedNameT: Record<string, string> = {};
    const pickedDescT: Record<string, string> = {};
    for (const locale of SUPPORTED_LOCALES) {
        if (locale === "en") continue;
        const n = form.value.nameTranslations[locale].trim();
        const d = form.value.descriptionTranslations[locale].trim();
        if (n) pickedNameT[locale] = n;
        if (d) pickedDescT[locale] = d;
    }

    // default-only keys are dropped so the server stores null; non-physical
    // items skip this since the server ignores their regional pricing
    const regionalPricingPayload: Record<
        string,
        { priceGold?: number; available?: boolean; storeUrl?: string }
    > = {};
    if (form.value.kind === "physical") {
        for (const region of SHOP_REGIONS) {
            const entry = form.value.regionalPricing[region];
            const trimmed = String(entry.priceUsd).trim();
            const hasPrice = trimmed.length > 0;
            const priceUsd = hasPrice ? Number(trimmed) : null;
            const unavailable = entry.available === false;
            const storeUrl = entry.storeUrl.trim();
            if (!hasPrice && !unavailable && !storeUrl) continue;

            if (hasPrice && !storeUrl) {
                saveError.value = `Region ${region}: please add the store URL you based the price on.`;
                saving.value = false;
                return;
            }

            const payloadEntry: { priceGold?: number; available?: boolean; storeUrl?: string } = {};
            if (hasPrice && priceUsd != null && Number.isFinite(priceUsd)) {
                payloadEntry.priceGold = Math.round(priceUsd * GOLD_PER_HOUR);
            }
            if (unavailable) {
                payloadEntry.available = false;
            }
            if (storeUrl) {
                payloadEntry.storeUrl = storeUrl;
            }
            regionalPricingPayload[region] = payloadEntry;
        }
    }

    const modifierIdRegex = /^[a-z0-9_-]{1,64}$/;
    const modifiersPayload: Array<{
        id: string;
        label: string;
        type: "single" | "multi" | "text";
        required: boolean;
        options?: Array<{ id: string; label: string; priceDeltaGold: number }>;
        maxLength?: number;
        placeholder?: string;
        priceDeltaGold?: number;
    }> = [];
    const seenModifierIds = new Set<string>();
    for (const modifier of form.value.modifiers) {
        const trimmedId = modifier.id.trim();
        const trimmedLabel = modifier.label.trim();
        if (!trimmedId && !trimmedLabel && modifier.options.every((o) => !o.id.trim() && !o.label.trim())) {
            continue;
        }
        if (!modifierIdRegex.test(trimmedId)) {
            saveError.value = `Modifier id "${trimmedId}" must be lowercase letters, digits, dash or underscore.`;
            saving.value = false;
            return;
        }
        if (seenModifierIds.has(trimmedId)) {
            saveError.value = `Duplicate modifier id "${trimmedId}".`;
            saving.value = false;
            return;
        }
        seenModifierIds.add(trimmedId);
        if (!trimmedLabel) {
            saveError.value = `Modifier "${trimmedId}" needs a label.`;
            saving.value = false;
            return;
        }
        if (modifier.type === "text") {
            const maxLength = Number(modifier.maxLength ?? 64);
            if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 200) {
                saveError.value = `Modifier "${trimmedId}" max length must be a whole number between 1 and 200.`;
                saving.value = false;
                return;
            }
            const deltaUsd = Number(modifier.priceDeltaUsd ?? 0);
            if (!Number.isInteger(deltaUsd)) {
                saveError.value = `Modifier "${trimmedId}" delta must be a whole-dollar USD amount.`;
                saving.value = false;
                return;
            }
            modifiersPayload.push({
                id: trimmedId,
                label: trimmedLabel,
                type: "text",
                required: modifier.required === true,
                maxLength,
                placeholder: modifier.placeholder.trim() || undefined,
                priceDeltaGold: deltaUsd * GOLD_PER_HOUR,
            });
            continue;
        }
        if (modifier.options.length === 0) {
            saveError.value = `Modifier "${trimmedId}" needs at least one option.`;
            saving.value = false;
            return;
        }
        const seenOptionIds = new Set<string>();
        const optionsPayload: Array<{ id: string; label: string; priceDeltaGold: number }> = [];
        for (const option of modifier.options) {
            const optId = option.id.trim();
            const optLabel = option.label.trim();
            if (!modifierIdRegex.test(optId)) {
                saveError.value = `Option id "${optId}" in "${trimmedId}" must be lowercase letters, digits, dash or underscore.`;
                saving.value = false;
                return;
            }
            if (seenOptionIds.has(optId)) {
                saveError.value = `Duplicate option id "${optId}" in "${trimmedId}".`;
                saving.value = false;
                return;
            }
            seenOptionIds.add(optId);
            if (!optLabel) {
                saveError.value = `Option "${optId}" needs a label.`;
                saving.value = false;
                return;
            }
            const deltaUsd = Number(option.priceDeltaUsd ?? 0);
            if (!Number.isInteger(deltaUsd)) {
                saveError.value = `Option "${optId}" delta must be a whole-dollar USD amount.`;
                saving.value = false;
                return;
            }
            // the server requires a multiple of 10 gold, which usd * GOLD_PER_HOUR always is
            optionsPayload.push({ id: optId, label: optLabel, priceDeltaGold: deltaUsd * GOLD_PER_HOUR });
        }
        modifiersPayload.push({
            id: trimmedId,
            label: trimmedLabel,
            type: modifier.type,
            required: modifier.type === "single" ? modifier.required === true : false,
            options: optionsPayload,
        });
    }

    const body = {
        name: form.value.name,
        description: form.value.description || null,
        nameTranslations: Object.keys(pickedNameT).length > 0 ? pickedNameT : null,
        descriptionTranslations: Object.keys(pickedDescT).length > 0 ? pickedDescT : null,
        imageUrl: form.value.imageUrl || null,
        kind: form.value.kind,
        fulfillmentProvider: form.value.fulfillmentProvider,
        source: form.value.kind === "physical" ? form.value.source : null,
        priceGold: Math.round(form.value.priceUsd * GOLD_PER_HOUR),
        salePriceGold:
            form.value.salePriceUsd != null
                ? Math.round(form.value.salePriceUsd * GOLD_PER_HOUR)
                : null,
        grantAmountDollars:
            form.value.kind === "grant"
                ? form.value.grantAmountDollars
                : null,
        attachmentUrls,
        inventoryMode: form.value.inventoryMode,
        stockRemaining:
            form.value.inventoryMode === "limited"
                ? form.value.stockRemaining
                : null,
        maxPerUser:
            form.value.maxPerUser != null && Number.isFinite(form.value.maxPerUser) && form.value.maxPerUser > 0
                ? Math.floor(form.value.maxPerUser)
                : null,
        availableUntil: form.value.availableUntil
            ? new Date(form.value.availableUntil).toISOString()
            : null,
        available: form.value.available,
        comingSoon: form.value.comingSoon,
        requiresShippedProject: form.value.requiresShippedProject,
        pinned: form.value.pinned,
        extraFruity: form.value.extraFruity,
        priorityEligible: form.value.priorityEligible,
        category: form.value.category || null,
        regionalPricing:
            Object.keys(regionalPricingPayload).length > 0
                ? regionalPricingPayload
                : null,
        modifiers: modifiersPayload.length > 0 ? modifiersPayload : null,
    };

    try {
        const savedItem = await $fetch<ShopItem>(
            isCreatingNew.value
                ? "/api/internal/shop/items"
                : `/api/internal/shop/items/${props.itemId}`,
            {
                method: isCreatingNew.value ? "POST" : "PATCH",
                body,
            },
        );

        if (isCreatingNew.value) {
            await navigateTo(`/internal/shop/${savedItem.id}`);
            return;
        }

        await loadItem(savedItem.id);
        saveSuccess.value = "Shop item updated. The change is queued and will be announced to Slack when published from the shop config page.";
    } catch (error) {
        console.error(error);
        saveError.value = extractStatusMessage(error, "Failed to save shop item");
    } finally {
        saving.value = false;
    }
}

function resetForm() {
    saveError.value = "";
    saveSuccess.value = "";

    if (isCreatingNew.value) {
        form.value = createBlankForm();
        return;
    }

    if (selectedItem.value) {
        populateForm(selectedItem.value);
    }
}

function openDeleteModal() {
    if (!selectedItem.value || props.itemId == null) return;
    deleteError.value = "";
    deleteModal.value = true;
}

async function confirmDeleteItem() {
    if (!selectedItem.value || props.itemId == null) return;

    deleting.value = true;
    deleteError.value = "";
    saveError.value = "";
    saveSuccess.value = "";

    try {
        await $fetch(`/api/internal/shop/items/${props.itemId}`, {
            method: "DELETE",
        });
        deleteModal.value = false;
        await refreshNuxtData();
        await navigateTo("/internal/shop");
    } catch (error) {
        deleteError.value = extractStatusMessage(error, "Failed to delete shop item");
    } finally {
        deleting.value = false;
    }
}

function formatAuditTitle(entry: ShopAuditEntry) {
    return entry.public_message ?? entry.change_summary ?? entry.action.replaceAll("_", " ");
}

function changedFields(entry: ShopAuditEntry) {
    const oldValue = entry.old_value ?? {};
    const newValue = entry.new_value ?? {};
    const ignoredFields = new Set(["created_at", "updated_at"]);

    return [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].filter((key) => {
        if (ignoredFields.has(key)) return false;
        return JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]);
    });
}

function formatFieldLabel(field: string) {
    return auditFieldLabels[field] ?? field.replaceAll("_", " ");
}

function formatFieldValue(field: string, value: unknown) {
    if (value == null || value === "") return "Empty";

    if (field === "price_hours" && typeof value === "number") {
        return `$${value.toFixed(2)} (${value * GOLD_PER_HOUR} gold)`;
    }

    if (field === "grant_amount_cents" && typeof value === "number") {
        return `$${(value / 100).toFixed(2)}`;
    }

    if (field === "fulfillment_provider" && typeof value === "string" && isFulfillmentProvider(value)) {
        return providerLabel(value);
    }

    if (field === "kind" && typeof value === "string" && isShopItemKind(value)) {
        return kindLabel(value);
    }

    if (field === "inventory_mode" && typeof value === "string" && isInventoryMode(value)) {
        return inventoryLabel(value);
    }

    if (field === "available" && typeof value === "boolean") {
        return value ? "Visible" : "Hidden";
    }

    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(", ") : "Empty";
    }

    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }

    if (
        typeof value === "string" &&
        (field.endsWith("_at") || /^\d{4}-\d{2}-\d{2}T/.test(value))
    ) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleString();
        }
    }

    if (typeof value === "object") {
        return JSON.stringify(value);
    }

    return String(value);
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-6xl mx-auto flex flex-col gap-6">
            <div class="flex flex-col gap-3">
                <NuxtLink
                    to="/internal/shop"
                    class="text-xs uppercase tracking-widest text-zinc-500 font-bold hover:text-white transition-colors"
                >
                    Back to Shop Gallery
                </NuxtLink>

                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                            {{ isCreatingNew ? "Create Item" : "Edit Item" }}
                        </p>
                        <h1 class="text-3xl font-bold text-white tracking-tight">
                            {{ isCreatingNew ? "New shop item" : (selectedItem?.name ?? "Loading...") }}
                        </h1>
                        <p class="text-sm text-zinc-400">
                            {{ isCreatingNew
                                ? "Create a new shop item, then route back to its dedicated page."
                                : "Update item metadata, inventory, fulfillment routing, and audit history." }}
                        </p>
                    </div>

                    <span
                        v-if="selectedItem"
                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border shrink-0"
                        :class="statusTagClass(selectedItem)"
                    >
                        {{ formatStatusTag(selectedItem) }}
                    </span>
                </div>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
                <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-5">
                    <p v-if="detailError" class="text-sm text-red-300">{{ detailError }}</p>
                    <p v-if="saveError" class="text-sm text-red-300">{{ saveError }}</p>
                    <p v-if="saveSuccess" class="text-sm text-emerald-300">{{ saveSuccess }}</p>
                    <p v-if="loadingDetail" class="text-sm text-zinc-500">Loading item details...</p>

                    <div
                        v-if="selectedItem?.slug"
                        class="border border-sky-500/30 bg-sky-500/10 text-sky-200 px-3 py-2 text-xs flex items-center justify-between gap-3 flex-wrap"
                    >
                        <div>
                            <span class="uppercase tracking-widest font-bold">System slug:</span>
                            <code class="ml-2 font-mono">{{ selectedItem.slug }}</code>
                        </div>
                        <span class="text-sky-300/70">
                            Referenced by code. Renaming the slug or deleting the row may break fulfillment.
                        </span>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Name</span>
                            <input
                                v-model="form.name"
                                type="text"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                                placeholder="Sticker pack"
                            >
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Image URL</span>
                            <input
                                v-model="form.imageUrl"
                                type="url"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                                placeholder="https://cdn.hackclub.com/... or paste an image"
                                @paste="onImagePaste"
                            >
                            <span v-if="imageUploading" class="text-xs text-zinc-500">Uploading image...</span>
                            <span v-else-if="imageUploadError" class="text-xs text-red-300">{{ imageUploadError }}</span>
                            <span v-else class="text-xs text-zinc-600">Tip: paste a screenshot or image from your clipboard to upload directly.</span>
                        </label>

                        <div class="flex flex-col gap-2 lg:col-span-2">
                            <div class="flex items-center justify-between gap-3 flex-wrap">
                                <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Description</span>
                                <label class="flex items-center gap-2 text-xs text-zinc-400">
                                    <span class="uppercase tracking-widest font-bold text-zinc-500">Language</span>
                                    <select
                                        v-model="form.translationLocale"
                                        class="bg-black/30 border border-zinc-800 px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-400"
                                    >
                                        <option value="en">{{ LOCALE_LABELS.en }}</option>
                                        <option value="es">{{ LOCALE_LABELS.es }}</option>
                                    </select>
                                </label>
                            </div>

                            <label
                                v-if="form.translationLocale !== 'en'"
                                class="flex flex-col gap-1"
                            >
                                <span class="text-[10px] uppercase tracking-widest text-zinc-600">
                                    Name override ({{ LOCALE_LABELS[form.translationLocale] }})
                                </span>
                                <input
                                    v-model="form.nameTranslations[form.translationLocale]"
                                    type="text"
                                    class="bg-black/30 border border-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                                    :placeholder="form.name || 'Leave empty to auto-translate from English'"
                                >
                            </label>

                            <textarea
                                v-if="form.translationLocale === 'en'"
                                v-model="form.description"
                                rows="4"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                                placeholder="Describe the reward and what the buyer receives."
                            />
                            <textarea
                                v-else
                                v-model="form.descriptionTranslations[form.translationLocale]"
                                rows="4"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                                :placeholder="form.description || 'Leave empty to auto-translate from English'"
                            />

                            <p
                                v-if="form.translationLocale !== 'en'"
                                class="text-[10px] text-zinc-600"
                            >
                                Leave a field empty to let the AI translate it from the English source.
                            </p>
                        </div>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Kind</span>
                            <select
                                v-model="form.kind"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400 disabled:opacity-60"
                                :disabled="selectedItem?.fulfillment_provider === 'internal_synthetic'"
                            >
                                <option value="physical">Physical</option>
                                <option value="grant">Grant</option>
                                <option value="consumable">Consumable</option>
                                <option value="experience">Experience</option>
                                <option value="virtual_service">Virtual Service</option>
                            </select>
                        </label>

                        <p
                            v-if="form.kind === 'virtual_service'"
                            class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                        >
                            <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                            <span>
                                Virtual Service auto-activates the moment it is purchased (the order is
                                immediately marked "Service Activated") and issues nothing real. Never use it
                                for money grants or store credit, those must use <strong>Grant</strong> so a real
                                HCB grant is created and sent by staff.
                            </span>
                        </p>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Fulfillment</span>
                            <select
                                v-model="form.fulfillmentProvider"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400 disabled:opacity-60"
                                :disabled="selectedItem?.fulfillment_provider === 'internal_synthetic'"
                            >
                                <option v-if="form.kind === 'physical'" value="internal">Internal</option>
                                <option v-if="form.kind === 'physical'" value="theseus">Theseus</option>
                                <option v-if="form.kind === 'grant'" value="hcb">HCB</option>
                                <option v-if="form.kind === 'virtual_service'" value="internal">Internal (auto-activated)</option>
                                <option
                                    v-if="selectedItem?.fulfillment_provider === 'internal_synthetic'"
                                    value="internal_synthetic"
                                >
                                    Code-fulfilled
                                </option>
                            </select>
                        </label>

                        <label v-if="form.kind === 'physical'" class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Source</span>
                            <select
                                v-model="form.source"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                            >
                                <option value="hq">Hack Club HQ</option>
                                <option value="local">Local merchant (Amazon, etc.)</option>
                            </select>
                            <span class="text-[10px] text-zinc-500 leading-snug">
                                Shown as a small line on the public shop card so shoppers know if it ships from HQ or a local merchant.
                            </span>
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Category</span>
                            <select
                                v-model="form.category"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                            >
                                <option value="">Uncategorized</option>
                                <option v-for="cat in SHOP_ITEM_CATEGORIES" :key="cat" :value="cat">{{ SHOP_ITEM_CATEGORY_LABELS[cat] }}</option>
                            </select>
                            <span class="text-[10px] text-zinc-500 leading-snug">
                                Used for the browse filters on the public shop. Optional.
                            </span>
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Price (USD)</span>
                            <input
                                :value="form.priceUsd"
                                type="number"
                                min="0"
                                step="0.01"
                                inputmode="decimal"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                                @input="(e) => {
                                    const raw = (e.target as HTMLInputElement).value;
                                    const parsed = parseFloat(raw);
                                    form.priceUsd = Number.isFinite(parsed) ? parsed : 0;
                                }"
                            >
                            <span class="text-xs text-zinc-500">= {{ Math.round(form.priceUsd * GOLD_PER_HOUR) }} gold (10 gold = $1). Set to 0 for a free item, a <b>Max per user</b> cap is required when free.</span>
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Sale Price (USD)</span>
                            <input
                                :value="form.salePriceUsd ?? ''"
                                type="number"
                                min="0"
                                step="0.01"
                                inputmode="decimal"
                                placeholder="Leave blank for no sale"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400 placeholder:text-zinc-600"
                                @input="(e) => {
                                    const raw = (e.target as HTMLInputElement).value.trim();
                                    if (raw === '') { form.salePriceUsd = null; return; }
                                    const parsed = parseFloat(raw);
                                    form.salePriceUsd = Number.isFinite(parsed) ? parsed : null;
                                }"
                            >
                            <span class="text-xs text-zinc-500">
                                <template v-if="form.salePriceUsd != null && form.salePriceUsd < form.priceUsd">
                                    On sale: <b>{{ Math.round(form.salePriceUsd * GOLD_PER_HOUR) }} gold</b> (was {{ Math.round(form.priceUsd * GOLD_PER_HOUR) }}). Must be below the regular price. For grant items also lower the Grant Amount to match.
                                </template>
                                <template v-else-if="form.salePriceUsd != null">
                                    Must be below the regular price ({{ Math.round(form.priceUsd * GOLD_PER_HOUR) }} gold) to count as a sale.
                                </template>
                                <template v-else>
                                    Blank = not on sale. When set below the regular price, the shop shows it struck through with an "On Sale" badge.
                                </template>
                            </span>
                        </label>

                        <label v-if="form.kind === 'grant'" class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Grant Amount (USD)</span>
                            <input
                                v-model.number="form.grantAmountDollars"
                                type="number"
                                min="1"
                                step="0.01"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                            >
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Inventory</span>
                            <select
                                v-model="form.inventoryMode"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                            >
                                <option value="unlimited">Unlimited</option>
                                <option value="limited">Limited</option>
                            </select>
                        </label>

                        <label v-if="form.inventoryMode === 'limited'" class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Stock Remaining</span>
                            <input
                                v-model.number="form.stockRemaining"
                                type="number"
                                min="0"
                                step="1"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                            >
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                Max per user
                                <span v-if="maxPerUserRequired" class="ml-1 text-red-400">*</span>
                            </span>
                            <input
                                v-model.number="form.maxPerUser"
                                type="number"
                                min="1"
                                step="1"
                                :required="maxPerUserRequired"
                                :placeholder="maxPerUserRequired ? 'Required when price is 0' : 'Leave blank for no limit'"
                                class="bg-black/30 border px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400 placeholder:text-zinc-600"
                                :class="maxPerUserRequired && (form.maxPerUser == null || form.maxPerUser <= 0) ? 'border-red-500/60' : 'border-zinc-800'"
                            >
                            <span class="text-[10px] text-zinc-500 leading-snug">
                                Hard cap across pending + fulfilled orders per person. Failed fulfillments (external_failure) don't count. Required when the item is free.
                            </span>
                        </label>

                        <label class="flex flex-col gap-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Available Until</span>
                            <input
                                v-model="form.availableUntil"
                                type="datetime-local"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                            >
                            <span class="text-[10px] text-zinc-500 leading-snug">
                                After this time the item is delisted/hidden from the shop. This does not change the price; use Sale Price for a discount.
                            </span>
                        </label>

                        <label class="flex items-center gap-3 border border-zinc-800 bg-black/20 px-3 py-3">
                            <input
                                v-model="form.available"
                                type="checkbox"
                                class="w-4 h-4 rounded border-zinc-700 bg-zinc-950"
                            >
                            <span class="text-sm text-zinc-200">Available in the public shop</span>
                        </label>

                        <label class="flex items-center gap-3 border border-zinc-800 bg-black/20 px-3 py-3">
                            <input
                                v-model="form.comingSoon"
                                type="checkbox"
                                class="w-4 h-4 rounded border-zinc-700 bg-zinc-950"
                            >
                            <span class="text-sm text-zinc-200">Coming soon (visible but not purchasable)</span>
                        </label>

                        <label class="flex items-center gap-3 border border-zinc-800 bg-black/20 px-3 py-3">
                            <input
                                v-model="form.requiresShippedProject"
                                type="checkbox"
                                class="w-4 h-4 rounded border-zinc-700 bg-zinc-950"
                            >
                            <span class="text-sm text-zinc-200">Requires a shipped project to purchase</span>
                        </label>

                        <label class="flex items-center gap-3 border border-zinc-800 bg-black/20 px-3 py-3">
                            <input
                                v-model="form.pinned"
                                type="checkbox"
                                class="w-4 h-4 rounded border-zinc-700 bg-zinc-950"
                            >
                            <span class="text-sm text-zinc-200">
                                Pin to top of shop (ignores filters and sort)
                            </span>
                        </label>

                        <label class="flex items-start gap-3 border border-zinc-800 bg-black/20 px-3 py-3">
                            <input
                                v-model="form.extraFruity"
                                type="checkbox"
                                class="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-zinc-950 accent-amber-400"
                            >
                            <div class="flex flex-col">
                                <span class="text-sm text-zinc-200 font-bold">Extra fruity (starfruit-gated)</span>
                                <span class="text-[11px] text-zinc-500">
                                    Users must spend 1 starfruit to unlock this item before they can buy it. Unlock is one-time per user.
                                </span>
                            </div>
                        </label>

                        <label class="flex items-start gap-3 border border-zinc-800 bg-black/20 px-3 py-3">
                            <input
                                v-model="form.priorityEligible"
                                type="checkbox"
                                class="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-zinc-950 accent-amber-400"
                            >
                            <div class="flex flex-col">
                                <span class="text-sm text-zinc-200 font-bold">Priority-payout eligible</span>
                                <span class="text-[11px] text-zinc-500">
                                    Gold earned from priority ARI reviews (event attendees) can only be spent on items with this checked. Doesn't restrict who can buy it — regular gold buys it like anything else.
                                </span>
                            </div>
                        </label>

                        <label class="flex flex-col gap-2 lg:col-span-2">
                            <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Attachment URLs</span>
                            <textarea
                                v-model="form.attachmentUrlsText"
                                rows="5"
                                class="bg-black/30 border border-zinc-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400 font-mono"
                                placeholder="One URL per line"
                            />
                        </label>

                        <div
                            v-if="form.kind === 'physical' || form.kind === 'virtual_service'"
                            class="lg:col-span-2 flex flex-col gap-3 border border-zinc-800 bg-black/20 p-4"
                        >
                            <div class="flex flex-col gap-1">
                                <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Modifiers (variants)</span>
                                <span class="text-xs text-zinc-500">
                                    Single-select shows radio chips, multi-select shows checkboxes. Price deltas stack on top of the base price and apply per unit. Use lowercase slugs for ids (e.g. "color" / "red").
                                </span>
                            </div>

                            <div
                                v-if="form.modifiers.length === 0"
                                class="text-xs text-zinc-500 italic"
                            >
                                No modifiers configured. Click "Add modifier" to offer a variant picker on the buy page.
                            </div>

                            <div
                                v-for="(modifier, modifierIndex) in form.modifiers"
                                :key="`mod-${modifierIndex}`"
                                class="flex flex-col gap-3 border border-zinc-700/60 bg-black/30 p-3"
                            >
                                <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] gap-2 items-start">
                                    <label class="flex flex-col gap-1">
                                        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Id</span>
                                        <input
                                            v-model="modifier.id"
                                            type="text"
                                            placeholder="color"
                                            class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                        >
                                    </label>
                                    <label class="flex flex-col gap-1">
                                        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Label</span>
                                        <input
                                            v-model="modifier.label"
                                            type="text"
                                            placeholder="Color"
                                            class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                        >
                                    </label>
                                    <label class="flex flex-col gap-1">
                                        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Type</span>
                                        <select
                                            v-model="modifier.type"
                                            class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                        >
                                            <option value="single">Single (pick one)</option>
                                            <option value="multi">Multi (pick any)</option>
                                            <option value="text">Text (free entry)</option>
                                        </select>
                                    </label>
                                    <label
                                        class="flex items-center gap-2 text-xs text-zinc-300 self-end h-[34px] px-2 border border-zinc-800 bg-black/20"
                                        :class="modifier.type === 'multi' ? 'opacity-40 pointer-events-none' : ''"
                                    >
                                        <input
                                            v-model="modifier.required"
                                            :disabled="modifier.type === 'multi'"
                                            type="checkbox"
                                            class="w-3 h-3 rounded border-zinc-700 bg-zinc-950"
                                        >
                                        Required
                                    </label>
                                    <div class="flex flex-col gap-1 self-end">
                                        <button
                                            type="button"
                                            class="px-2 py-1 text-[10px] font-bold border border-zinc-700 text-zinc-400 hover:text-white hover:border-white"
                                            :disabled="modifierIndex === 0"
                                            :class="modifierIndex === 0 ? 'opacity-30 cursor-not-allowed' : ''"
                                            @click="moveModifier(modifierIndex, -1)"
                                        >
                                            ↑
                                        </button>
                                        <button
                                            type="button"
                                            class="px-2 py-1 text-[10px] font-bold border border-zinc-700 text-zinc-400 hover:text-white hover:border-white"
                                            :disabled="modifierIndex === form.modifiers.length - 1"
                                            :class="modifierIndex === form.modifiers.length - 1 ? 'opacity-30 cursor-not-allowed' : ''"
                                            @click="moveModifier(modifierIndex, 1)"
                                        >
                                            ↓
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        class="px-2 py-1 text-[10px] font-bold border border-red-500/40 text-red-300 hover:bg-red-500/20 self-end"
                                        @click="removeModifier(modifierIndex)"
                                    >
                                        Delete
                                    </button>
                                </div>

                                <div
                                    v-if="modifier.type === 'text'"
                                    class="flex flex-col gap-2 pl-2 border-l-2 border-zinc-800"
                                >
                                    <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Text entry</p>
                                    <p class="text-[11px] text-zinc-500">
                                        Buyer types free text (e.g. engraving). Fulfillers see it verbatim on the order. One value applies to every unit in the order.
                                    </p>
                                    <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_minmax(0,140px)] gap-2 items-end">
                                        <label class="flex flex-col gap-1">
                                            <span class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Max length</span>
                                            <input
                                                v-model.number="modifier.maxLength"
                                                type="number"
                                                min="1"
                                                max="200"
                                                step="1"
                                                class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                            >
                                        </label>
                                        <label class="flex flex-col gap-1">
                                            <span class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Placeholder</span>
                                            <input
                                                v-model="modifier.placeholder"
                                                type="text"
                                                placeholder="Optional engraving (max 25 chars)"
                                                class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                            >
                                        </label>
                                        <label class="flex flex-col gap-1">
                                            <span class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Delta (USD)</span>
                                            <input
                                                v-model.number="modifier.priceDeltaUsd"
                                                type="number"
                                                step="1"
                                                placeholder="0"
                                                class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                            >
                                        </label>
                                    </div>
                                </div>

                                <div v-else class="flex flex-col gap-2 pl-2 border-l-2 border-zinc-800">
                                    <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Options</p>
                                    <div
                                        v-for="(option, optionIndex) in modifier.options"
                                        :key="`opt-${modifierIndex}-${optionIndex}`"
                                        class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,140px)_auto] gap-2 items-end"
                                    >
                                        <label class="flex flex-col gap-1">
                                            <span class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Option id</span>
                                            <input
                                                v-model="option.id"
                                                type="text"
                                                placeholder="red"
                                                class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                            >
                                        </label>
                                        <label class="flex flex-col gap-1">
                                            <span class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Option label</span>
                                            <input
                                                v-model="option.label"
                                                type="text"
                                                placeholder="Red"
                                                class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                            >
                                        </label>
                                        <label class="flex flex-col gap-1">
                                            <span class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Delta (USD)</span>
                                            <input
                                                v-model.number="option.priceDeltaUsd"
                                                type="number"
                                                step="1"
                                                placeholder="0"
                                                class="bg-black/40 border border-zinc-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                                            >
                                        </label>
                                        <button
                                            type="button"
                                            class="px-2 py-1.5 text-[10px] font-bold border border-zinc-700 text-zinc-300 hover:text-white hover:border-red-400 disabled:opacity-30"
                                            :disabled="modifier.options.length <= 1"
                                            @click="removeModifierOption(modifierIndex, optionIndex)"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        class="self-start px-2 py-1 text-[10px] font-bold border border-zinc-700 text-zinc-300 hover:text-white hover:border-amber-400"
                                        @click="addModifierOption(modifierIndex)"
                                    >
                                        + Add option
                                    </button>
                                </div>
                            </div>

                            <button
                                type="button"
                                class="self-start px-3 py-1.5 text-xs font-bold border border-amber-400 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                                @click="addModifier"
                            >
                                + Add modifier
                            </button>
                        </div>

                        <div
                            v-if="form.kind === 'physical'"
                            class="lg:col-span-2 flex flex-col gap-3 border border-zinc-800 bg-black/20 p-4"
                        >
                            <div class="flex flex-col gap-1">
                                <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Regional pricing & availability</span>
                                <span class="text-xs text-zinc-500">
                                    Leave a row empty and checked to use the base price in that region. Set a different USD price to override, in which case you must paste the store URL (e.g. the Amazon listing) you based the price on. Uncheck "Available" to block purchases from that region.
                                </span>
                            </div>
                            <div class="flex flex-col gap-2">
                                <div
                                    v-for="region in SHOP_REGIONS"
                                    :key="region"
                                    class="grid grid-cols-[minmax(0,120px)_minmax(0,120px)_minmax(0,1fr)_auto] gap-3 items-center text-sm"
                                >
                                    <span class="text-zinc-300">
                                        <span class="text-xs font-bold uppercase tracking-widest text-zinc-500 mr-2">{{ region }}</span>
                                        <span class="text-xs">{{ REGION_LABELS[region] }}</span>
                                    </span>
                                    <input
                                        v-model="form.regionalPricing[region].priceUsd"
                                        type="number"
                                        min="0"
                                        step="1"
                                        :placeholder="`$${form.priceUsd} USD`"
                                        class="bg-black/30 border border-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                                    >
                                    <input
                                        v-model="form.regionalPricing[region].storeUrl"
                                        type="url"
                                        :placeholder="String(form.regionalPricing[region].priceUsd).trim() ? 'Required: https://amazon.com/...' : 'Optional store URL'"
                                        :required="String(form.regionalPricing[region].priceUsd).trim().length > 0"
                                        class="bg-black/30 border px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                                        :class="String(form.regionalPricing[region].priceUsd).trim() && !form.regionalPricing[region].storeUrl.trim() ? 'border-red-500/60' : 'border-zinc-800'"
                                    >
                                    <label class="flex items-center gap-2 text-xs text-zinc-300">
                                        <input
                                            v-model="form.regionalPricing[region].available"
                                            type="checkbox"
                                            class="w-4 h-4 rounded border-zinc-700 bg-zinc-950"
                                        >
                                        Available
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center gap-3 flex-wrap">
                        <button
                            class="px-4 py-2.5 text-sm font-bold border border-amber-400 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                            :disabled="saving || deleting || !canSave"
                            @click="saveItem"
                        >
                            {{ saving ? "Saving..." : (isCreatingNew ? "Create Item" : "Save Changes") }}
                        </button>
                        <button
                            class="px-4 py-2.5 text-sm font-bold border border-zinc-700 text-zinc-300 hover:text-white hover:border-white transition-colors disabled:opacity-60"
                            :disabled="saving || deleting"
                            @click="resetForm"
                        >
                            Reset Form
                        </button>
                        <button
                            v-if="!isCreatingNew && canDelete && selectedItem"
                            class="px-4 py-2.5 text-sm font-bold border border-red-500/60 text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-60 ml-auto"
                            :disabled="saving || deleting"
                            @click="openDeleteModal"
                        >
                            {{ deleting ? "Deleting..." : "Delete Item" }}
                        </button>
                    </div>
                </section>

                <aside class="flex flex-col gap-6">
                    <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Preview</p>
                                <h2 class="text-lg font-bold text-white">
                                    {{ form.name.trim() || "Untitled item" }}
                                </h2>
                            </div>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ form.available ? "Public" : "Hidden" }}
                            </span>
                        </div>

                        <div class="aspect-[4/3] border border-zinc-800 bg-black/30 overflow-hidden">
                            <img
                                v-if="previewImageUrl"
                                :src="previewImageUrl"
                                :alt="form.name || 'Shop item preview'"
                                class="w-full h-full object-cover"
                            >
                            <div
                                v-else
                                class="w-full h-full flex items-center justify-center text-sm text-zinc-500"
                            >
                                No image configured
                            </div>
                        </div>

                        <div class="flex flex-wrap gap-2">
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ kindLabel(form.kind) }}
                            </span>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ providerLabel(form.fulfillmentProvider) }}
                            </span>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ inventoryLabel(form.inventoryMode) }}
                            </span>
                        </div>

                        <dl class="flex flex-col gap-3 text-sm">
                            <div class="flex items-center justify-between gap-3">
                                <dt class="text-zinc-500">Price</dt>
                                <dd class="text-white font-semibold">
                                    ${{ form.priceUsd.toFixed(2) }} ({{ Math.round(form.priceUsd * GOLD_PER_HOUR) }} gold)
                                </dd>
                            </div>
                            <div v-if="form.kind === 'grant'" class="flex items-center justify-between gap-3">
                                <dt class="text-zinc-500">Grant amount</dt>
                                <dd class="text-white font-semibold">
                                    {{ form.grantAmountDollars != null ? `$${form.grantAmountDollars.toFixed(2)}` : "Not set" }}
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3">
                                <dt class="text-zinc-500">Stock</dt>
                                <dd class="text-white font-semibold">
                                    {{ form.inventoryMode === "limited" ? `${form.stockRemaining ?? 0} left` : "Unlimited" }}
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3">
                                <dt class="text-zinc-500">Available until</dt>
                                <dd class="text-right text-white font-semibold">{{ previewAvailableUntilLabel }}</dd>
                            </div>
                            <div class="flex items-center justify-between gap-3">
                                <dt class="text-zinc-500">Attachments</dt>
                                <dd class="text-white font-semibold">{{ previewAttachmentUrls.length }}</dd>
                            </div>
                        </dl>
                    </section>

                    <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-3">
                        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Metadata</p>
                        <div class="text-sm text-zinc-300 flex flex-col gap-2">
                            <p>
                                <span class="text-zinc-500">Created:</span>
                                {{ selectedItem?.created_at ? formatDate(selectedItem.created_at) : "Not saved yet" }}
                            </p>
                            <p>
                                <span class="text-zinc-500">Last updated:</span>
                                {{ selectedItem?.updated_at ? formatDate(selectedItem.updated_at) : "Not saved yet" }}
                            </p>
                            <p v-if="form.description.trim()" class="text-zinc-400">
                                {{ form.description }}
                            </p>
                        </div>
                    </section>
                </aside>
            </div>

            <section
                v-if="!isCreatingNew"
                class="border border-zinc-800 bg-zinc-900/40 p-5"
            >
                <div class="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Audit Log</p>
                        <h2 class="text-xl font-bold text-white">Item History</h2>
                    </div>
                    <span class="text-sm text-zinc-500">
                        {{ selectedItemDetail?.audits.length ?? 0 }} events
                    </span>
                </div>

                <div
                    v-if="!selectedItemDetail || selectedItemDetail.audits.length === 0"
                    class="text-sm text-zinc-500 italic"
                >
                    No audit events recorded for this item yet.
                </div>

                <div v-else class="flex flex-col gap-4">
                    <div
                        v-for="entry in selectedItemDetail.audits"
                        :key="entry.id"
                        class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3"
                    >
                        <div class="flex items-start justify-between gap-4 flex-wrap">
                            <div>
                                <p class="text-sm font-bold text-white capitalize">
                                    {{ formatAuditTitle(entry) }}
                                </p>
                                <p class="text-xs text-zinc-500">
                                    {{ formatDate(entry.created_at) }}
                                    <template v-if="entry.actor">
                                        ·
                                        <NuxtLink
                                            :to="`/internal/users/${entry.actor.id}`"
                                            class="text-zinc-300 hover:text-amber-200 transition-colors"
                                        >
                                            {{ entry.actor.name }}
                                        </NuxtLink>
                                    </template>
                                </p>
                            </div>
                            <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400">
                                {{ entry.action.replaceAll("_", " ") }}
                            </span>
                        </div>

                        <p v-if="entry.change_summary" class="text-sm text-zinc-300">
                            {{ entry.change_summary }}
                        </p>

                        <div
                            v-if="changedFields(entry).length"
                            class="flex flex-col gap-2"
                        >
                            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                                Changed Fields
                            </p>
                            <div class="flex flex-col gap-2">
                                <div
                                    v-for="field in changedFields(entry)"
                                    :key="field"
                                    class="border border-zinc-800 bg-zinc-950/60 p-3"
                                >
                                    <p class="text-xs font-bold text-zinc-200">{{ formatFieldLabel(field) }}</p>
                                    <p class="text-xs text-zinc-500 mt-1">
                                        From: {{ formatFieldValue(field, entry.old_value?.[field]) }}
                                    </p>
                                    <p class="text-xs text-zinc-300 mt-1">
                                        To: {{ formatFieldValue(field, entry.new_value?.[field]) }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <Teleport to="body">
            <div
                v-if="deleteModal && selectedItem"
                class="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
                @click.self="!deleting && (deleteModal = false)"
            >
                <div class="w-full max-w-md border border-zinc-700 bg-zinc-950 p-6 flex flex-col gap-4">
                    <div class="flex flex-col gap-1">
                        <h3 class="text-sm font-bold uppercase tracking-widest text-red-400">
                            Delete "{{ selectedItem.name }}"?
                        </h3>
                        <p class="text-sm text-zinc-400">
                            This permanently removes the shop item. It cannot be undone. If the item has orders, archive it instead by toggling Public Availability off.
                        </p>
                    </div>
                    <p v-if="deleteError" class="text-xs text-red-400">{{ deleteError }}</p>
                    <div class="flex justify-end gap-2">
                        <button
                            class="px-4 py-2 text-xs font-bold uppercase tracking-widest border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
                            :disabled="deleting"
                            @click="deleteModal = false"
                        >
                            Cancel
                        </button>
                        <button
                            class="px-4 py-2 text-xs font-bold uppercase tracking-widest border border-red-500/50 bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            :disabled="deleting"
                            @click="confirmDeleteItem"
                        >
                            {{ deleting ? "Deleting..." : "Delete item" }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
