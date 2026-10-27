<script setup lang="ts">
const { user, isLoggedIn, loading, signIn, signOut } = useAuth();
</script>

<template>
    <div v-if="loading" class="text-ds-brown/50 text-sm animate-pulse">
        {{ $t("common.loading") }}...
    </div>

    <div v-else-if="isLoggedIn && user" class="flex items-center gap-3">
        <img
            v-if="user.image"
            :src="user.image as string"
            class="w-8 h-8 rounded-full border-2 border-ds-brown/30"
            alt="avatar"
        >
        <div
            v-else
            class="w-8 h-8 rounded-full border-2 border-ds-brown bg-ds-brown flex items-center justify-center text-[10px] font-bold text-ds-cream"
        >
            {{
                ((user.username as string) ?? (user.email as string) ?? "?")
                    .charAt(0)
                    .toUpperCase()
            }}
        </div>
        <span class="text-sm text-ds-brown font-medium hidden lg:inline">
            {{ (user.username as string) ?? (user.email as string) }}
        </span>
        <button
            class="ds-btn-ghost text-xs !px-3 !py-1.5"
            @click="signOut"
        >
            {{ $t("common.sign_out") }}
        </button>
    </div>

    <button
        v-else
        class="ds-btn-primary text-sm"
        @click="signIn"
    >
        {{ $t("auth.sign_in_with_hackclub") }}
    </button>
</template>
