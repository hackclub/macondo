<script setup lang="ts">
import { computed, ref, watch } from "vue";

const { t } = useI18n();

const name = ref("");
const description = ref("");
const storeUrl = ref("");
const imageUrl = ref("");
const showUsername = ref(false);
const HACKER_VALUE_URL = "https://santi.lol/blog/hacker-value/";

const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const checkingMatches = ref(false);
const forceSubmit = ref(false);
const matches = ref<Array<{
    id: number;
    name: string;
    description: string | null;
    group_tag: string | null;
    upvote_count: number;
}>>([]);

watch([name, description], () => {
    matches.value = [];
    forceSubmit.value = false;
});

const isProbablyGrantRequest = computed(() => {
    return /\bgrant(s)?\b/.test(`${name.value} ${description.value}`.toLowerCase());
});

function reset() {
    name.value = "";
    description.value = "";
    storeUrl.value = "";
    imageUrl.value = "";
    showUsername.value = false;
}

async function submit() {
    errorMessage.value = null;
    successMessage.value = null;

    const trimmedName = name.value.trim();
    if (trimmedName.length < 2) {
        errorMessage.value = t("shop_page.request_form.error_name_too_short");
        return;
    }

    if (!forceSubmit.value) {
        checkingMatches.value = true;
        try {
            matches.value = (await $fetch<{ items: typeof matches.value }>("/api/shop/requests/matches", {
                query: { q: trimmedName },
            })).items;
            if (matches.value.length > 0) {
                forceSubmit.value = true;
                return;
            }
        } finally {
            checkingMatches.value = false;
        }
    }

    submitting.value = true;
    try {
        await $fetch("/api/shop/requests", {
            method: "POST",
            body: {
                name: trimmedName,
                description: description.value.trim() || null,
                store_url: storeUrl.value.trim() || null,
                image_url: imageUrl.value.trim() || null,
                show_username: showUsername.value,
            },
        });
        successMessage.value = t("shop_page.request_form.success_with_see");
        matches.value = [];
        forceSubmit.value = false;
        reset();
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        errorMessage.value =
            typedErr?.data?.message
            ?? typedErr?.statusMessage
            ?? t("shop_page.request_form.error_generic");
    } finally {
        submitting.value = false;
    }
}

async function voteExisting(id: number) {
    try {
        await $fetch(`/api/shop/requests/${id}/vote`, { method: "POST" });
        successMessage.value = t("shop_page.request_form.voted_existing");
        matches.value = [];
        forceSubmit.value = false;
    } catch (err: unknown) {
        const typedErr = err as { data?: { message?: string }; statusMessage?: string };
        errorMessage.value = typedErr?.data?.message ?? typedErr?.statusMessage ?? t("shop_page.request_form.error_generic");
    }
}

