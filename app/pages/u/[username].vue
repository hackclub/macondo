<script setup lang="ts">
import { Slack } from "lucide-vue-next";
import ProjectExploreCard, { type ProjectExploreItem } from "~/components/ProjectExploreCard.vue";

// Cached at module scope so concurrent animation calls share one gsap fetch.
let gsapBundle: Promise<{
  gsap: typeof import("gsap").gsap;
  Flip: typeof import("gsap/Flip").Flip;
}> | null = null;
function loadGsap() {
  if (!gsapBundle) {
    gsapBundle = Promise.all([
      import("gsap"),
      import("gsap/Flip"),
    ]).then(([gsapMod, flipMod]) => {
      gsapMod.gsap.registerPlugin(flipMod.Flip);
      return { gsap: gsapMod.gsap, Flip: flipMod.Flip };
    });
  }
  return gsapBundle;
}

definePageMeta({
    layout: false,
});

interface PublicProfile {
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
    created_at: string | null;
    last_active_date: string | null;
    project_count: number;
    total_upvotes: number;
    top_streak_days: number;
    projects: ProjectExploreItem[];
}

const props = defineProps<{
    embeddedWindowed?: boolean;
    username?: string;
}>();

const emit = defineEmits<{
    close: [];
    'open-project': [id: number];
}>();

const route = useRoute();
const { user, isLoggedIn, signIn } = useAuth();
const { t } = useI18n();

const isWindowed = computed(() => !!props.embeddedWindowed || route.query.windowed === "1");

const handle = computed(() => {
    if (props.username) return props.username;
    const param = route.params.username;
    return Array.isArray(param) ? param[0] : (param as string | undefined);
});

// SSR OG meta for unfurlers (the body loads client-side). With a :username prop
// the host page owns the head.
if (!props.username) {
    const { data: ogProfile } = await useAsyncData(
        `profile-og-${handle.value ?? "unknown"}`,
        () =>
            handle.value
                ? $fetch(`/api/users/${encodeURIComponent(handle.value)}/og`).catch(() => null)
                : Promise.resolve(null),
    );
    const ogDescription = () =>
        ogProfile.value ? `${ogProfile.value.username}'s projects on Macondo.` : undefined;
    useSeoMeta({
        title: () => (ogProfile.value ? `${ogProfile.value.username} · Macondo` : undefined),
        ogTitle: () => (ogProfile.value ? `${ogProfile.value.username} · Macondo` : undefined),
        description: ogDescription,
        ogDescription,
        ogType: "profile",
        twitterCard: "summary_large_image",
    });
    if (import.meta.server && ogProfile.value) {
        defineOgImage("Profile", {
            username: ogProfile.value.username,
            image: ogProfile.value.image
                ? `/api/og/thumb?u=${encodeURIComponent(ogProfile.value.image)}`
                : undefined,
            projectCount: ogProfile.value.projectCount,
            topStreakDays: ogProfile.value.topStreakDays,
            totalUpvotes: ogProfile.value.totalUpvotes,
        });
    }
}

const profile = ref<PublicProfile | null>(null);
const loading = ref(true);
const errorCode = ref<number | null>(null);

async function fetchProfile() {
    if (!handle.value) return;
    loading.value = true;
    errorCode.value = null;
    try {
        profile.value = await $fetch<PublicProfile>(`/api/users/${encodeURIComponent(handle.value)}`);
    } catch (err) {
        errorCode.value = (err as { status?: number; statusCode?: number })?.status
            ?? (err as { statusCode?: number })?.statusCode
            ?? 500;
        profile.value = null;
        console.error("[public-profile] fetch failed", err);
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void fetchProfile();
});

watch(handle, () => {
    void fetchProfile();
});

