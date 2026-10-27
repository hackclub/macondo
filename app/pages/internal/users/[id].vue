<script setup lang="ts">
definePageMeta({ layout: "internal" });

const route = useRoute();
const id = route.params.id as string;

const ALLOWED_ROLES = [
    "supaadmin",
    "admin",
    "fraudster",
    "software_reviewer",
    "hardware_reviewer",
    "fulfiller",
    "hq",
    "support",
    "events",
];

type UserProfile = {
    id: string;
    name: string;
    email?: string | null;
    hcb_email?: string | null;
    image: string | null;
    username: string | null;
    slack_id: string | null;
    hackatime_id: number | null;
    hackatimeTrustLevel: string | null;
    roles: string[] | null;
    createdAt: string;
    last_seen_at: string | null;
    isShadowBanned: boolean;
    isMacondoBanned: boolean;
    activeMacondoBan: {
        id: number;
        reason: string;
        expires_at: string | null;
        created_at: string | null;
    } | null;
    macondoBans: {
        id: number;
        reason: string;
        expires_at: string | null;
        created_at: string | null;
        active: boolean;
        lifted_at: string | null;
    }[];
    canImpersonate?: boolean;
    totalHackatimeHours: number;
    shippedShipCount: number;
    pendingShipCount: number;
    projects: {
        id: number;
        name: string;
        description: string;
        fruit: string | null;
        level: string | null;
        stage: number | null;
        demo_url: string | null;
        repository_url: string | null;
        created_at: string | null;
        project_streak_days: number | null;
        last_worked_date: string | null;
        hackatime_projects: string[] | null;
    }[];
    last_active_date: string | null;
    streak_freezes_remaining: number | null;
    reminder_hours_before_day_end: number | null;
    streak_slack_notifications: boolean | null;
    timezone: string | null;
    last_hackatime_synced_at: string | null;
    linkedHackatimeNames: string[];
    streakDays: {
        day: string;
        status: "pending" | "active" | "frozen" | "missed" | "review_protected";
        seconds_logged: number;
        had_journal: boolean;
        created_at: string | null;
        updated_at: string | null;
    }[];
    shadowBans: { id: number; reason: string; created_at: string }[];
    internalNotes: {
        id: number;
        note: string;
        created_at: string | null;
        updated_at: string | null;
        created_by: string;
        author: {
            id: string;
            name: string;
            image: string | null;
            username: string | null;
        } | null;
    }[];
    audits: {
        id: number;
        action: string;
        entity_type: string;
        entity_id: string;
        old_value: Record<string, unknown> | null;
        new_value: Record<string, unknown> | null;
        public_message: string | null;
        change_summary: string | null;
        sensitive: boolean;
        created_at: string | null;
        actor: {
            id: string;
            name: string;
            image: string | null;
            username: string | null;
        } | null;
    }[];
    transactions: {
        id: number;
        amount: number;
        type: "increase" | "decrease";
        source: string;
        memo: string | null;
        counts: boolean;
        created_at: string;
        ship_id: number | null;
        shop_order_id: number | null;
        created_by_user_id: string | null;
        createdBy: {
            id: string;
            name: string;
            image: string | null;
            username: string | null;
        } | null;
    }[];
    ships: {
        ship: {
            id: number;
            hackatime_hours: number | null;
            status:
                | "under_review"
                | "pending_fraud_review"
                | "shipped_missing_airtable"
                | "shipped"
                | "rejected";
            created_at: string | null;
            reviewed_at: string | null;
        };
        project: { name: string } | null;
    }[];
    grants: {
        id: number;
        project_id: number;
        ship_id: number;
        amount_cents: number;
        status: "queued" | "sent" | "cancelled";
        hcb_grant_id: string | null;
        cancel_reason: string | null;
        reissued_from_id: number | null;
        created_at: string | null;
        sent_at: string | null;
        cancelled_at: string | null;
        project: {
            id: number;
            name: string;
            fruit: string | null;
        };
    }[];
    orders: {
        id: number;
        status: string;
        quantity: number;
        item_snapshot: {
            name?: string;
            kind?: string;
            fulfillment_provider?: string;
            price_gold?: number | null;
            price_fruit_type?: string | null;
            price_fruit_amount?: number | null;
            grant_amount_cents?: number | null;
        } | null;
        selected_modifiers: Array<{
            modifier_label: string;
            options: Array<{ label: string }>;
        }> | null;
        external_reference: string | null;
        fulfillment_error: string | null;
        region: string | null;
        tracking_number: string | null;
        created_at: string | null;
        updated_at: string | null;
    }[];
    currencyBalances: {
        gold: number;
        fruits: { fruit_type: string; balance: number }[];
    };
    sessions?: {
        id: string;
        created_at: string;
        expires_at: string;
        ip_address: string | null;
        user_agent: string | null;
    }[];
    referralVisits?: {
        id: number;
        created_at: string;
        ip_address: string | null;
        user_agent: string | null;
        landing_path: string;
        referer: string | null;
        utm_source: string | null;
    }[];
};

const profileData = ref<UserProfile | null>(null);
const pending = ref(true);
const fetchError = ref<unknown>(null);
const syncing = ref(false);
const syncError = ref("");
const auditsOpen = ref(false);
const transactionsOpen = ref(false);
const sessionsOpen = ref(false);
const showAllSessions = ref(false);
const showAllVisits = ref(false);
const expandedUaIds = ref<string[]>([]);
const openAuditEntries = ref<number[]>([]);

function toggleUaId(id: string) {
    const idx = expandedUaIds.value.indexOf(id);
    if (idx === -1) expandedUaIds.value.push(id);
    else expandedUaIds.value.splice(idx, 1);
}
function isUaExpanded(id: string) {
    return expandedUaIds.value.includes(id);
}

