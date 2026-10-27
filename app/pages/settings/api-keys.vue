<script setup lang="ts">
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-vue-next";

definePageMeta({
    layout: false,
});

const { isLoggedIn, loading } = useAuth();
const { t } = useI18n();

if (import.meta.client) {
    watch(
        [isLoggedIn, loading],
        ([loggedIn, isLoading]) => {
            if (!isLoading && !loggedIn) navigateTo("/");
        },
        { immediate: true },
    );
}

interface ApiKeyListItem {
  id: string;
  label: string;
  last4: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

const { data: keysData, refresh: refreshKeys } = useLazyFetch<{ keys: ApiKeyListItem[] }>(
    "/api/user/api-keys",
    { key: "settings-api-keys", default: () => ({ keys: [] }) },
);
const keys = computed(() => keysData.value?.keys ?? []);

// Expired keys don't count against the cap, mirroring the server (index.post.ts).
function isExpired(key: ApiKeyListItem): boolean {
    return !!key.expires_at && new Date(key.expires_at).getTime() <= Date.now();
}

// Mirrors MAX_ACTIVE_API_KEYS on the server, which re-checks.
const MAX_KEYS = 5;
const activeKeyCount = computed(() => keys.value.filter((k) => !isExpired(k)).length);
const atKeyCap = computed(() => activeKeyCount.value >= MAX_KEYS);

const newLabel = ref("");
const newExpiryDays = ref<string>("never");
const creating = ref(false);
const createError = ref<string | null>(null);

// Shown-once token lives only in these refs; tracked by id since labels aren't unique.
const mintedToken = ref<string | null>(null);
const mintedLabel = ref<string | null>(null);
const mintedId = ref<string | null>(null);
const copied = ref(false);

async function createKey() {
    if (creating.value) return;
    creating.value = true;
    createError.value = null;
    try {
        const res = await $fetch<{ id: string; token: string; label: string }>("/api/user/api-keys", {
            method: "POST",
            body: {
                label: newLabel.value,
                days: newExpiryDays.value === "never" ? null : Number(newExpiryDays.value),
            },
        });
        mintedToken.value = res.token;
        mintedLabel.value = res.label;
        mintedId.value = res.id;
        copied.value = false;
        newLabel.value = "";
        await refreshKeys();
    } catch (error) {
        const fetchError = error as { data?: { statusMessage?: string }; statusMessage?: string };
        createError.value =
            fetchError?.data?.statusMessage ?? fetchError?.statusMessage ?? t("apiKeys.create_failed");
    } finally {
        creating.value = false;
    }
}

async function copyToken() {
    if (!mintedToken.value) return;
    try {
        await navigator.clipboard.writeText(mintedToken.value);
        copied.value = true;
        setTimeout(() => (copied.value = false), 1500);
    } catch {
        // Clipboard may be unavailable; the token is still selectable in the box.
    }
}

// Inline confirm modal: never window.confirm on public UI.
const revokeTarget = ref<ApiKeyListItem | null>(null);
const revoking = ref(false);

async function confirmRevoke() {
    const target = revokeTarget.value;
    if (!target || revoking.value) return;
    revoking.value = true;
    try {
        await $fetch(`/api/user/api-keys/${target.id}`, { method: "DELETE" });
        // Compare by id: a same-labelled key must not wipe an uncopied token.
        if (mintedId.value === target.id) {
            mintedToken.value = null;
            mintedLabel.value = null;
            mintedId.value = null;
        }
        await refreshKeys();
    } catch (error) {
        console.error("[api-keys] revoke failed", error);
    } finally {
        revoking.value = false;
        revokeTarget.value = null;
    }
}

function formatDate(value: string | null): string {
    if (!value) return "";
    return new Date(value).toLocaleDateString();
}
</script>

<template>
    <div class="min-h-screen bg-parchment">
        <div class="max-w-3xl mx-auto px-4 py-10">
            <h1 class="font-title text-4xl text-ds-brown mb-2 flex items-center gap-3">
                <KeyRound :size="32" />
                {{ $t("apiKeys.title") }}
            </h1>
            <p class="text-ds-brown/80 mb-2">{{ $t("apiKeys.description") }}</p>
            <p class="text-sm text-ds-brown/60 mb-8">
                {{ $t("apiKeys.read_only_note") }}
                <NuxtLink to="/docs/api-keys" class="underline hover:text-ds-brown">{{ $t("apiKeys.docs_link") }}</NuxtLink>
            </p>

            <div v-if="mintedToken" class="border-[3px] border-ds-brown bg-ds-brown/5 p-4 mb-8">
                <p class="text-sm font-bold text-ds-brown mb-2">
                    {{ $t("apiKeys.minted_title", { label: mintedLabel }) }}
                </p>
                <div class="flex flex-col sm:flex-row gap-2 items-stretch">
                    <code class="flex-1 min-w-0 break-all bg-parchment border-[3px] border-ds-brown/40 px-3 py-2 text-sm text-ds-brown select-all">{{ mintedToken }}</code>
                    <button class="ds-btn-primary text-sm !px-4 shrink-0 inline-flex items-center gap-2" @click="copyToken">
                        <Check v-if="copied" :size="16" />
                        <Copy v-else :size="16" />
                        {{ copied ? $t("apiKeys.copied") : $t("apiKeys.copy") }}
                    </button>
                </div>
                <p class="text-xs font-semibold text-ds-danger mt-2">{{ $t("apiKeys.minted_warning") }}</p>
            </div>

