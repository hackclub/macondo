<script setup lang="ts">
definePageMeta({ layout: "internal" });

type HcbStatus = {
    connected: boolean;
    hcbOrganizationIdConfigured: boolean;
    directApiTokenConfigured: boolean;
    oauthClientConfigured: boolean;
    connection: {
        tokenType: string | null;
        scope: string | null;
        expiresAt: string | null;
        isExpired: boolean;
        externalUserId: string | null;
        externalUserEmail: string | null;
        connectedBy: {
            id: string;
            name: string;
            email: string;
            image: string | null;
        } | null;
        createdAt: string | null;
        updatedAt: string | null;
    } | null;
};

const route = useRoute();
const disconnecting = ref(false);
const disconnectError = ref("");

const {
    data: status,
    pending,
    error,
    refresh,
} = await useFetch<HcbStatus>("/api/internal/hcb/status", {
    server: false,
});

const connectedMessage = computed(() =>
    route.query.hcb === "connected"
        ? "HCB is connected. New grant orders will use this account."
        : "",
);

function formatDate(value: string | null | undefined) {
    return value ? new Date(value).toLocaleString() : "Not available";
}

async function disconnectHcb() {
    if (!confirm("Disconnect the stored HCB grant provider account? New HCB grants will fail until this is reconnected.")) {
        return;
    }

    disconnecting.value = true;
    disconnectError.value = "";

    try {
        await $fetch("/api/internal/hcb/disconnect", { method: "DELETE" });
        await refresh();
    } catch (error) {
        console.error(error);
        disconnectError.value = "Failed to disconnect HCB.";
    } finally {
        disconnecting.value = false;
    }
}
</script>

<template>
    <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
        <div class="max-w-5xl mx-auto flex flex-col gap-6">
            <div class="flex flex-col gap-2">
                <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Internal Setup</p>
                <h1 class="text-3xl font-bold text-white tracking-tight">HCB Grants</h1>
                <p class="text-sm text-zinc-400 max-w-3xl">
                    API Keys? Barely know 'er!
                </p>
                <p class="text-xs text-zinc-500">
                    Looking for the grant queue?
                    <NuxtLink to="/internal/grants" class="text-zinc-300 hover:text-white underline underline-offset-2">
                        Open the Grants panel →
                    </NuxtLink>
                </p>
            </div>

            <p
                v-if="connectedMessage"
                class="border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
            >
                {{ connectedMessage }}
            </p>

            <p
                v-if="disconnectError"
                class="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200"
            >
                {{ disconnectError }}
            </p>

            <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-5">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Connection</p>
                        <h2 class="text-xl font-bold text-white">
                            {{ status?.connected ? "HCB account connected" : "No HCB account connected" }}
                        </h2>
                    </div>

                    <span
                        class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border"
                        :class="status?.connected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 text-zinc-400'"
                    >
                        {{ status?.connected ? "Ready" : "Setup Needed" }}
                    </span>
                </div>

                <p v-if="pending" class="text-sm text-zinc-500">Loading HCB status...</p>
                <p v-else-if="error" class="text-sm text-red-300">Failed to load HCB status.</p>

                <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Provider Account</span>
                        <span class="font-semibold text-white">
                            {{ status?.connection?.externalUserEmail ?? status?.connection?.externalUserId ?? "Not connected" }}
                        </span>
                    </div>

                    <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Connected By</span>
                        <span class="font-semibold text-white">
                            {{ status?.connection?.connectedBy?.name ?? "Not connected" }}
                        </span>
                    </div>

                    <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Token Expiry</span>
                        <span class="font-semibold" :class="status?.connection?.isExpired ? 'text-red-300' : 'text-white'">
                            {{ formatDate(status?.connection?.expiresAt) }}
                        </span>
                    </div>

                    <div class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Organization ID</span>
                        <span class="font-semibold" :class="status?.hcbOrganizationIdConfigured ? 'text-white' : 'text-red-300'">
                            {{ status?.hcbOrganizationIdConfigured ? "Configured" : "Missing HCB_ORGANIZATION_ID" }}
                        </span>
                    </div>
                </div>

                <div class="border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Authorize an HCB account that has permission to create card grants in the configured HCB organization. Grant purchases will use this account to create the virtual card and send it to the buyer.
                </div>

                <div
                    v-if="status && !status.oauthClientConfigured"
                    class="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200"
                >
                    HCB OAuth UID and secret must be configured before setup can start.
                </div>

                <div class="flex items-center gap-3 flex-wrap">
                    <a
                        href="/api/internal/hcb/login"
                        class="px-4 py-2.5 text-sm font-bold border border-amber-400 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors"
                        :class="{ 'pointer-events-none opacity-50': status && !status.oauthClientConfigured }"
                    >
                        {{ status?.connected ? "Reconnect HCB Account" : "Connect HCB Account" }}
                    </a>

                    <button
                        v-if="status?.connected"
                        class="px-4 py-2.5 text-sm font-bold border border-zinc-700 text-zinc-300 hover:text-white hover:border-white transition-colors disabled:opacity-60"
                        :disabled="disconnecting"
                        @click="disconnectHcb"
                    >
                        {{ disconnecting ? "Disconnecting..." : "Disconnect" }}
                    </button>
                </div>
            </section>
        </div>
    </div>
</template>