const memberSince = computed(() => {
    if (!profile.value?.created_at) return "";
    return new Date(profile.value.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
});

const upvoteDisabledReason = computed<string | null>(() => {
    if (!isLoggedIn.value) return t("explore.upvote.login_required");
    if (user.value?.hca_verification_status !== "verified") {
        return t("explore.upvote.verify_required");
    }
    return null;
});

const canUpvote = computed(() => upvoteDisabledReason.value == null);

const gridRef = ref<HTMLElement | null>(null);

const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

function isOwner(p: ProjectExploreItem): boolean {
    return !!user.value && user.value.id === p.owner.id;
}

function closeModal() {
    if (props.embeddedWindowed) {
        emit("close");
    } else if (import.meta.client) {
        window.parent.postMessage({ type: "close-modal" }, "*");
    }
}

function handleOpenProject(id: number) {
    if (props.embeddedWindowed) {
        emit("open-project", id);
    }
}

async function handleUpvote(projectId: number, btnEl: HTMLElement | null, countEl: HTMLElement | null) {
    if (!isLoggedIn.value) {
        signIn();
        return;
    }
    if (!canUpvote.value) return;
    if (!profile.value) return;
    const idx = profile.value.projects.findIndex((p) => p.id === projectId);
    if (idx < 0) return;
    const item = profile.value.projects[idx]!;
    const prev = {
        upvoted: item.current_user_upvoted,
        count: item.upvote_count,
    };
    profile.value.projects[idx] = {
        ...item,
        current_user_upvoted: !prev.upvoted,
        upvote_count: prev.upvoted ? prev.count - 1 : prev.count + 1,
    };

    if (import.meta.client && !prefersReducedMotion()) {
        const { gsap } = await loadGsap();
        if (countEl) {
            gsap.fromTo(
                countEl,
                { scale: 1.4, color: "#FFB774" },
                { scale: 1, color: "#684D3A", duration: 0.4, ease: "back.out(2)", clearProps: "color" },
            );
        }
        if (btnEl) {
            gsap.fromTo(
                btnEl,
                { scale: 0.85 },
                { scale: 1, duration: 0.35, ease: "back.out(1.5)" },
            );
        }
    }

    try {
        const res = await $fetch<{ upvoted: boolean; count: number }>(
            `/api/projects/${projectId}/upvote`,
            { method: "POST" },
        );
        if (profile.value) {
            const after = profile.value.projects.findIndex((p) => p.id === projectId);
            if (after >= 0) {
                profile.value.projects[after] = {
                    ...profile.value.projects[after]!,
                    current_user_upvoted: res.upvoted,
                    upvote_count: res.count,
                };
            }
        }
    } catch (err) {
        console.error("[public-profile] upvote failed", err);
        if (profile.value) {
            const after = profile.value.projects.findIndex((p) => p.id === projectId);
            if (after >= 0) {
                profile.value.projects[after] = {
                    ...profile.value.projects[after]!,
                    current_user_upvoted: prev.upvoted,
                    upvote_count: prev.count,
                };
            }
        }
    }
}
</script>

<template>
    <div :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'" class="relative">
        <div class="max-w-5xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-6">
            <div v-if="isWindowed" class="flex items-center justify-between gap-4 w-full flex-wrap">
                <button
                    class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
                    @click="closeModal"
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                    </svg>
                    {{ $t("profile_public.back") }}
                </button>
                <a
                    v-if="handle"
                    :href="`/u/${handle}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm text-ds-brown/70 flex items-center gap-1 hover:text-ds-brown transition-colors"
                >
                    {{ $t("profile_public.open_in_new_tab") }}
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                </a>
            </div>
            <a
                v-else
                href="/explore"
                class="text-sm text-ds-brown underline flex items-center gap-1 self-start"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t("explore.back_to_explore") }}
            </a>

            <p v-if="loading && !profile" class="text-sm text-ds-brown/60 py-12 text-center">
                {{ $t("explore.loading") }}
            </p>
            <div v-else-if="errorCode === 404">
                <div class="py-8 text-center text-sm text-ds-brown">
                    {{ $t("profile_public.not_found") }}
                </div>
            </div>
            <template v-else-if="profile">
                <div>
                    <div class="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                        <div class="w-24 h-24 rounded-full overflow-hidden border-[3px] border-ds-brown shrink-0">
                            <img
                                v-if="profile.image"
                                :src="profile.image"
                                :alt="profile.username ?? ''"
                                class="w-full h-full object-cover"
                            >
                            <div
                                v-else
                                class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-3xl font-bold text-ds-brown"
                            >
                                {{ (profile.username ?? "?").charAt(0).toUpperCase() }}
                            </div>
                        </div>
                        <div class="flex-1 flex flex-col gap-2 text-center sm:text-left">
                            <h1 class="text-2xl font-bold text-ds-brown">{{ profile.username ?? "—" }}</h1>
                            <div class="flex items-center justify-center sm:justify-start gap-2 text-sm text-ds-brown/70 flex-wrap">
                                <a
                                    v-if="profile.slack_id"
                                    :href="`https://hackclub.slack.com/team/${profile.slack_id}`"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="hover:text-ds-brown no-underline inline-flex items-center gap-1"
                                >
                                    <Slack class="w-3.5 h-3.5" />
                                    View on Slack
                                </a>
                                <span v-if="profile.slack_id && memberSince">·</span>
                                <span v-if="memberSince">{{ $t("profile_public.member_since") }} {{ memberSince }}</span>
                            </div>
                            <div class="flex items-center justify-center sm:justify-start gap-4 mt-2 text-xs font-bold text-ds-brown">
                                <div class="flex flex-col items-center sm:items-start">
                                    <span class="text-2xl tabular-nums">{{ profile.project_count }}</span>
                                    <span class="text-[10px] uppercase tracking-wider text-ds-brown/60">{{ $t("profile_public.projects") }}</span>
                                </div>
                                <div class="flex flex-col items-center sm:items-start">
                                    <span class="text-2xl tabular-nums">{{ profile.total_upvotes }}</span>
                                    <span class="text-[10px] uppercase tracking-wider text-ds-brown/60">{{ $t("profile_public.total_upvotes") }}</span>
                                </div>
                                <div class="flex flex-col items-center sm:items-start">
                                    <span class="text-2xl tabular-nums">{{ profile.top_streak_days }}d</span>
                                    <span class="text-[10px] uppercase tracking-wider text-ds-brown/60">{{ $t("profile_public.top_streak") }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div>
                    <h2 class="text-lg font-bold text-ds-brown mb-3">{{ $t("profile_public.projects") }}</h2>
                    <div
                        v-if="profile.projects.length > 0"
                        ref="gridRef"
                        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                    >
                        <ProjectExploreCard
                            v-for="p in profile.projects"
                            :key="p.id"
                            :project="p"
                            :can-upvote="canUpvote"
                            :upvote-disabled-reason="upvoteDisabledReason"
                            :is-owner="isOwner(p)"
                            :as-link="!isWindowed"
                            @open-project="handleOpenProject"
                            @upvote="handleUpvote"
                        />
                    </div>
                    <p v-else class="text-sm text-ds-brown/60 py-6 text-center">
                        {{ $t("profile_public.no_projects") }}
                    </p>
                </div>
            </template>
        </div>
    </div>
</template>