function openShopRequests() {
    window.open("/shop-requests", "_blank", "noopener,noreferrer");
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <div>
            <h2 class="text-lg font-bold text-ds-brown mb-1">
                {{ $t("shop_page.request_form.title") }}
            </h2>
            <p class="text-sm text-ds-brown/65 font-semibold">
                {{ $t("shop_page.request_form.subtitle") }}
            </p>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="submit">
            <label class="flex flex-col gap-1">
                <span class="text-xs font-bold text-ds-brown/70 uppercase tracking-wider">
                    {{ $t("shop_page.request_form.name_label") }}
                </span>
                <input
                    v-model="name"
                    type="text"
                    maxlength="120"
                    required
                    :placeholder="$t('shop_page.request_form.name_placeholder')"
                    class="ds-input"
                    :disabled="submitting"
                >
            </label>

            <div
                v-if="isProbablyGrantRequest"
                class="border-[2px] border-ds-warning/40 bg-ds-warning/10 px-4 py-3 flex flex-col gap-2"
            >
                <p class="text-sm font-bold text-ds-brown">
                    {{ $t("shop_page.request_form.grant_warning_title") }}
                </p>
                <p class="text-xs text-ds-brown/75 leading-relaxed font-semibold">
                    {{ $t("shop_page.request_form.grant_warning_body") }}
                </p>
                <a
                    :href="HACKER_VALUE_URL"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-xs font-bold text-ds-brown underline hover:opacity-70 transition-opacity self-start"
                >
                    {{ $t("shop_page.request_form.grant_warning_cta") }}
                </a>
            </div>

            <label class="flex flex-col gap-1">
                <span class="text-xs font-bold text-ds-brown/70 uppercase tracking-wider">
                    {{ $t("shop_page.request_form.description_label") }}
                </span>
                <textarea
                    v-model="description"
                    rows="3"
                    maxlength="2000"
                    :placeholder="$t('shop_page.request_form.description_placeholder')"
                    class="ds-input !py-2 resize-y"
                    :disabled="submitting"
                />
            </label>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label class="flex flex-col gap-1">
                    <span class="text-xs font-bold text-ds-brown/70 uppercase tracking-wider">
                        {{ $t("shop_page.request_form.store_url_label") }}
                    </span>
                    <input
                        v-model="storeUrl"
                        type="url"
                        maxlength="500"
                        :placeholder="$t('shop_page.request_form.store_url_placeholder')"
                        class="ds-input"
                        :disabled="submitting"
                    >
                </label>

                <label class="flex flex-col gap-1">
                    <span class="text-xs font-bold text-ds-brown/70 uppercase tracking-wider">
                        {{ $t("shop_page.request_form.image_url_label") }}
                    </span>
                    <input
                        v-model="imageUrl"
                        type="url"
                        maxlength="500"
                        :placeholder="$t('shop_page.request_form.image_url_placeholder')"
                        class="ds-input"
                        :disabled="submitting"
                    >
                </label>
            </div>

            <p
                v-if="errorMessage"
                class="text-sm text-ds-danger bg-burnt-peach-100 border-[2px] border-ds-danger/30 px-4 py-3 font-semibold"
            >
                {{ errorMessage }}
            </p>

            <div
                v-if="matches.length > 0"
                class="border-[2px] border-ds-brown/20 bg-ds-brown/5 px-4 py-3 flex flex-col gap-3"
            >
                <p class="text-sm font-bold text-ds-brown">
                    {{ $t("shop_page.request_form.matches_title") }}
                </p>
                <p class="text-xs text-ds-brown/65 font-semibold">
                    {{ $t("shop_page.request_form.matches_subtitle") }}
                </p>
                <div class="flex flex-col gap-2">
                    <div
                        v-for="match in matches"
                        :key="match.id"
                        class="flex items-start justify-between gap-3 border-t border-ds-brown/10 pt-2"
                    >
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-ds-brown truncate">
                                {{ match.name }}
                            </p>
                            <p v-if="match.description" class="text-xs text-ds-brown/60 line-clamp-2">
                                {{ match.description }}
                            </p>
                            <p class="text-[11px] text-ds-brown/50 font-semibold">
                                {{ match.upvote_count }} {{ $t("shop_page.request_form.votes") }}
                                <span v-if="match.group_tag">· {{ match.group_tag }}</span>
                            </p>
                        </div>
                        <button
                            type="button"
                            class="ds-btn-ghost text-xs shrink-0"
                            @click="voteExisting(match.id)"
                        >
                            {{ $t("shop_page.request_form.upvote_instead") }}
                        </button>
                    </div>
                </div>
                <p class="text-xs text-ds-brown/60 font-semibold">
                    {{ $t("shop_page.request_form.submit_again_hint") }}
                </p>
            </div>

            <label class="flex items-center gap-2 text-xs text-ds-brown/60 cursor-pointer">
                <input
                    v-model="showUsername"
                    type="checkbox"
                    class="accent-ds-brown"
                    :disabled="submitting"
                >
                <span class="font-semibold">{{ $t("shop_page.request_form.show_username_label") }}</span>
            </label>
            <p
                v-if="successMessage"
                class="text-sm text-ds-success bg-[#edf0c4] border-[2px] border-ds-success/30 px-4 py-3 font-semibold flex flex-col gap-1"
            >
                <span>{{ t("shop_page.request_form.success") }}</span>
                <button
                    type="button"
                    class="text-ds-success underline hover:opacity-70 transition-opacity text-xs font-bold"
                    @click="openShopRequests"
                >
                    {{ t("shop_page.request_form.see_others_cta") }} →
                </button>
            </p>

            <div class="flex justify-end">
                <button
                    type="submit"
                    class="ds-btn-primary"
                    :disabled="submitting || checkingMatches"
                >
                    {{ submitting
                        ? $t("shop_page.request_form.submitting")
                        : checkingMatches
                          ? $t("shop_page.request_form.checking_matches")
                        : $t("shop_page.request_form.submit") }}
                </button>
            </div>
        </form>
    </div>
</template>