const distinctIps = computed<{ ip: string; hits: number }[]>(() => {
    const profile = profileData.value;
    if (!profile) return [];
    const counts = new Map<string, number>();
    for (const s of profile.sessions ?? []) {
        if (s.ip_address) counts.set(s.ip_address, (counts.get(s.ip_address) ?? 0) + 1);
    }
    for (const v of profile.referralVisits ?? []) {
        if (v.ip_address) counts.set(v.ip_address, (counts.get(v.ip_address) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([ip, hits]) => ({ ip, hits }))
        .sort((a, b) => b.hits - a.hits);
});
const distinctIpCount = computed(() => distinctIps.value.length);
type UserAdminTab = "overview" | "projects" | "notes" | "activity" | "finance";
const activeUserTab = ref<UserAdminTab>("overview");
const userAdminTabs = computed<{ id: UserAdminTab; label: string; meta: string }[]>(() => {
    const profile = profileData.value;

    return [
        { id: "overview", label: "Overview", meta: "Account, roles, streak" },
        {
            id: "projects",
            label: "Projects",
            meta: `${profile?.projects.length ?? 0} projects · ${profile?.ships.length ?? 0} ships`,
        },
        {
            id: "notes",
            label: "Notes",
            meta: `${profile?.internalNotes.length ?? 0} internal notes`,
        },
        {
            id: "activity",
            label: "Audit",
            meta: `${profile?.audits.length ?? 0} events · ${profile?.transactions.length ?? 0} tx`,
        },
        {
            id: "finance",
            label: "Finance",
            meta: `${profile?.grants.length ?? 0} grants · ${profile?.orders?.length ?? 0} orders · ${profile?.transactions.length ?? 0} tx`,
        },
    ];
});

async function fetchProfile() {
    pending.value = true;
    fetchError.value = null;
    try {
        profileData.value = await $fetch<UserProfile>(
            `/api/internal/users/${id}`,
        );
    } catch (e: unknown) {
        fetchError.value = e;
        const err = e as { statusCode?: number };
        if (err?.statusCode === 401 || err?.statusCode === 403)
            navigateTo("/?login=required");
    } finally {
        pending.value = false;
    }
}

onMounted(fetchProfile);

async function syncHackatime() {
    syncing.value = true;
    syncError.value = "";
    try {
        await $fetch(`/api/internal/users/${id}/sync-hackatime`, {
            method: "POST",
        });
        await fetchProfile();
    } catch (e: unknown) {
        syncError.value = (e as { data?: { message?: string } })?.data?.message ?? "Sync failed";
    } finally {
        syncing.value = false;
    }
}

const { data: meData } = useFetch<{
    permissions: { canSeePii: boolean; canImpersonate: boolean };
    roles: string[] | null;
}>("/api/internal/me", { server: false });
const canSeePii = computed(() => meData.value?.permissions?.canSeePii ?? false);
const canEditRoles = computed(() =>
    (meData.value?.roles ?? []).includes("supaadmin"),
);
const canManageNotes = computed(() =>
    (meData.value?.roles ?? []).some((r) =>
        ["supaadmin", "admin", "fraudster", "software_reviewer", "hardware_reviewer", "hq"].includes(r),
    ),
);
const canManageGrants = computed(() =>
    (meData.value?.roles ?? []).includes("supaadmin"),
);
const canShadowBan = computed(() =>
    (meData.value?.roles ?? []).some((r) =>
        ["supaadmin", "admin", "fraudster"].includes(r),
    ),
);
const canGrantDevCurrency = computed(
    () =>
        import.meta.dev &&
        (meData.value?.roles ?? []).includes("supaadmin"),
);
const canNukeUser = computed(() =>
    (meData.value?.roles ?? []).includes("supaadmin"),
);
const canBanUser = computed(() =>
    (meData.value?.roles ?? []).includes("supaadmin"),
);
const canAdjustGold = computed(() =>
    (meData.value?.roles ?? []).includes("supaadmin"),
);
const canImpersonateProfile = computed(
    () =>
        (meData.value?.permissions?.canImpersonate ?? false) &&
        !!profileData.value?.canImpersonate,
);
const isSelfView = computed(() =>
    !!meData.value && profileData.value?.id === (meData.value as unknown as { id?: string })?.id,
);
const impersonating = ref(false);
const impersonationError = ref("");

async function impersonateProfileUser() {
    if (!profileData.value || !canImpersonateProfile.value) return;

    impersonating.value = true;
    impersonationError.value = "";

    try {
        window.location.href = (await $fetch<{ redirectTo?: string }>(
            `/api/internal/users/${profileData.value.id}/impersonate`,
            { method: "POST" },
        )).redirectTo ?? "/dashboard";
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        impersonationError.value =
            err?.data?.message ??
            err?.data?.statusMessage ??
            "Failed to start impersonation";
    } finally {
        impersonating.value = false;
    }
}

const nukeModal = ref(false);
const nukeReason = ref("");
const nukeConfirmText = ref("");
const nukeSaving = ref(false);
const nukeError = ref("");

async function doNukeUser() {
    if (nukeConfirmText.value.trim() !== "NUKE") {
        nukeError.value = 'Type NUKE exactly to confirm';
        return;
    }
    nukeSaving.value = true;
    nukeError.value = "";
    try {
        if ((await $fetch<{ success: true; backupId: number; selfNuke: boolean }>(
            `/api/internal/users/${id}/nuke`,
            {
                method: "POST",
                body: {
                    reason: nukeReason.value.trim() || undefined,
                    confirm: "NUKE",
                },
            },
        )).selfNuke) {
            // Session cookie was cleared server-side; full reload drops client auth state.
            window.location.href = "/";
            return;
        }
        await navigateTo("/internal/users/backups");
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        nukeError.value = err?.data?.message ?? err?.data?.statusMessage ?? "Failed";
    } finally {
        nukeSaving.value = false;
    }
}

const editingRoles = ref(false);
const pendingRoles = ref<string[]>([]);
const rolesSaving = ref(false);
const rolesError = ref("");
const devCurrencyAmount = ref("10");
const devCurrencyMemo = ref("");
const devCurrencySaving = ref(false);
const devCurrencyError = ref("");

// Prod-capable, unlike the dev-only grant above. The note is shown to the maker.
const goldAdjustAmount = ref("");
const goldAdjustNote = ref("");
const goldAdjustSaving = ref(false);
const goldAdjustError = ref("");
// Swaps the gold_adjusted notification for celebratory copy. Only applies to "add".
const goldAdjustReason = ref<"" | "show_and_tell_won" | "show_and_tell_participated">("");

// One row's reverse input open at a time; no browser confirm() on internal UI.
const goldReverseState = ref<{
    txId: number | null;
    note: string;
    saving: boolean;
    error: string;
}>({ txId: null, note: "", saving: false, error: "" });

function startEditRoles() {
    pendingRoles.value = [...(profileData.value?.roles ?? [])];
    editingRoles.value = true;
    rolesError.value = "";
}

function toggleRole(role: string) {
    const idx = pendingRoles.value.indexOf(role);
    if (idx === -1) pendingRoles.value.push(role);
    else pendingRoles.value.splice(idx, 1);
}

async function saveRoles() {
    rolesSaving.value = true;
    rolesError.value = "";
    try {
        await $fetch(`/api/internal/users/${id}/roles`, {
            method: "PATCH",
            body: { roles: pendingRoles.value },
        });
        await fetchProfile();
        editingRoles.value = false;
    } catch (e: unknown) {
        rolesError.value = (e as { data?: { message?: string } })?.data?.message ?? "Failed to save roles";
    } finally {
        rolesSaving.value = false;
    }
}

const shadowBanModal = ref(false);
const shadowBanReason = ref("");
const shadowBanSaving = ref(false);
const shadowBanError = ref("");

const refundModal = ref(false);
const refundDay = ref("");
const refundReason = ref("");
const refundSaving = ref(false);
const refundError = ref("");
const refundResult = ref<null | {
    live_seconds: number;
    stored_seconds: number;
    journal_seconds: number;
}>(null);

function openRefundModal(day: string) {
    refundDay.value = day;
    refundReason.value = "";
    refundError.value = "";
    refundResult.value = null;
    refundModal.value = true;
}

async function doRefund() {
    if (refundReason.value.trim().length < 3) {
        refundError.value = "Reason required (min 3 chars)";
        return;
    }
    refundSaving.value = true;
    refundError.value = "";
    try {
        const res = await $fetch<{
            success: true;
            day: string;
            new_status: "active";
            streak_freezes_remaining: number;
            live_seconds: number;
            stored_seconds: number;
            journal_seconds: number;
        }>(`/api/internal/users/${id}/refund-streak-freeze`, {
            method: "POST",
            body: {
                day: refundDay.value,
                reason: refundReason.value.trim(),
            },
        });
        refundResult.value = {
            live_seconds: res.live_seconds,
            stored_seconds: res.stored_seconds,
            journal_seconds: res.journal_seconds,
        };
        refundModal.value = false;
        await fetchProfile();
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        refundError.value =
            err?.data?.statusMessage ?? err?.data?.message ?? "Failed";
    } finally {
        refundSaving.value = false;
    }
}

async function applyShadowBan() {
    if (!shadowBanReason.value.trim()) {
        shadowBanError.value = "Reason required";
        return;
    }
    shadowBanSaving.value = true;
    shadowBanError.value = "";
    try {
        await $fetch(`/api/internal/users/${id}/shadow-ban`, {
            method: "POST",
            body: { reason: shadowBanReason.value.trim() },
        });
        shadowBanModal.value = false;
        shadowBanReason.value = "";
        await fetchProfile();
    } catch (e: unknown) {
        shadowBanError.value = (e as { data?: { message?: string } })?.data?.message ?? "Failed";
    } finally {
        shadowBanSaving.value = false;
    }
}

async function removeShadowBan() {
    if (!confirm("Remove shadow ban?")) return;
    try {
        await $fetch(`/api/internal/users/${id}/shadow-ban`, {
            method: "DELETE",
        });
        await fetchProfile();
    } catch { /* ignore */ }
}

// Hard account ban: blocks app access and kicks from the main Slack channel (re-kicks on rejoin).
const macondoBanModal = ref(false);
const macondoBanReason = ref("");
const macondoBanType = ref<"perm" | "temp">("perm");
const macondoBanHours = ref<number>(24);
const macondoBanGoldPercent = ref<number>(0);
const macondoBanSaving = ref(false);
const macondoBanError = ref("");

// Floored to whole gold against the balance; mirrors the server computation.
const macondoBanGoldPreview = computed(() => {
    const pct = Number(macondoBanGoldPercent.value) || 0;
    const gold = profileData.value?.currencyBalances?.gold ?? 0;
    if (pct <= 0 || gold <= 0) return 0;
    return Math.floor((gold * pct) / 100);
});

function openMacondoBanModal() {
    macondoBanReason.value = "";
    macondoBanType.value = "perm";
    macondoBanHours.value = 24;
    macondoBanGoldPercent.value = 0;
    macondoBanError.value = "";
    macondoBanModal.value = true;
}

async function applyMacondoBan() {
    if (!macondoBanReason.value.trim()) {
        macondoBanError.value = "Reason required";
        return;
    }
    if (macondoBanType.value === "temp" && !(macondoBanHours.value > 0)) {
        macondoBanError.value = "Enter a positive number of hours";
        return;
    }
    const goldPct = Number(macondoBanGoldPercent.value) || 0;
    if (goldPct < 0 || goldPct > 100) {
        macondoBanError.value = "Gold removal must be between 0 and 100%";
        return;
    }
    macondoBanSaving.value = true;
    macondoBanError.value = "";
    try {
        await $fetch(`/api/internal/users/${id}/macondo-ban`, {
            method: "POST",
            body: {
                reason: macondoBanReason.value.trim(),
                type: macondoBanType.value,
                expires_in_hours:
                    macondoBanType.value === "temp"
                        ? macondoBanHours.value
                        : undefined,
                gold_removal_percent: goldPct > 0 ? goldPct : undefined,
            },
        });
        macondoBanModal.value = false;
        macondoBanReason.value = "";
        await fetchProfile();
    } catch (e: unknown) {
        const err = e as { data?: { message?: string; statusMessage?: string } };
        macondoBanError.value =
            err?.data?.statusMessage ?? err?.data?.message ?? "Failed";
    } finally {
        macondoBanSaving.value = false;
    }
}

async function removeMacondoBan() {
    if (!confirm("Lift Macondo ban? The user will regain app access.")) return;
    try {
        await $fetch(`/api/internal/users/${id}/macondo-ban`, {
            method: "DELETE",
        });
        await fetchProfile();
    } catch { /* ignore */ }
}

const noteDraft = ref("");
const noteSaving = ref(false);
const noteError = ref("");
const deletingNoteIds = ref<number[]>([]);

async function addInternalNote() {
    const note = noteDraft.value.trim();
    if (!note) {
        noteError.value = "Note required";
        return;
    }

    noteSaving.value = true;
    noteError.value = "";

    try {
        await $fetch(`/api/internal/users/${id}/notes`, {
            method: "POST",
            body: { note },
        });
        noteDraft.value = "";
        await fetchProfile();
    } catch (e: unknown) {
        noteError.value = (e as { data?: { message?: string } })?.data?.message ?? "Failed to add note";
    } finally {
        noteSaving.value = false;
    }
}

async function deleteInternalNote(noteId: number) {
    if (!confirm("Delete this internal note?")) return;

    deletingNoteIds.value.push(noteId);
    noteError.value = "";

    try {
        await $fetch(`/api/internal/users/${id}/notes/${noteId}`, {
            method: "DELETE",
        });
        await fetchProfile();
    } catch (e: unknown) {
        noteError.value = (e as { data?: { message?: string } })?.data?.message ?? "Failed to delete note";
    } finally {
        deletingNoteIds.value = deletingNoteIds.value.filter(
            (currentId) => currentId !== noteId,
        );
    }
}

function isDeletingNote(noteId: number) {
    return deletingNoteIds.value.includes(noteId);
}

const trustColors: Record<string, string> = {
    Green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    Yellow: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Red: "bg-red-500/10 text-red-400 border-red-500/20",
};

const displayedTrustFactor = computed(() => {
    const trustLevel = profileData.value?.hackatimeTrustLevel?.trim();
    if (!trustLevel) return null;

    const normalizedTrustLevel =
        trustLevel.charAt(0).toUpperCase() +
        trustLevel.slice(1).toLowerCase();

    return normalizedTrustLevel in trustColors ? normalizedTrustLevel : null;
});

const displayName = computed(() => {
    if (!profileData.value) return "Unknown User";
    return profileData.value.name;
});

function shipStatusLabel(
    status: UserProfile["ships"][number]["ship"]["status"],
) {
    switch (status) {
        case "pending_fraud_review":
            return "FRAUDSQUAD REVIEW";
        case "shipped_missing_airtable":
            return "MISSING AIRTABLE";
        case "shipped":
            return "SHIPPED";
        case "rejected":
            return "REJECTED";
        case "pending_second_pass":
            return "PENDING SECOND PASS";
        default:
            return "UNDER REVIEW";
    }
}

function shipStatusClass(
    status: UserProfile["ships"][number]["ship"]["status"],
) {
    switch (status) {
        case "pending_fraud_review":
            return "bg-red-500/10 text-red-400 border-red-500/20";
        case "shipped_missing_airtable":
            return "bg-amber-500/10 text-amber-400 border-amber-500/20";
        case "shipped":
            return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        case "rejected":
            return "bg-red-500/10 text-red-400 border-red-500/20";
        case "pending_second_pass":
            return "bg-amber-500/10 text-amber-400 border-amber-500/20";
        default:
            return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    }
}

function formatAuditTitle(entry: UserProfile["audits"][number]) {
    return entry.public_message ?? entry.change_summary ?? entry.action.replaceAll("_", " ");
}

function changedFields(entry: UserProfile["audits"][number]) {
    const oldValue = entry.old_value ?? {};
    const newValue = entry.new_value ?? {};
    const ignoredFields = new Set([
        "created_at",
        "updated_at",
        "reviewed_at",
        "archived_at",
        "last_seen_at",
        "expiresAt",
        "expires_at",
    ]);
    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);

    return [...new Set(newKeys.length > 0 ? newKeys : oldKeys)].filter((key) => {
        if (ignoredFields.has(key)) return false;

        const oldHasKey = Object.prototype.hasOwnProperty.call(oldValue, key);
        const newHasKey = Object.prototype.hasOwnProperty.call(newValue, key);
        const previous = oldValue[key];
        const next = newValue[key];
        const previousEmpty = previous == null || previous === "" || (Array.isArray(previous) && previous.length === 0);
        const nextEmpty = next == null || next === "" || (Array.isArray(next) && next.length === 0);

        if (!oldHasKey && !newHasKey) return false;
        if (previousEmpty && nextEmpty) return false;

        return JSON.stringify(previous) !== JSON.stringify(next);
    });
}

function formatFieldValue(value: unknown) {
    if (value == null || value === "") return "Empty";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function transactionAmountLabel(entry: UserProfile["transactions"][number]) {
    return `${entry.type === "increase" ? "+" : "-"}${entry.amount}`;
}

function transactionAmountClass(entry: UserProfile["transactions"][number]) {
    return entry.type === "increase"
        ? "text-emerald-400"
        : "text-red-400";
}

function toggleAuditEntry(entryId: number) {
    const index = openAuditEntries.value.indexOf(entryId);
    if (index === -1) {
        openAuditEntries.value.push(entryId);
        return;
    }

    openAuditEntries.value.splice(index, 1);
}

function isAuditEntryOpen(entryId: number) {
    return openAuditEntries.value.includes(entryId);
}

async function grantDevCurrency() {
    const amount = Number(devCurrencyAmount.value);

    if (!Number.isInteger(amount) || amount <= 0) {
        devCurrencyError.value = "Amount must be a positive whole number";
        return;
    }

    devCurrencySaving.value = true;
    devCurrencyError.value = "";

    try {
        await $fetch(`/api/internal/users/${id}/currency`, {
            method: "POST",
            body: {
                amount,
                memo: devCurrencyMemo.value.trim() || undefined,
            },
        });
        devCurrencyMemo.value = "";
        await fetchProfile();
    } catch (e: unknown) {
        devCurrencyError.value =
            (e as { data?: { message?: string } })?.data?.message ?? "Failed to grant dev currency";
    } finally {
        devCurrencySaving.value = false;
    }
}

async function adjustGold(direction: "add" | "subtract") {
    const amount = Number(goldAdjustAmount.value);
    const note = goldAdjustNote.value.trim();

    if (!Number.isInteger(amount) || amount <= 0) {
        goldAdjustError.value = "Amount must be a positive whole number";
        return;
    }
    if (!note) {
        goldAdjustError.value = "A note is required";
        return;
    }

    const reason =
        direction === "add" && goldAdjustReason.value
            ? goldAdjustReason.value
            : undefined;

    goldAdjustSaving.value = true;
    goldAdjustError.value = "";

    try {
        await $fetch(`/api/internal/users/${id}/gold-adjustment`, {
            method: "POST",
            body: { amount, direction, note, ...(reason ? { reason } : {}) },
        });
        goldAdjustAmount.value = "";
        goldAdjustNote.value = "";
        goldAdjustReason.value = "";
        await fetchProfile();
    } catch (e: unknown) {
        goldAdjustError.value =
            (e as { data?: { message?: string } })?.data?.message ?? "Failed to adjust gold";
    } finally {
        goldAdjustSaving.value = false;
    }
}

function startGoldReverse(txId: number) {
    goldReverseState.value = { txId, note: "", saving: false, error: "" };
}

function cancelGoldReverse() {
    goldReverseState.value = { txId: null, note: "", saving: false, error: "" };
}

async function confirmGoldReverse(txId: number) {
    goldReverseState.value.saving = true;
    goldReverseState.value.error = "";

    try {
        await $fetch(
            `/api/internal/users/${id}/gold-adjustment/${txId}/reverse`,
            {
                method: "POST",
                body: { note: goldReverseState.value.note.trim() || undefined },
            },
        );
        cancelGoldReverse();
        await fetchProfile();
    } catch (e: unknown) {
        goldReverseState.value.error =
            (e as { data?: { message?: string } })?.data?.message ?? "Failed to reverse adjustment";
        goldReverseState.value.saving = false;
    }
}

// Inline per-row flow; no browser alert/confirm/prompt.
type GrantActionMode = "cancel-card" | "cancel-fruit" | null;
type GrantActionState = {
    mode: GrantActionMode;
    reason: string;
    loading: boolean;
    error: string | null;
};
const grantActionStates = ref<Record<number, GrantActionState>>({});

function getGrantActionState(grantId: number): GrantActionState {
    return (
        grantActionStates.value[grantId] ?? {
            mode: null,
            reason: "",
            loading: false,
            error: null,
        }
    );
}
function setGrantActionState(grantId: number, patch: Partial<GrantActionState>) {
    const current = getGrantActionState(grantId);
    grantActionStates.value = {
        ...grantActionStates.value,
        [grantId]: { ...current, ...patch },
    };
}
function resetGrantActionState(grantId: number) {
    // Rest-spread instead of `delete` for the no-dynamic-delete lint rule.
    const { [grantId]: _removed, ...rest } = grantActionStates.value;
    void _removed;
    grantActionStates.value = rest;
}

function startGrantCancel(grantId: number, mode: GrantActionMode) {
    setGrantActionState(grantId, {
        mode,
        reason: "",
        loading: false,
        error: null,
    });
}
function cancelGrantAction(grantId: number) {
    resetGrantActionState(grantId);
}

async function submitGrantCancel(grantId: number) {
    const state = getGrantActionState(grantId);
    if (!state.mode) return;
    if (!state.reason.trim()) {
        setGrantActionState(grantId, { error: "A reason is required." });
        return;
    }
    setGrantActionState(grantId, { loading: true, error: null });
    try {
        await $fetch(`/api/internal/grants/${grantId}/cancel`, {
            method: "POST",
            body: {
                reason: state.reason.trim(),
                awardFruit: state.mode === "cancel-fruit",
            },
        });
        resetGrantActionState(grantId);
        await fetchProfile();
    } catch (err) {
        setGrantActionState(grantId, {
            loading: false,
            error: (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? "Failed to cancel grant",
        });
    }
}

function formatGrantDollars(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
}

function orderStatusClass(status: string): string {
    if (
        status === "shipped" ||
        status === "service_activated" ||
        status === "grant_created" ||
        status === "hcb_active"
    ) {
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    }
    if (status === "external_failure") {
        return "border-red-500/30 bg-red-500/10 text-red-300";
    }
    if (status === "cancelled") {
        return "border-zinc-700 bg-zinc-800/40 text-zinc-400";
    }
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function formatOrderPrice(order: UserProfile["orders"][number]): string {
    const snapshot = order.item_snapshot;
    if (!snapshot) return "?";
    const qty = order.quantity ?? 1;
    if (snapshot.price_gold != null && snapshot.price_gold > 0) {
        const total = snapshot.price_gold * qty;
        return `${total} gold (~$${(total / 10).toFixed(2)})`;
    }
    if (snapshot.price_fruit_amount != null && snapshot.price_fruit_type) {
        return `${snapshot.price_fruit_amount * qty} ${snapshot.price_fruit_type}`;
    }
    if (snapshot.grant_amount_cents != null) {
        return formatGrantDollars(snapshot.grant_amount_cents * qty);
    }
    return "?";
}

const streakDayByKey = computed(() => {
    const map: Record<string, UserProfile["streakDays"][number]> = {};
    for (const row of profileData.value?.streakDays ?? []) {
        map[row.day] = row;
    }
    return map;
});

const streakGridDays = computed(() => {
    const out: { day: string; row: UserProfile["streakDays"][number] | null }[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) { // last 14 days, oldest first
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        const key = d.toISOString().slice(0, 10);
        out.push({ day: key, row: streakDayByKey.value[key] ?? null });
    }
    return out;
});

function streakCellClass(row: UserProfile["streakDays"][number] | null) {
    if (!row) return "border-zinc-800 bg-zinc-950/40";
    const synthetic =
        row.status === "active" && row.seconds_logged === 0 && !row.had_journal;
    if (row.status === "active" && synthetic)
        return "border-emerald-500/40 bg-emerald-500/10 border-dashed";
    if (row.status === "active")
        return "border-emerald-500/40 bg-emerald-500/20";
    if (row.status === "frozen")
        return "border-blue-500/40 bg-blue-500/15";
    if (row.status === "review_protected")
        return "border-cyan-500/40 bg-cyan-500/15";
    if (row.status === "missed")
        return "border-red-500/40 bg-red-500/15";
    return "border-amber-500/40 bg-amber-500/10";
}

function streakCellTitle(day: string, row: UserProfile["streakDays"][number] | null) {
    if (!row) return `${day}\n(no row)`;
    const seconds = row.seconds_logged;
    return [
        day,
        `status: ${row.status}${row.status === "active" && row.seconds_logged === 0 && !row.had_journal ? " (synthetic backfill)" : ""}`,
        `seconds_logged: ${seconds} (~${Math.round(seconds / 60)}m)`, // seconds to minutes
        `had_journal: ${row.had_journal ? "yes" : "no"}`,
    ].join("\n");
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-5xl mx-auto flex flex-col gap-6">
            <button
                class="flex items-center gap-2 text-zinc-500 hover:text-white text-sm transition-colors w-fit"
                @click="navigateTo('/internal/users')"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to Users
            </button>

            <div v-if="pending" class="flex flex-col gap-6">
                <div
                    class="border border-zinc-800 bg-zinc-900/40 p-6 animate-pulse flex gap-4"
                >
                    <div
                        class="w-16 h-16 rounded-full bg-zinc-800 flex-shrink-0"
                    />
                    <div class="flex flex-col gap-2 flex-1">
                        <div class="h-5 bg-zinc-800 rounded w-48" />
                        <div class="h-3 bg-zinc-800 rounded w-32" />
                    </div>
                </div>
            </div>

            <template v-else-if="profileData">
                <div
                    class="border border-zinc-800 bg-zinc-900/40 p-6 flex flex-col md:flex-row md:items-center gap-5"
                >
                    <img
                        v-if="profileData.image"
                        :src="profileData.image"
                        class="w-16 h-16 rounded-full border border-zinc-700 bg-black flex-shrink-0"
                    >
                    <div
                        v-else
                        class="w-16 h-16 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-2xl font-bold text-zinc-500 flex-shrink-0"
                    >
                        {{ profileData.name?.charAt(0)?.toUpperCase() ?? "?" }}
                    </div>

                    <div class="flex flex-col gap-1 flex-1">
                        <div class="flex items-center gap-3 flex-wrap">
                            <h1 class="text-2xl font-bold text-white">
                                {{ displayName }}
                            </h1>
                            <span
                                v-if="displayedTrustFactor"
                                class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border"
                                :class="trustColors[displayedTrustFactor]"
                                >{{ displayedTrustFactor }}</span
                            >
                            <span
                                v-if="profileData.isShadowBanned"
                                class="text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-0.5"
                                >SHADOW BANNED</span
                            >
                            <span
                                v-if="profileData.isMacondoBanned"
                                class="text-xs font-bold text-red-300 bg-red-700/20 border border-red-700/40 px-2 py-0.5"
                                >{{ profileData.activeMacondoBan?.expires_at ? "TEMP BANNED" : "BANNED" }}</span
                            >
                        </div>
                        <span
                            v-if="canSeePii"
                            class="text-zinc-400 text-sm font-mono"
                        >{{
                            profileData.username ??
                            profileData.slack_id ??
                            profileData.id
                        }}</span>
                    </div>

                    <div v-if="canImpersonateProfile || canShadowBan || canBanUser || canNukeUser" class="flex gap-2 flex-shrink-0">
                        <button
                            v-if="canImpersonateProfile"
                            class="text-xs font-bold px-3 py-2 border border-amber-500/30 text-amber-100 bg-amber-500/10 hover:bg-amber-500/20 transition-colors disabled:opacity-60 disabled:cursor-wait"
                            :disabled="impersonating"
                            @click="impersonateProfileUser"
                        >
                            {{ impersonating ? "Starting..." : "Impersonate" }}
                        </button>
                        <button
                            v-if="canShadowBan && !profileData.isShadowBanned"
                            class="text-xs font-bold px-3 py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                            @click="shadowBanModal = true"
                        >
                            Shadow Ban
                        </button>
                        <button
                            v-else-if="canShadowBan"
                            class="text-xs font-bold px-3 py-2 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
                            @click="removeShadowBan"
                        >
                            Remove Ban
                        </button>
                        <button
                            v-if="canBanUser && !profileData.isMacondoBanned"
                            class="text-xs font-bold px-3 py-2 border border-red-600/40 text-red-300 bg-red-600/10 hover:bg-red-600/20 transition-colors"
                            @click="openMacondoBanModal"
                        >
                            Ban
                        </button>
                        <button
                            v-else-if="canBanUser"
                            class="text-xs font-bold px-3 py-2 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
                            @click="removeMacondoBan"
                        >
                            Unban
                        </button>
                        <button
                            v-if="canNukeUser"
                            class="text-xs font-bold px-3 py-2 border border-red-700 text-red-200 bg-red-700/20 hover:bg-red-700/40 transition-colors"
                            @click="nukeModal = true"
                        >
                            Nuke User
                        </button>
                    </div>
                </div>
                <p
                    v-if="impersonationError"
                    class="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                    {{ impersonationError }}
                </p>

                <div class="border border-zinc-800 bg-zinc-950/80 p-2 sticky top-20 z-20">
                    <nav class="flex items-stretch gap-1 overflow-x-auto" aria-label="User admin sections">
                        <button
                            v-for="tab in userAdminTabs"
                            :key="tab.id"
                            class="min-w-[145px] flex-1 border px-4 py-3 text-left transition-colors"
                            :class="activeUserTab === tab.id
                                ? 'border-white bg-white text-black'
                                : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600 hover:text-white'"
                            @click="activeUserTab = tab.id"
                        >
                            <span class="text-sm font-bold">{{ tab.label }}</span>
                            <span
                                class="block mt-1 text-xs"
                                :class="activeUserTab === tab.id ? 'text-black/60' : 'text-zinc-500'"
                            >
                                {{ tab.meta }}
                            </span>
                        </button>
                    </nav>
                </div>

                <div
                    v-show="activeUserTab === 'overview'"
                    class="flex flex-col gap-6"
                >
                    <div
                        class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                    >
                        <h2
                            class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                        >
                            Wallet
                        </h2>
                        <div
                            v-if="profileData.currencyBalances.gold === 0 && !profileData.currencyBalances.fruits.length"
                            class="text-zinc-500 text-sm"
                        >
                            No currency
                        </div>
                        <div
                            v-else
                            class="grid grid-cols-1 md:grid-cols-2 gap-6"
                        >
                            <div class="flex flex-col gap-2">
                                <span
                                    class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold"
                                    >Gold</span
                                >
                                <span class="text-3xl font-mono text-zinc-100 leading-none">{{
                                    profileData.currencyBalances.gold
                                }}</span>
                            </div>
                            <div class="flex flex-col gap-2">
                                <span
                                    class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold"
                                    >Fruits</span
                                >
                                <div
                                    v-if="profileData.currencyBalances.fruits.length"
                                    class="flex flex-col gap-1"
                                >
                                    <div
                                        v-for="f in profileData.currencyBalances.fruits"
                                        :key="f.fruit_type"
                                        class="flex items-baseline gap-2 text-sm"
                                    >
                                        <span class="text-zinc-100 font-mono">{{
                                            f.balance
                                        }}</span>
                                        <span class="text-zinc-400">{{ f.fruit_type }}</span>
                                    </div>
                                </div>
                                <span v-else class="text-zinc-500 text-sm">None</span>
                            </div>
                        </div>
                    </div>

                    <div
                        class="grid grid-cols-1 gap-6"
                        :class="{ 'md:grid-cols-2': canEditRoles }"
                    >
                    <div
                        class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                    >
                        <h2
                            class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                        >
                            Details
                        </h2>
                        <div class="flex flex-col gap-2 text-sm">
                            <div v-if="canSeePii" class="flex justify-between gap-4">
                                <span class="text-zinc-500">Email</span>
                                <span class="text-zinc-200 font-mono text-xs">{{
                                    profileData.email ?? "—"
                                }}</span>
                            </div>
                            <div v-if="canSeePii" class="flex justify-between gap-4">
                                <span class="text-zinc-500">HCB Email</span>
                                <span class="text-zinc-200 font-mono text-xs">{{
                                    profileData.hcb_email ?? "—"
                                }}</span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Slack ID</span>
                                <span class="text-zinc-300 font-mono text-xs">{{
                                    profileData.slack_id ?? "—"
                                }}</span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Hackatime ID</span>
                                <span class="text-zinc-300 font-mono text-xs">{{
                                    profileData.hackatime_id ?? "—"
                                }}</span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Hackatime Hours</span>
                                <div class="flex items-center gap-2">
                                    <span class="text-zinc-300 font-mono text-xs">{{
                                        profileData.totalHackatimeHours.toFixed(1) + "h"
                                    }}</span>
                                    <button
                                        class="text-[10px] font-bold px-2 py-0.5 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                                        :disabled="syncing"
                                        @click="syncHackatime"
                                    >
                                        {{ syncing ? "Syncing…" : "Sync" }}
                                    </button>
                                </div>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Trust Factor</span>
                                <span 
                                    class="text-xs font-bold px-2 py-0.5 border"
                                    :class="{
                                        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20': profileData.hackatimeTrustLevel?.toLowerCase() === 'green',
                                        'bg-blue-500/10 text-blue-400 border-blue-500/20': profileData.hackatimeTrustLevel?.toLowerCase() === 'blue',
                                        'bg-amber-500/10 text-amber-400 border-amber-500/20': profileData.hackatimeTrustLevel?.toLowerCase() === 'yellow',
                                        'bg-red-500/10 text-red-400 border-red-500/20': profileData.hackatimeTrustLevel?.toLowerCase() === 'red',
                                        'bg-zinc-800 text-zinc-500 border-zinc-700': !profileData.hackatimeTrustLevel,
                                    }"
                                >
                                    {{ profileData.hackatimeTrustLevel?.toUpperCase() ?? "—" }}
                                </span>
                            </div>
                            <p v-if="syncError" class="text-red-400 text-xs">
                                {{ syncError }}
                            </p>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Ships</span>
                                <span class="text-zinc-300"
                                    >{{ profileData.ships.length }} total ·
                                    {{ profileData.shippedShipCount }} shipped ·
                                    {{ profileData.pendingShipCount }} pending</span
                                >
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Last seen</span>
                                <span class="text-zinc-300 text-xs">{{
                                    profileData.last_seen_at
                                        ? new Date(
                                              profileData.last_seen_at,
                                          ).toLocaleString()
                                        : "—"
                                }}</span>
                            </div>
                            <div class="flex justify-between gap-4">
                                <span class="text-zinc-500">Joined at</span>
                                <span class="text-zinc-300 text-xs">{{
                                    new Date(
                                        profileData.createdAt,
                                    ).toLocaleString()
                                }}</span>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="canEditRoles"
                        class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                    >
                        <div class="flex items-center justify-between">
                            <h2
                                class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                            >
                                Roles
                            </h2>
                            <button
                                v-if="canEditRoles && !editingRoles"
                                class="text-xs text-zinc-400 hover:text-white transition-colors"
                                @click="startEditRoles"
                            >
                                Edit
                            </button>
                            <div v-else-if="editingRoles" class="flex gap-2">
                                <button
                                    class="text-xs text-zinc-400 hover:text-white transition-colors"
                                    @click="editingRoles = false"
                                >
                                    Cancel
                                </button>
                                <button
                                    class="text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-1 border border-white/10 transition-colors"
                                    :disabled="rolesSaving"
                                    @click="saveRoles"
                                >
                                    {{ rolesSaving ? "Saving…" : "Save" }}
                                </button>
                            </div>
                        </div>

                        <div v-if="!editingRoles">
                            <div
                                v-if="profileData.roles?.length"
                                class="flex flex-wrap gap-1.5"
                            >
                                <span
                                    v-for="role in profileData.roles"
                                    :key="role"
                                    class="px-2 py-0.5 text-[11px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700"
                                    >{{ role }}</span
                                >
                            </div>
                            <p v-else class="text-zinc-600 text-sm italic">
                                No roles assigned
                            </p>
                        </div>

                        <div v-else class="flex flex-col gap-3">
                            <div class="flex flex-wrap gap-2">
                                <button
                                    v-for="role in ALLOWED_ROLES"
                                    :key="role"
                                    class="px-2.5 py-1 text-[11px] font-bold border transition-all"
                                    :class="
                                        pendingRoles.includes(role)
                                            ? 'bg-white text-black border-white'
                                            : 'bg-transparent text-zinc-500 border-zinc-700 hover:border-zinc-500 hover:text-zinc-300'
                                    "
                                    @click="toggleRole(role)"
                                >
                                    {{ role }}
                                </button>
                            </div>
                            <p v-if="rolesError" class="text-red-400 text-xs">
                                {{ rolesError }}
                            </p>
                        </div>
                    </div>
                    </div>
                </div>

                <div
                    v-show="activeUserTab === 'overview'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <h2
                        class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                    >
                        Streak
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div class="flex justify-between gap-4">
                            <span class="text-zinc-500">Last active</span>
                            <span class="text-zinc-200 font-mono text-xs">
                                {{ profileData.last_active_date ?? "—" }}
                            </span>
                        </div>
                        <div class="flex justify-between gap-4">
                            <span class="text-zinc-500">Freezes</span>
                            <span class="text-zinc-200 font-mono text-xs">{{ profileData.streak_freezes_remaining ?? 0 }}/5</span>
                        </div>
                        <div class="flex justify-between gap-4">
                            <span class="text-zinc-500">Reminder</span>
                            <span class="text-zinc-300 text-xs">
                                {{ profileData.reminder_hours_before_day_end ?? 1 }}h before local day end
                                <span class="text-zinc-500 font-mono">({{ profileData.timezone ?? "UTC" }})</span>
                            </span>
                        </div>
                        <div class="flex justify-between gap-4">
                            <span class="text-zinc-500">Slack notifications</span>
                            <span class="text-zinc-300 text-xs">{{ profileData.streak_slack_notifications ? "on" : "off" }}</span>
                        </div>
                        <div class="flex justify-between gap-4">
                            <span class="text-zinc-500">Last sync</span>
                            <span class="text-zinc-300 text-xs">{{ profileData.last_hackatime_synced_at ? new Date(profileData.last_hackatime_synced_at).toLocaleString() : "—" }}</span>
                        </div>
                        <div class="flex justify-between gap-4 md:col-span-2">
                            <span class="text-zinc-500">Linked Hackatime names</span>
                            <span class="text-zinc-300 font-mono text-xs text-right break-all">
                                {{ profileData.linkedHackatimeNames.length ? profileData.linkedHackatimeNames.join(", ") : "—" }}
                            </span>
                        </div>
                    </div>

                    <div class="flex flex-col gap-2">
                        <p class="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Last 14 days (UTC) — click frozen days to refund</p>
                        <div class="flex gap-1 flex-wrap">
                            <button
                                v-for="cell in streakGridDays"
                                :key="cell.day"
                                type="button"
                                class="w-7 h-7 border flex items-center justify-center text-[9px] font-mono text-zinc-300 transition-colors"
                                :class="[
                                    streakCellClass(cell.row),
                                    cell.row?.status === 'frozen'
                                        ? 'cursor-pointer hover:ring-1 hover:ring-cyan-300'
                                        : 'cursor-default',
                                ]"
                                :disabled="cell.row?.status !== 'frozen'"
                                :title="streakCellTitle(cell.day, cell.row)"
                                @click="cell.row?.status === 'frozen' && openRefundModal(cell.day)"
                            >
                                {{ cell.day.slice(8) }}
                            </button>
                        </div>
                        <p
                            v-if="refundResult"
                            class="text-emerald-400 text-xs"
                        >
                            Refunded: live={{ refundResult.live_seconds }}s,
                            stored={{ refundResult.stored_seconds }}s,
                            journal={{ refundResult.journal_seconds }}s.
                        </p>
                        <div class="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                            <span class="flex items-center gap-1">
                                <span class="inline-block w-3 h-3 border border-emerald-500/40 bg-emerald-500/20" />
                                active
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="inline-block w-3 h-3 border border-dashed border-emerald-500/40 bg-emerald-500/10" />
                                active (synthetic backfill)
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="inline-block w-3 h-3 border border-amber-500/40 bg-amber-500/10" />
                                pending
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="inline-block w-3 h-3 border border-blue-500/40 bg-blue-500/15" />
                                frozen
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="inline-block w-3 h-3 border border-red-500/40 bg-red-500/15" />
                                missed
                            </span>
                            <span class="flex items-center gap-1">
                                <span class="inline-block w-3 h-3 border border-zinc-800 bg-zinc-950/40" />
                                no row
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    v-show="activeUserTab === 'projects'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <h2
                        class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                    >
                        Projects ({{ profileData.projects.length }})
                    </h2>
                    <div
                        v-if="profileData.projects.length === 0"
                        class="text-zinc-600 text-sm italic"
                    >
                        No projects yet
                    </div>
                    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <NuxtLink
                            v-for="project in profileData.projects"
                            :key="project.id"
                            :to="`/internal/projects/${project.id}`"
                            class="border border-zinc-800 bg-black/20 px-4 py-3 flex flex-col gap-2 hover:border-zinc-700 hover:bg-zinc-950/60 transition-colors"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p
                                        class="text-sm font-bold text-white truncate hover:text-amber-200 transition-colors block"
                                    >
                                        {{ project.name }}
                                    </p>
                                    <p class="text-xs text-zinc-500">
                                        {{
                                            project.created_at
                                                ? new Date(
                                                      project.created_at,
                                                  ).toLocaleDateString()
                                                : "Unknown date"
                                        }}
                                    </p>
                                </div>
                            </div>
                            <p class="text-sm text-zinc-300 line-clamp-3">
                                {{ project.description }}
                            </p>
                            <div class="flex flex-wrap gap-2 text-[11px] text-zinc-400">
                                <span v-if="project.level">Level {{ project.level }}</span>
                                <span v-if="project.stage">Stage {{ project.stage }}</span>
                                <span v-if="project.fruit">{{ project.fruit }}</span>
                                <span
                                    class="px-1.5 py-0.5 border"
                                    :class="(project.project_streak_days ?? 0) > 0 ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5' : 'border-zinc-700 text-zinc-500'"
                                >
                                    Streak {{ project.project_streak_days ?? 0 }}
                                    <span v-if="project.last_worked_date" class="text-zinc-500">· {{ project.last_worked_date }}</span>
                                    <span v-else class="text-zinc-500">· never</span>
                                </span>
                                <span
                                    v-if="project.hackatime_projects && project.hackatime_projects.length"
                                    class="px-1.5 py-0.5 border border-zinc-700 text-zinc-400 font-mono"
                                    :title="project.hackatime_projects.join(', ')"
                                >
                                    HT: {{ project.hackatime_projects.join(", ") }}
                                </span>
                            </div>
                            <div class="flex flex-wrap gap-3 text-xs">
                                <a
                                    v-if="project.repository_url"
                                    :href="project.repository_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                                    @click.stop
                                >
                                    Repository
                                </a>
                                <a
                                    v-if="project.demo_url"
                                    :href="project.demo_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                                    @click.stop
                                >
                                    Demo
                                </a>
                            </div>
                        </NuxtLink>
                    </div>
                </div>

                <div
                    v-if="canManageNotes"
                    v-show="activeUserTab === 'notes'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <div class="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <h2
                                class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                            >
                                Internal Notes
                            </h2>
                            <p class="text-xs text-zinc-600 mt-1">
                                Add important notes that other people checking this user may be important to read
                            </p>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="text-xs text-zinc-500">
                                {{ profileData.internalNotes.length }} notes
                            </span>
                            <button
                                class="text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-2 border border-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                :disabled="noteSaving"
                                @click="addInternalNote"
                            >
                                {{ noteSaving ? "Saving…" : "Add Note" }}
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-col gap-3">
                        <textarea
                            v-model="noteDraft"
                            rows="4"
                            maxlength="5000"
                            placeholder="Add an internal note about this user..."
                            class="w-full border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 resize-y min-h-[112px]"
                        />
                        <div class="flex items-center justify-between gap-4 flex-wrap">
                            <p v-if="noteError" class="text-red-400 text-xs">
                                {{ noteError }}
                            </p>
                        </div>
                    </div>

                    <div
                        v-if="profileData.internalNotes.length === 0"
                        class="text-zinc-600 text-sm italic"
                    >
                        No internal notes yet.
                    </div>

                    <div v-else class="flex flex-col gap-3">
                        <div
                            v-for="entry in profileData.internalNotes"
                            :key="entry.id"
                            class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3"
                        >
                            <div class="flex items-start justify-between gap-4 flex-wrap">
                                <div class="min-w-0">
                                    <p class="text-sm font-bold text-white">
                                        {{ entry.author?.name ?? "Unknown staff member" }}
                                    </p>
                                    <p class="text-xs text-zinc-500">
                                        {{
                                            new Date(
                                                entry.updated_at ?? entry.created_at ?? Date.now(),
                                            ).toLocaleString()
                                        }}
                                    </p>
                                </div>
                                <button
                                    class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    :disabled="isDeletingNote(entry.id)"
                                    @click="deleteInternalNote(entry.id)"
                                >
                                    {{ isDeletingNote(entry.id) ? "Deleting" : "Delete" }}
                                </button>
                            </div>
                            <p class="text-sm text-zinc-300 whitespace-pre-wrap">
                                <InternalLinkifyText :text="entry.note" />
                            </p>
                        </div>
                    </div>
                </div>

                <div v-show="activeUserTab === 'activity'" class="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                    <section class="border border-zinc-800 bg-zinc-900/40">
                        <button
                            class="w-full p-5 flex items-center justify-between gap-4 text-left"
                            @click="auditsOpen = !auditsOpen"
                        >
                            <div>
                                <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                    Audit Timeline
                                </h2>
                                <p class="text-xs text-zinc-600 mt-1">
                                    {{ profileData.audits.length }} events
                                </p>
                            </div>
                            <span class="text-zinc-500 text-xs font-bold">
                                {{ auditsOpen ? "Hide" : "Show" }}
                            </span>
                        </button>

                        <div v-if="auditsOpen" class="px-5 pb-5">
                            <div
                                v-if="profileData.audits.length === 0"
                                class="text-zinc-600 text-sm italic"
                            >
                                No audit events recorded for this user yet.
                            </div>
                            <div v-else class="flex flex-col gap-4">
                                <div
                                    v-for="entry in profileData.audits"
                                    :key="entry.id"
                                    class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3"
                                >
                                    <div class="flex items-start justify-between gap-4 flex-wrap">
                                        <div>
                                            <p class="text-sm font-bold text-white capitalize">
                                                {{ formatAuditTitle(entry) }}
                                            </p>
                                            <p class="text-xs text-zinc-500">
                                                {{
                                                    entry.created_at
                                                        ? new Date(entry.created_at).toLocaleString()
                                                        : "Unknown time"
                                                }}
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
                                            <InternalEntityRef
                                                v-if="entry.entity_id"
                                                :id="entry.entity_id"
                                                :type="entry.entity_type"
                                                hide-when-unlinkable
                                                class="text-xs"
                                            />
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <span
                                                class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-400"
                                            >
                                                {{ entry.action.replaceAll("_", " ") }}
                                            </span>
                                            <button
                                                class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors"
                                                @click="toggleAuditEntry(entry.id)"
                                            >
                                                {{ isAuditEntryOpen(entry.id) ? "Collapse" : "Expand" }}
                                            </button>
                                        </div>
                                    </div>

                                    <div v-if="isAuditEntryOpen(entry.id)" class="flex flex-col gap-3">
                                        <p
                                            v-if="entry.change_summary"
                                            class="text-sm text-zinc-300"
                                        >
                                            {{ entry.change_summary }}
                                        </p>

                                        <div
                                            v-if="changedFields(entry).length"
                                            class="flex flex-col gap-2"
                                        >
                                            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                                                Changed Fields
                                            </p>
                                            <div
                                                class="flex flex-col gap-2"
                                            >
                                                <div
                                                    v-for="field in changedFields(entry)"
                                                    :key="field"
                                                    class="border border-zinc-800 bg-zinc-950/60 p-3"
                                                >
                                                    <p class="text-xs font-bold text-zinc-200">
                                                        {{ field }}
                                                    </p>
                                                    <p class="text-xs text-zinc-500 mt-1">
                                                        From:
                                                        {{ formatFieldValue(entry.old_value?.[field]) }}
                                                    </p>
                                                    <p class="text-xs text-zinc-300 mt-1">
                                                        To:
                                                        {{ formatFieldValue(entry.new_value?.[field]) }}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section v-if="profileData.sessions" class="border border-zinc-800 bg-zinc-900/40">
                        <button
                            class="w-full p-5 flex items-center justify-between gap-4 text-left"
                            @click="sessionsOpen = !sessionsOpen"
                        >
                            <div>
                                <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                    Sessions &amp; IPs
                                </h2>
                                <p class="text-xs text-zinc-600 mt-1">
                                    {{ profileData.sessions.length }} sessions
                                    · {{ profileData.referralVisits?.length ?? 0 }} visits
                                    · {{ distinctIpCount }} distinct IPs
                                </p>
                            </div>
                            <span class="text-zinc-500 text-xs font-bold">
                                {{ sessionsOpen ? "Hide" : "Show" }}
                            </span>
                        </button>

                        <div v-if="sessionsOpen" class="px-5 pb-5 flex flex-col gap-6">
                            <div v-if="distinctIps.length > 0" class="border border-zinc-800 bg-black/20 p-4">
                                <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3">
                                    Distinct IPs ({{ distinctIpCount }})
                                </p>
                                <div class="flex flex-col gap-1 font-mono text-xs">
                                    <div
                                        v-for="row in distinctIps"
                                        :key="row.ip"
                                        class="flex items-center justify-between gap-3 text-zinc-300"
                                    >
                                        <span>{{ row.ip }}</span>
                                        <span class="text-zinc-500">{{ row.hits }} hit{{ row.hits === 1 ? "" : "s" }}</span>
                                    </div>
                                </div>
                            </div>
                            <div v-else class="text-zinc-600 text-sm italic">
                                No IPs captured yet for this user. Sessions created before the
                                IP-tracking patch landed will show "no ip"; future signins will
                                populate.
                            </div>

                            <div>
                                <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3">
                                    Sessions ({{ profileData.sessions.length }})
                                </p>
                                <div
                                    v-if="profileData.sessions.length === 0"
                                    class="text-zinc-600 text-sm italic"
                                >
                                    No sessions on file.
                                </div>
                                <div v-else class="flex flex-col gap-2">
                                    <div
                                        v-for="s in (showAllSessions ? profileData.sessions : profileData.sessions.slice(0, 20))"
                                        :key="s.id"
                                        class="border border-zinc-800 bg-black/20 p-3 flex flex-col gap-1"
                                    >
                                        <div class="flex items-center justify-between gap-3 flex-wrap">
                                            <p class="text-xs text-zinc-400">
                                                {{ new Date(s.created_at).toLocaleString() }}
                                                <span class="text-zinc-600">
                                                    · expires {{ new Date(s.expires_at).toLocaleDateString() }}
                                                </span>
                                            </p>
                                            <p class="font-mono text-xs">
                                                <span v-if="s.ip_address" class="text-amber-200">{{ s.ip_address }}</span>
                                                <span v-else class="text-zinc-600 italic">no ip</span>
                                            </p>
                                        </div>
                                        <div v-if="s.user_agent" class="font-mono text-xs text-zinc-500 break-all">
                                            <span v-if="isUaExpanded(s.id) || s.user_agent.length <= 120">
                                                {{ s.user_agent }}
                                            </span>
                                            <span v-else>{{ s.user_agent.slice(0, 120) }}…</span>
                                            <button
                                                v-if="s.user_agent.length > 120"
                                                class="ml-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white"
                                                @click="toggleUaId(s.id)"
                                            >
                                                {{ isUaExpanded(s.id) ? "less" : "more" }}
                                            </button>
                                        </div>
                                        <div v-else class="text-xs text-zinc-700 italic">no user agent</div>
                                    </div>
                                    <button
                                        v-if="profileData.sessions.length > 20"
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors self-start"
                                        @click="showAllSessions = !showAllSessions"
                                    >
                                        {{ showAllSessions ? "Collapse" : `Show all ${profileData.sessions.length}` }}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3">
                                    Referral Visits ({{ profileData.referralVisits?.length ?? 0 }})
                                </p>
                                <div
                                    v-if="!profileData.referralVisits || profileData.referralVisits.length === 0"
                                    class="text-zinc-600 text-sm italic"
                                >
                                    No referral visits captured for this user.
                                </div>
                                <div v-else class="flex flex-col gap-2">
                                    <div
                                        v-for="v in (showAllVisits ? profileData.referralVisits : profileData.referralVisits.slice(0, 20))"
                                        :key="v.id"
                                        class="border border-zinc-800 bg-black/20 p-3 flex flex-col gap-1"
                                    >
                                        <div class="flex items-center justify-between gap-3 flex-wrap">
                                            <p class="text-xs text-zinc-400">
                                                {{ new Date(v.created_at).toLocaleString() }}
                                                <span class="text-zinc-600">· {{ v.landing_path }}</span>
                                            </p>
                                            <p class="font-mono text-xs">
                                                <span v-if="v.ip_address" class="text-amber-200">{{ v.ip_address }}</span>
                                                <span v-else class="text-zinc-600 italic">no ip</span>
                                            </p>
                                        </div>
                                        <p
                                            v-if="v.referer"
                                            class="text-xs text-zinc-500 break-all"
                                        >
                                            ref: {{ v.referer }}
                                        </p>
                                        <p
                                            v-if="v.utm_source"
                                            class="text-[10px] uppercase tracking-widest text-zinc-600"
                                        >
                                            utm: {{ v.utm_source }}
                                        </p>
                                    </div>
                                    <button
                                        v-if="profileData.referralVisits.length > 20"
                                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors self-start"
                                        @click="showAllVisits = !showAllVisits"
                                    >
                                        {{ showAllVisits ? "Collapse" : `Show all ${profileData.referralVisits.length}` }}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="border border-zinc-800 bg-zinc-900/40">
                        <button
                            class="w-full p-5 flex items-center justify-between gap-4 text-left"
                            @click="transactionsOpen = !transactionsOpen"
                        >
                            <div>
                                <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                                    Transactions
                                </h2>
                                <p class="text-xs text-zinc-600 mt-1">
                                    {{ profileData.transactions.length }} entries
                                </p>
                            </div>
                            <span class="text-zinc-500 text-xs font-bold">
                                {{ transactionsOpen ? "Hide" : "Show" }}
                            </span>
                        </button>

                        <div v-if="transactionsOpen" class="px-5 pb-5">
                            <div
                                v-if="canGrantDevCurrency"
                                class="mb-4 border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3"
                            >
                                <div>
                                    <h3
                                        class="text-[10px] uppercase tracking-widest text-amber-300 font-bold"
                                    >
                                        Dev Currency Grant
                                    </h3>
                                    <p class="text-xs text-zinc-500 mt-1">
                                        Development-only manual balance adjustment for supaadmins.
                                    </p>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-3">
                                    <input
                                        v-model="devCurrencyAmount"
                                        type="number"
                                        min="1"
                                        step="1"
                                        inputmode="numeric"
                                        class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                                        placeholder="Amount"
                                    >
                                    <input
                                        v-model="devCurrencyMemo"
                                        type="text"
                                        maxlength="280"
                                        class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                                        placeholder="Optional reason for the audit trail"
                                    >
                                    <button
                                        class="text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-4 py-2 border border-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        :disabled="devCurrencySaving"
                                        @click="grantDevCurrency"
                                    >
                                        {{ devCurrencySaving ? "Granting…" : "Give Currency" }}
                                    </button>
                                </div>

                                <p v-if="devCurrencyError" class="text-red-400 text-xs">
                                    {{ devCurrencyError }}
                                </p>
                            </div>

                            <div
                                v-if="canAdjustGold"
                                class="mb-4 border border-zinc-800 bg-black/20 p-4 flex flex-col gap-3"
                            >
                                <div>
                                    <h3
                                        class="text-[10px] uppercase tracking-widest text-zinc-400 font-bold"
                                    >
                                        Manual Gold Adjustment
                                    </h3>
                                    <p class="text-xs text-zinc-500 mt-1">
                                        Add or subtract gold. The note is shown to the user as a
                                        notification, and the adjustment can be reversed later.
                                        Tag an award as Show and Tell to send celebratory copy
                                        instead (adds only).
                                    </p>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3">
                                    <input
                                        v-model="goldAdjustAmount"
                                        type="number"
                                        min="1"
                                        step="1"
                                        inputmode="numeric"
                                        class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                                        placeholder="Amount"
                                    >
                                    <input
                                        v-model="goldAdjustNote"
                                        type="text"
                                        maxlength="280"
                                        class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                                        placeholder="Note (required, shown to the user)"
                                    >
                                </div>

                                <div class="flex items-center gap-2">
                                    <label class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                                        Show and Tell
                                    </label>
                                    <select
                                        v-model="goldAdjustReason"
                                        class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
                                    >
                                        <option value="">Not a Show and Tell award</option>
                                        <option value="show_and_tell_won">Winner (celebratory notification)</option>
                                        <option value="show_and_tell_participated">Participant (thank-you notification)</option>
                                    </select>
                                </div>

                                <div class="flex flex-wrap gap-3">
                                    <button
                                        class="text-xs font-bold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-4 py-2 border border-emerald-500/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        :disabled="goldAdjustSaving"
                                        @click="adjustGold('add')"
                                    >
                                        {{ goldAdjustSaving ? "Saving…" : "Add gold" }}
                                    </button>
                                    <button
                                        class="text-xs font-bold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 border border-rose-500/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        :disabled="goldAdjustSaving || !!goldAdjustReason"
                                        @click="adjustGold('subtract')"
                                    >
                                        {{ goldAdjustSaving ? "Saving…" : "Subtract gold" }}
                                    </button>
                                </div>

                                <p v-if="goldAdjustError" class="text-red-400 text-xs">
                                    {{ goldAdjustError }}
                                </p>
                            </div>

                            <div
                                v-if="profileData.transactions.length === 0"
                                class="text-zinc-600 text-sm italic"
                            >
                                No currency transactions recorded for this user yet.
                            </div>
                            <div v-else class="flex flex-col gap-3">
                                <div
                                    v-for="entry in profileData.transactions"
                                    :key="entry.id"
                                    class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2"
                                >
                                    <div class="flex items-start justify-between gap-4">
                                        <div class="min-w-0">
                                            <p class="text-sm font-bold text-white capitalize">
                                                {{ entry.source.replaceAll("_", " ") }}
                                            </p>
                                            <p class="text-xs text-zinc-500">
                                                {{ new Date(entry.created_at).toLocaleString() }}
                                                <template v-if="entry.createdBy">
                                                    ·
                                                    <NuxtLink
                                                        :to="`/internal/users/${entry.createdBy.id}`"
                                                        class="text-zinc-300 hover:text-amber-200 transition-colors"
                                                    >
                                                        {{ entry.createdBy.name }}
                                                    </NuxtLink>
                                                </template>
                                            </p>
                                        </div>
                                        <span
                                            class="text-sm font-bold font-mono"
                                            :class="transactionAmountClass(entry)"
                                        >
                                            {{ transactionAmountLabel(entry) }}
                                        </span>
                                    </div>

                                    <p v-if="entry.memo" class="text-sm text-zinc-300">
                                        {{ entry.memo }}
                                    </p>

                                    <div class="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                                        <span>{{ entry.type }}</span>
                                        <InternalEntityRef v-if="entry.ship_id" :id="entry.ship_id" type="ship" />
                                        <InternalEntityRef v-if="entry.shop_order_id" :id="entry.shop_order_id" type="order" />
                                        <span v-if="!entry.counts">Excluded from balance</span>
                                        <button
                                            v-if="canAdjustGold && entry.source === 'admin_adjustment' && entry.counts && goldReverseState.txId !== entry.id"
                                            class="text-rose-300 hover:text-rose-200 font-bold transition-colors"
                                            @click="startGoldReverse(entry.id)"
                                        >
                                            Reverse
                                        </button>
                                    </div>

                                    <div
                                        v-if="goldReverseState.txId === entry.id"
                                        class="border border-zinc-800 bg-black/30 p-3 flex flex-col gap-2"
                                    >
                                        <input
                                            v-model="goldReverseState.note"
                                            type="text"
                                            maxlength="280"
                                            class="border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                                            placeholder="Optional reason (shown to the user)"
                                        >
                                        <div class="flex flex-wrap gap-3">
                                            <button
                                                class="text-xs font-bold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 border border-rose-500/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                :disabled="goldReverseState.saving"
                                                @click="confirmGoldReverse(entry.id)"
                                            >
                                                {{ goldReverseState.saving ? "Reversing…" : "Confirm reversal" }}
                                            </button>
                                            <button
                                                class="text-xs font-bold text-zinc-300 bg-white/5 hover:bg-white/10 px-4 py-2 border border-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                :disabled="goldReverseState.saving"
                                                @click="cancelGoldReverse"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                        <p v-if="goldReverseState.error" class="text-red-400 text-xs">
                                            {{ goldReverseState.error }}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <div
                    v-if="canManageGrants"
                    v-show="activeUserTab === 'finance'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <div class="flex items-center justify-between gap-3 flex-wrap">
                        <h2
                            class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                        >
                            HCB Grant Cards ({{ profileData.grants.length }})
                        </h2>
                        <NuxtLink
                            to="/internal/hcb"
                            class="text-xs text-zinc-500 hover:text-white transition-colors"
                        >
                            Open Grants Panel →
                        </NuxtLink>
                    </div>
                    <div
                        v-if="profileData.grants.length === 0"
                        class="text-zinc-600 text-sm italic"
                    >
                        No grant cards for this user.
                    </div>
                    <div v-else class="flex flex-col gap-2">
                        <div
                            v-for="grant in profileData.grants"
                            :key="grant.id"
                            class="flex flex-col gap-2 border border-zinc-800 bg-black/20 px-4 py-3"
                        >
                            <div class="flex items-start justify-between gap-4">
                                <div class="flex flex-col gap-1 flex-1 min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <NuxtLink
                                            :to="`/internal/projects/${grant.project_id}`"
                                            class="text-sm font-bold text-white hover:text-amber-200 transition-colors truncate"
                                        >
                                            {{ grant.project.name }}
                                        </NuxtLink>
                                        <span
                                            class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border"
                                            :class="{
                                                'border-emerald-500/30 bg-emerald-500/10 text-emerald-300':
                                                    grant.status === 'sent',
                                                'border-amber-500/30 bg-amber-500/10 text-amber-200':
                                                    grant.status === 'queued',
                                                'border-zinc-700 bg-zinc-800/40 text-zinc-400':
                                                    grant.status === 'cancelled',
                                            }"
                                        >
                                            {{ grant.status }}
                                        </span>
                                        <span class="text-sm font-bold text-white tabular-nums">
                                            {{ formatGrantDollars(grant.amount_cents) }}
                                        </span>
                                    </div>
                                    <div class="text-[11px] text-zinc-500 flex items-center gap-2 flex-wrap">
                                        <InternalEntityRef :id="grant.ship_id" type="ship" />
                                        <span v-if="grant.hcb_grant_id">· HCB #{{ grant.hcb_grant_id }}</span>
                                        <span v-if="grant.created_at">
                                            · {{ new Date(grant.created_at).toLocaleDateString() }}
                                        </span>
                                    </div>
                                    <div
                                        v-if="grant.cancel_reason"
                                        class="text-[11px] text-zinc-500 italic truncate max-w-full"
                                    >
                                        {{ grant.cancel_reason }}
                                    </div>
                                </div>
                                <div
                                    v-if="grant.status === 'queued' || grant.status === 'sent'"
                                    class="flex items-center gap-2 shrink-0"
                                >
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getGrantActionState(grant.id).loading"
                                        @click="startGrantCancel(grant.id, 'cancel-card')"
                                    >
                                        Cancel card
                                    </button>
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                                        :disabled="getGrantActionState(grant.id).loading"
                                        @click="startGrantCancel(grant.id, 'cancel-fruit')"
                                    >
                                        Cancel + give fruit
                                    </button>
                                </div>
                            </div>

                            <div
                                v-if="getGrantActionState(grant.id).mode !== null"
                                class="border border-zinc-700 bg-black/40 p-3 flex flex-col gap-2"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                                        {{ getGrantActionState(grant.id).mode === "cancel-card" ? "Cancel card (no payout)" : "Cancel and award equivalent fruit" }}
                                    </span>
                                    <button
                                        class="text-[11px] text-zinc-500 hover:text-white"
                                        :disabled="getGrantActionState(grant.id).loading"
                                        @click="cancelGrantAction(grant.id)"
                                    >
                                        Back
                                    </button>
                                </div>
                                <textarea
                                    :value="getGrantActionState(grant.id).reason"
                                    rows="2"
                                    placeholder="Justification (required)"
                                    class="bg-black/30 border border-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-y"
                                    :disabled="getGrantActionState(grant.id).loading"
                                    @input="setGrantActionState(grant.id, { reason: ($event.target as HTMLTextAreaElement).value, error: null })"
                                />
                                <div class="flex items-center justify-end gap-2">
                                    <button
                                        class="px-3 py-1.5 text-[11px] font-bold border transition-colors disabled:opacity-40"
                                        :class="getGrantActionState(grant.id).mode === 'cancel-fruit' ? 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10' : 'border-red-500/40 text-red-200 hover:bg-red-500/10'"
                                        :disabled="getGrantActionState(grant.id).loading || !getGrantActionState(grant.id).reason.trim()"
                                        @click="submitGrantCancel(grant.id)"
                                    >
                                        {{ getGrantActionState(grant.id).loading ? "..." : "Confirm" }}
                                    </button>
                                </div>
                            </div>

                            <p
                                v-if="getGrantActionState(grant.id).error"
                                class="text-[11px] text-red-300"
                            >
                                {{ getGrantActionState(grant.id).error }}
                            </p>
                        </div>
                    </div>
                </div>

                <div
                    v-if="canManageGrants"
                    v-show="activeUserTab === 'finance'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <div class="flex items-center justify-between gap-3 flex-wrap">
                        <h2
                            class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                        >
                            Shop Orders ({{ profileData.orders?.length ?? 0 }})
                        </h2>
                        <NuxtLink
                            to="/internal/orders"
                            class="text-xs text-zinc-500 hover:text-white transition-colors"
                        >
                            Open Orders Panel →
                        </NuxtLink>
                    </div>
                    <div
                        v-if="!profileData.orders || profileData.orders.length === 0"
                        class="text-zinc-600 text-sm italic"
                    >
                        No shop orders for this user.
                    </div>
                    <div v-else class="flex flex-col gap-2">
                        <div
                            v-for="order in profileData.orders"
                            :key="order.id"
                            class="flex flex-col gap-1 border border-zinc-800 bg-black/20 px-4 py-3"
                        >
                            <div class="flex items-start justify-between gap-3 flex-wrap">
                                <div class="flex flex-col gap-1 min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span class="text-sm font-bold text-white truncate">
                                            {{ order.item_snapshot?.name ?? "Unknown item" }}
                                        </span>
                                        <span
                                            class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border"
                                            :class="orderStatusClass(order.status)"
                                        >
                                            {{ order.status }}
                                        </span>
                                    </div>
                                    <div class="text-[11px] text-zinc-500 flex items-center gap-2 flex-wrap">
                                        <span>order #{{ order.id }}</span>
                                        <span v-if="order.quantity > 1">· qty {{ order.quantity }}</span>
                                        <span v-if="order.external_reference">· HCB #{{ order.external_reference }}</span>
                                        <span v-if="order.created_at">
                                            · {{ new Date(order.created_at).toLocaleDateString() }}
                                        </span>
                                    </div>
                                    <div
                                        v-if="order.fulfillment_error"
                                        class="text-[11px] text-red-300 italic truncate max-w-full"
                                    >
                                        {{ order.fulfillment_error }}
                                    </div>
                                </div>
                                <div class="text-right text-sm font-bold text-white tabular-nums shrink-0">
                                    {{ formatOrderPrice(order) }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    v-if="canManageGrants"
                    v-show="activeUserTab === 'finance'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <div class="flex items-center justify-between gap-3 flex-wrap">
                        <h2
                            class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                        >
                            Currency Transactions ({{ profileData.transactions.length }})
                        </h2>
                        <div class="text-xs text-zinc-500">
                            Gold: <span class="text-white font-bold">{{ profileData.currencyBalances.gold }}</span>
                        </div>
                    </div>
                    <div
                        v-if="profileData.transactions.length === 0"
                        class="text-zinc-600 text-sm italic"
                    >
                        No currency transactions.
                    </div>
                    <div v-else class="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
                        <div
                            v-for="entry in profileData.transactions"
                            :key="entry.id"
                            class="flex items-start justify-between gap-3 border border-zinc-800 bg-black/20 px-3 py-2"
                        >
                            <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div class="flex items-center gap-2 flex-wrap text-[11px]">
                                    <span class="font-bold text-zinc-300">{{ entry.source }}</span>
                                    <InternalEntityRef v-if="entry.ship_id" :id="entry.ship_id" type="ship" />
                                    <InternalEntityRef v-if="entry.shop_order_id" :id="entry.shop_order_id" type="order" />
                                    <span v-if="!entry.counts" class="text-amber-400">excluded</span>
                                </div>
                                <div
                                    v-if="entry.memo"
                                    class="text-[11px] text-zinc-500 truncate"
                                >
                                    {{ entry.memo }}
                                </div>
                                <div class="text-[10px] text-zinc-600">
                                    {{ new Date(entry.created_at).toLocaleString() }}
                                </div>
                            </div>
                            <div
                                class="text-sm font-bold tabular-nums shrink-0"
                                :class="entry.type === 'increase' ? 'text-emerald-300' : 'text-red-300'"
                            >
                                {{ entry.type === "increase" ? "+" : "-" }}{{ entry.amount }}
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    v-if="profileData.shadowBans.length"
                    v-show="activeUserTab === 'activity'"
                    class="border border-red-500/20 bg-red-500/5 p-5 flex flex-col gap-3"
                >
                    <h2
                        class="text-xs uppercase tracking-widest text-red-400 font-bold"
                    >
                        Shadow Ban History
                    </h2>
                    <div
                        v-for="ban in profileData.shadowBans"
                        :key="ban.id"
                        class="flex flex-col gap-0.5 border-t border-red-500/10 pt-3"
                    >
                        <p class="text-sm text-zinc-200">{{ ban.reason }}</p>
                        <p class="text-xs text-zinc-500">
                            {{ new Date(ban.created_at).toLocaleString() }}
                        </p>
                    </div>
                </div>

                <div
                    v-if="profileData.macondoBans?.length"
                    v-show="activeUserTab === 'activity'"
                    class="border border-red-600/30 bg-red-600/5 p-5 flex flex-col gap-3"
                >
                    <h2
                        class="text-xs uppercase tracking-widest text-red-300 font-bold"
                    >
                        Macondo Ban History
                    </h2>
                    <div
                        v-for="ban in profileData.macondoBans"
                        :key="ban.id"
                        class="flex flex-col gap-0.5 border-t border-red-600/10 pt-3"
                    >
                        <div class="flex items-center gap-2">
                            <span
                                class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border"
                                :class="
                                    ban.active &&
                                    (!ban.expires_at ||
                                        new Date(ban.expires_at) > new Date())
                                        ? 'text-red-300 border-red-600/40 bg-red-600/10'
                                        : 'text-zinc-500 border-zinc-700'
                                "
                                >{{
                                    ban.active &&
                                    (!ban.expires_at ||
                                        new Date(ban.expires_at) > new Date())
                                        ? "Active"
                                        : "Lifted/Expired"
                                }}</span
                            >
                            <span
                                class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-zinc-700 text-zinc-400"
                                >{{ ban.expires_at ? "Temp" : "Perm" }}</span
                            >
                        </div>
                        <p class="text-sm text-zinc-200 mt-1">{{ ban.reason }}</p>
                        <p class="text-xs text-zinc-500">
                            {{ ban.created_at ? new Date(ban.created_at).toLocaleString() : "—" }}
                            <template v-if="ban.expires_at">
                                · expires {{ new Date(ban.expires_at).toLocaleString() }}
                            </template>
                        </p>
                    </div>
                </div>

                <div
                    v-show="activeUserTab === 'projects'"
                    class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4"
                >
                    <h2
                        class="text-xs uppercase tracking-widest text-zinc-500 font-bold"
                    >
                        Ships ({{ profileData.ships.length }})
                    </h2>
                    <div
                        v-if="profileData.ships.length === 0"
                        class="text-zinc-600 text-sm italic"
                    >
                        No ships yet
                    </div>
                    <div v-else class="flex flex-col gap-2">
                        <div
                            v-for="{ ship, project } in profileData.ships"
                            :key="ship.id"
                            class="flex items-start justify-between gap-4 border border-zinc-800 bg-black/20 px-4 py-3"
                        >
                            <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                                <span
                                    class="text-sm font-bold text-white truncate"
                                    >{{
                                        project?.name ?? "Unknown Project"
                                    }}</span
                                >
                                <span class="text-xs text-zinc-500"
                                    >{{ ship.hackatime_hours ?? 0 }}h ·
                                    {{
                                        ship.created_at
                                            ? new Date(
                                                  ship.created_at,
                                              ).toLocaleDateString()
                                            : "unknown date"
                                    }}</span
                                >
                            </div>
                            <span
                                class="text-[10px] font-bold px-2 py-0.5 border flex-shrink-0"
                                :class="shipStatusClass(ship.status)"
                                >{{ shipStatusLabel(ship.status) }}</span
                            >
                        </div>
                    </div>
                </div>
            </template>

            <div v-else-if="fetchError" class="text-red-400 text-sm">
                Failed to load profile.
            </div>
        </div>

        <Transition name="modal-fade" appear>
            <div
                v-if="refundModal"
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                @click.self="refundModal = false"
            >
                <div
                    class="modal-fade-panel relative bg-zinc-950 border border-zinc-800 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
                >
                    <h2 class="text-white font-bold">
                        Refund streak freeze for {{ refundDay }}
                    </h2>
                    <p class="text-zinc-400 text-sm">
                        Hackatime data will be re-verified before applying.
                        On confirm, the day flips to <span class="text-emerald-400 font-mono">active</span>
                        and one freeze is returned to {{ profileData?.name }}.
                    </p>
                    <div class="flex flex-col gap-1.5">
                        <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Reason</label>
                        <textarea
                            v-model="refundReason"
                            rows="3"
                            placeholder="e.g. Slack ticket, user qualified per Hackatime but freeze burned during sync race"
                            class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
                        />
                    </div>
                    <p v-if="refundError" class="text-red-400 text-xs">
                        {{ refundError }}
                    </p>
                    <div class="flex gap-2 justify-end">
                        <button
                            class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
                            @click="refundModal = false"
                        >
                            Cancel
                        </button>
                        <button
                            class="text-sm font-bold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 px-4 py-2 transition-colors disabled:opacity-50"
                            :disabled="refundSaving || refundReason.trim().length < 3"
                            @click="doRefund"
                        >
                            {{ refundSaving ? "Refunding…" : "Refund freeze" }}
                        </button>
                    </div>
                </div>
            </div>
        </Transition>

        <Transition name="modal-fade" appear>
            <div
                v-if="shadowBanModal"
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                @click.self="shadowBanModal = false"
            >
                <div
                    class="modal-fade-panel relative bg-zinc-950 border border-zinc-800 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
                >
                <h2 class="text-white font-bold">
                    Shadow Ban {{ profileData?.name }}
                </h2>
                <p class="text-zinc-400 text-sm">
                    The user will still be able to ship, but their submissions
                    will be routed to fraud-only review.
                </p>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Reason</label>
                    <textarea
                        v-model="shadowBanReason"
                        rows="3"
                        placeholder="e.g. Suspected fake Hackatime hours"
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
                    />
                </div>
                <p v-if="shadowBanError" class="text-red-400 text-xs">
                    {{ shadowBanError }}
                </p>
                <div class="flex gap-2 justify-end">
                    <button
                        class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
                        @click="shadowBanModal = false"
                    >
                        Cancel
                    </button>
                    <button
                        class="text-sm font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 px-4 py-2 transition-colors"
                        :disabled="shadowBanSaving"
                        @click="applyShadowBan"
                    >
                        {{ shadowBanSaving ? "Applying…" : "Apply Ban" }}
                    </button>
                </div>
            </div>
        </div>
        </Transition>

        <Transition name="modal-fade" appear>
            <div
                v-if="macondoBanModal"
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                @click.self="macondoBanModal = false"
            >
                <div
                    class="modal-fade-panel relative bg-zinc-950 border border-red-600 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
                >
                <h2 class="text-red-200 font-bold text-lg">
                    Ban {{ profileData?.name }}
                </h2>
                <p class="text-zinc-300 text-sm">
                    Blocks <strong>all app access</strong> (the user sees a banned
                    message) and removes them from the Macondo Slack channel via
                    the bot, re-kicking them every time they rejoin.
                </p>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Duration</label>
                    <div class="flex gap-2">
                        <button
                            type="button"
                            class="flex-1 text-sm font-bold px-3 py-2 border transition-colors"
                            :class="macondoBanType === 'perm' ? 'border-red-500 text-red-300 bg-red-600/10' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'"
                            @click="macondoBanType = 'perm'"
                        >
                            Permanent
                        </button>
                        <button
                            type="button"
                            class="flex-1 text-sm font-bold px-3 py-2 border transition-colors"
                            :class="macondoBanType === 'temp' ? 'border-red-500 text-red-300 bg-red-600/10' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'"
                            @click="macondoBanType = 'temp'"
                        >
                            Temporary
                        </button>
                    </div>
                </div>
                <div v-if="macondoBanType === 'temp'" class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Expires in (hours)</label>
                    <input
                        v-model.number="macondoBanHours"
                        type="number"
                        min="1"
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 w-full"
                    />
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Reason (shown to the user)</label>
                    <textarea
                        v-model="macondoBanReason"
                        rows="3"
                        placeholder="e.g. Repeated harassment in the Slack channel"
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
                    />
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                        Remove gold (% of balance)
                    </label>
                    <input
                        v-model.number="macondoBanGoldPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        placeholder="0"
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 w-full"
                    />
                    <p class="text-[11px] text-zinc-500">
                        Balance: {{ profileData?.currencyBalances?.gold ?? 0 }} gold.
                        <span v-if="macondoBanGoldPercent > 0" class="text-amber-400">
                            Removes ~{{ macondoBanGoldPreview }} gold. The bot DMs the user the percentage and total removed.
                        </span>
                        <span v-else>Leave at 0 to keep their gold.</span>
                    </p>
                </div>
                <p v-if="macondoBanError" class="text-red-400 text-xs">
                    {{ macondoBanError }}
                </p>
                <div class="flex gap-2 justify-end">
                    <button
                        class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
                        @click="macondoBanModal = false"
                    >
                        Cancel
                    </button>
                    <button
                        class="text-sm font-bold bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-600/40 px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-wait"
                        :disabled="macondoBanSaving"
                        @click="applyMacondoBan"
                    >
                        {{ macondoBanSaving ? "Banning…" : "Ban user" }}
                    </button>
                </div>
            </div>
        </div>
        </Transition>

        <Transition name="modal-fade" appear>
            <div
                v-if="nukeModal"
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                @click.self="nukeModal = false"
            >
            <div
                class="modal-fade-panel relative bg-zinc-950 border border-red-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
            >
                <h2 class="text-red-200 font-bold text-lg">
                    Nuke {{ profileData?.name }}
                </h2>
                <p class="text-zinc-300 text-sm">
                    <strong class="text-red-400">This is destructive.</strong>
                    Every project, ship, order, grant, notification, note, and
                    audit row tied to this user will be hard-deleted.
                    A JSON backup is saved so you can restore within the
                    backups admin page, but any new data created by other
                    users that referenced them will be orphaned (null'd).
                </p>
                <p v-if="isSelfView" class="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 p-2">
                    You are nuking <strong>your own account</strong>. You will be
                    logged out immediately. Only another supaadmin can restore you.
                </p>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Reason (optional)</label>
                    <textarea
                        v-model="nukeReason"
                        rows="2"
                        placeholder="e.g. account takeover, requested by user"
                        class="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:outline-none focus:border-zinc-500 resize-none w-full"
                    />
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                        Type <span class="text-red-400 font-mono">NUKE</span> to confirm
                    </label>
                    <input
                        v-model="nukeConfirmText"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        class="bg-zinc-900 border border-red-700 text-zinc-100 text-sm font-mono px-3 py-2 focus:outline-none focus:border-red-500 w-full"
                    >
                </div>
                <p v-if="nukeError" class="text-red-400 text-xs">{{ nukeError }}</p>
                <div class="flex gap-2 justify-end">
                    <button
                        class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
                        @click="nukeModal = false"
                    >
                        Cancel
                    </button>
                    <button
                        class="text-sm font-bold bg-red-700/40 text-red-100 hover:bg-red-700/60 border border-red-700 px-4 py-2 transition-colors disabled:opacity-50"
                        :disabled="nukeSaving || nukeConfirmText.trim() !== 'NUKE'"
                        @click="doNukeUser"
                    >
                        {{ nukeSaving ? "Nuking…" : "Nuke user" }}
                    </button>
                </div>
            </div>
        </div>
        </Transition>
    </div>
</template>