            <div class="border-[3px] border-ds-brown p-4 mb-8">
                <h2 class="text-lg font-bold text-ds-brown mb-3">{{ $t("apiKeys.create_key") }}</h2>
                <div class="flex flex-col sm:flex-row gap-3 sm:items-end">
                    <label class="flex-1 flex flex-col gap-1">
                        <span class="text-xs font-semibold text-ds-brown/70">{{ $t("apiKeys.label") }}</span>
                        <input
                            v-model="newLabel"
                            class="ds-input w-full"
                            :placeholder="$t('apiKeys.label_placeholder')"
                            maxlength="64"
                            @keydown.enter="createKey"
                        >
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-xs font-semibold text-ds-brown/70">{{ $t("apiKeys.expiry") }}</span>
                        <select v-model="newExpiryDays" class="ds-input">
                            <option value="never">{{ $t("apiKeys.expiry_never") }}</option>
                            <option value="30">{{ $t("apiKeys.expiry_days", { days: 30 }) }}</option>
                            <option value="90">{{ $t("apiKeys.expiry_days", { days: 90 }) }}</option>
                            <option value="365">{{ $t("apiKeys.expiry_days", { days: 365 }) }}</option>
                        </select>
                    </label>
                    <button
                        class="ds-btn-primary inline-flex items-center gap-2 shrink-0"
                        :disabled="creating || atKeyCap"
                        @click="createKey"
                    >
                        <Plus :size="16" />
                        {{ creating ? $t("apiKeys.creating") : $t("apiKeys.create") }}
                    </button>
                </div>
                <p v-if="atKeyCap" class="text-xs text-ds-brown/60 mt-2">
                    {{ $t("apiKeys.max_keys_reached", { max: MAX_KEYS }) }}
                </p>
                <p v-if="createError" class="text-xs font-semibold text-ds-danger mt-2">{{ createError }}</p>
            </div>

            <h2 class="text-lg font-bold text-ds-brown mb-3">{{ $t("apiKeys.your_keys") }}</h2>
            <p v-if="keys.length === 0" class="text-sm text-ds-brown/60">{{ $t("apiKeys.no_keys") }}</p>
            <div v-else class="flex flex-col gap-3">
                <div
                    v-for="key in keys"
                    :key="key.id"
                    class="flex items-center justify-between gap-3 bg-ds-brown/5 border-2 border-ds-brown/20 px-4 py-3"
                >
                    <div class="flex flex-col min-w-0">
                        <span class="text-sm font-semibold text-ds-brown truncate">
                            {{ key.label }}
                            <span v-if="isExpired(key)" class="ml-2 text-xs font-bold text-ds-danger">{{ $t("apiKeys.expired") }}</span>
                        </span>
                        <span class="text-xs text-ds-brown/60 font-mono">macondo_pat_...{{ key.last4 }}</span>
                        <span class="text-xs text-ds-brown/50">
                            {{ $t("apiKeys.created", { date: formatDate(key.created_at) }) }}
                            · {{ key.last_used_at ? $t("apiKeys.last_used", { date: formatDate(key.last_used_at) }) : $t("apiKeys.never_used") }}
                            <template v-if="key.expires_at"> · {{ $t("apiKeys.expires", { date: formatDate(key.expires_at) }) }}</template>
                        </span>
                    </div>
                    <button
                        class="text-xs font-semibold text-ds-danger/60 hover:text-ds-danger transition-colors inline-flex items-center gap-1 shrink-0"
                        @click="revokeTarget = key"
                    >
                        <Trash2 :size="14" />
                        {{ $t("apiKeys.revoke") }}
                    </button>
                </div>
            </div>
        </div>

        <div
            v-if="revokeTarget"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            @click.self="revokeTarget = null"
        >
            <div class="bg-parchment border-[3px] border-ds-brown p-5 max-w-md w-full">
                <h3 class="text-lg font-bold text-ds-brown mb-2">{{ $t("apiKeys.revoke_confirm_title") }}</h3>
                <p class="text-sm text-ds-brown/80 mb-4">
                    {{ $t("apiKeys.revoke_confirm_body", { label: revokeTarget.label }) }}
                </p>
                <div class="flex justify-end gap-2">
                    <button class="ds-btn-ghost text-sm" :disabled="revoking" @click="revokeTarget = null">
                        {{ $t("apiKeys.cancel") }}
                    </button>
                    <button class="ds-btn-danger text-sm" :disabled="revoking" @click="confirmRevoke">
                        {{ revoking ? $t("apiKeys.revoking") : $t("apiKeys.revoke") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
