<script setup lang="ts">
const { user, signOut } = useAuth();
const { navbarBg } = useNightMode();
const { t } = useI18n();

const displayName = computed(
    () =>
        user.value?.name ||
        user.value?.username ||
        user.value?.email ||
        t("common.user_fallback"),
);
</script>

<template>
    <header
        class="fixed top-0 left-0 right-0 z-50 border-b border-ds-brown/30 backdrop-blur-md transition-colors duration-700"
        :style="{ backgroundColor: navbarBg }"
    >
        <div
            class="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between"
        >
            <div class="flex items-center gap-6">
                <NuxtLink
                    to="/dashboard"
                    class="text-lg font-bold tracking-tight text-ds-cream"
                >
                    macondo
                </NuxtLink>
                <nav class="flex items-center gap-4">
                    <NuxtLink
                        to="/dashboard"
                        class="text-sm font-medium text-ds-cream/60 hover:text-ds-cream transition-colors"
                        active-class="!text-ds-cream"
                    >
                        {{ $t("nav.dashboard") }}
                    </NuxtLink>
                </nav>
            </div>

            <div class="flex items-center gap-3">
                <ClientOnly>
                    <NotificationBell v-if="user" />
                </ClientOnly>
                <NightModeToggle />
                <LanguageSwitcher />
                <img
                    v-if="user?.image"
                    :src="user.image as string"
                    class="w-7 h-7 rounded-full border border-ds-cream/30"
                    alt="avatar"
                >
                <span class="text-sm text-ds-cream hidden sm:inline">{{
                    displayName
                }}</span>
                <button
                    class="text-xs text-ds-cream/60 hover:text-ds-cream border border-ds-cream/20 px-3 py-1.5 rounded-[60px] transition-colors"
                    @click="signOut"
                >
                    {{ $t("common.sign_out") }}
                </button>
            </div>
        </div>
    </header>
</template>
