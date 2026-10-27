<script setup lang="ts">
import { ChevronUp, Flame } from "lucide-vue-next";
import { fruits as fruitDefs } from "~/data/fruitLevels";

export interface ProjectExploreItem {
    id: number;
    name: string;
    description: string | null;
    type: "software" | "hardware";
    fruit: string | null;
    level: string | null;
    thumbnail_url: string | null;
    project_streak_days: number;
    last_worked_date: string | null;
    created_at: string | Date | null;
    updated_at: string | Date | null;
    upvote_count: number;
    current_user_upvoted: boolean;
    has_shipped: boolean;
    is_extra_fruity?: boolean;
    owner: {
        id: string;
        image: string | null;
        username: string | null;
        slack_id: string | null;
        created_at: string | Date | null;
    };
}

const props = defineProps<{
    project: ProjectExploreItem;
    canUpvote: boolean;
    upvoteDisabledReason: string | null;
    isOwner: boolean;
    asLink: boolean;
}>();

const emit = defineEmits<{
    'open-project': [id: number];
    'open-person': [usernameOrId: string];
    upvote: [id: number, btn: HTMLElement | null, countEl: HTMLElement | null];
}>();

const fruitIcon = computed(() => {
    if (!props.project.fruit) return null;
    return fruitDefs.find((f) => f.name === props.project.fruit)?.icon ?? null;
});

const ownerHandle = computed(() => props.project.owner.id);

const ownerDisplayName = computed(() => props.project.owner.username ?? "—");

const upvoteCountRef = ref<HTMLElement | null>(null);

function handleCardClick() {
    if (props.asLink) return;
    emit("open-project", props.project.id);
}

function handleOwnerClick(e: Event) {
    e.stopPropagation();
    if (props.asLink) return;
    emit("open-person", ownerHandle.value);
}

const { showAlert } = useAlertDialog();
const { t } = useI18n();

const effectiveUpvoteDisabledReason = computed<string | null>(() => {
    if (props.upvoteDisabledReason) return props.upvoteDisabledReason;
    return null;
});

const effectiveCanUpvote = computed(() => effectiveUpvoteDisabledReason.value == null);

function handleUpvote(e: Event) {
    e.stopPropagation();
    // never a silent no-op: tell the user why upvoting is blocked
    if (props.isOwner) {
        void showAlert({ tone: "info", message: t("explore.upvote.self_disabled") });
        return;
    }
    if (!effectiveCanUpvote.value) {
        void showAlert({
            tone: "info",
            message: effectiveUpvoteDisabledReason.value ?? t("explore.upvote.label"),
        });
        return;
    }
    emit("upvote", props.project.id, e.currentTarget instanceof HTMLElement ? e.currentTarget : null, upvoteCountRef.value);
}
</script>

<template>
    <NuxtLink
        v-if="asLink"
        :to="`/projects/${project.id}`"
        :data-card-id="`p-${project.id}`"
        class="group flex flex-col h-full bg-parchment border-[3px] border-ds-brown/20 hover:border-ds-brown/60 cursor-pointer transition-colors no-underline"
    >
        <div class="relative aspect-[16/10] bg-ds-brown/10 overflow-hidden border-b-[3px] border-ds-brown/10">
            <img
                v-if="project.thumbnail_url"
                :src="project.thumbnail_url"
                :alt="project.name"
                class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
            >
            <div v-else class="absolute inset-0 flex items-center justify-center text-xs text-ds-brown/40 font-semibold uppercase tracking-wider">
                {{ $t("explore.card.no_thumbnail") }}
            </div>
            <div
                v-if="project.project_streak_days > 0"
                class="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-parchment/95 border-2 border-ds-brown text-xs font-bold text-ds-brown"
            >
                <Flame class="w-3 h-3 text-ds-danger" />
                {{ $t("explore.card.streak_days", { n: project.project_streak_days }) }}
            </div>
            <div
                v-if="fruitIcon"
                class="absolute top-2 right-2 w-8 h-8 bg-parchment/95 border-2 border-ds-brown flex items-center justify-center"
                :title="project.fruit ?? ''"
            >
                <img :src="fruitIcon" :alt="project.fruit ?? ''" class="w-5 h-5 object-contain">
            </div>
            <div
                v-if="project.is_extra_fruity"
                class="absolute bottom-2 right-2"
            >
                <ExtraFruityBadge compact />
            </div>
        </div>
        <div class="flex flex-1 flex-col gap-2 p-3">
            <h3 class="text-base font-bold text-ds-brown leading-tight line-clamp-2">{{ project.name }}</h3>
            <p v-if="project.description" class="text-xs text-ds-brown/70 leading-snug line-clamp-2">{{ project.description }}</p>
            <div class="flex items-center justify-between gap-2 mt-1">
                <NuxtLink
                    :to="`/u/${ownerHandle}`"
                    class="flex items-center gap-2 min-w-0 hover:opacity-70 transition-opacity no-underline"
                    @click.stop
                >
                    <div class="w-6 h-6 rounded-full overflow-hidden border-2 border-ds-brown/40 shrink-0">
                        <img v-if="project.owner.image" :src="project.owner.image" :alt="ownerDisplayName" class="w-full h-full object-cover">
                        <div v-else class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-[10px] font-bold text-ds-brown">{{ ownerDisplayName.charAt(0).toUpperCase() }}</div>
                    </div>
                    <span class="text-xs text-ds-brown/80 truncate">{{ ownerDisplayName }}</span>
                </NuxtLink>
                <div class="flex items-center gap-1 shrink-0">
                    <span
                        class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        :class="project.has_shipped ? 'bg-ds-success text-parchment' : 'bg-ds-warning text-ds-brown'"
                    >
                        {{ project.has_shipped ? $t("explore.card.shipped") : $t("explore.card.in_progress") }}
                    </span>
                    <span class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-ds-brown/10 text-ds-brown/80">{{ project.type }}</span>
                    <span v-if="project.level" class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-ds-brown/10 text-ds-brown/80">L{{ project.level }}</span>
                </div>
            </div>
            <div class="flex items-center justify-between gap-2 mt-auto pt-2 border-t-2 border-ds-brown/10">
                <button
                    type="button"
                    class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border-2 transition-colors"
                    :class="[
                        project.current_user_upvoted
                            ? 'bg-ds-brown text-parchment border-ds-brown'
                            : 'bg-parchment text-ds-brown border-ds-brown/40 hover:border-ds-brown',
                        (!effectiveCanUpvote || isOwner) && 'opacity-60 cursor-help',
                    ]"
                    :aria-disabled="!effectiveCanUpvote || isOwner"
                    :title="isOwner ? $t('explore.upvote.self_disabled') : effectiveUpvoteDisabledReason ?? $t('explore.upvote.label')"
                    @click.prevent.stop="handleUpvote"
                >
                    <ChevronUp class="w-3.5 h-3.5" />
                    <span ref="upvoteCountRef" class="tabular-nums">{{ project.upvote_count }}</span>
                </button>
                <span class="text-[10px] text-ds-brown/40 uppercase tracking-wider">{{ $t("explore.card.view_project") }}</span>
            </div>
        </div>
    </NuxtLink>
    <div
        v-else
        :data-card-id="`p-${project.id}`"
        class="group flex flex-col h-full bg-parchment border-[3px] border-ds-brown/20 hover:border-ds-brown/60 cursor-pointer transition-colors"
        @click="handleCardClick"
    >
        <div class="relative aspect-[16/10] bg-ds-brown/10 overflow-hidden border-b-[3px] border-ds-brown/10">
            <img
                v-if="project.thumbnail_url"
                :src="project.thumbnail_url"
                :alt="project.name"
                class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
            >
            <div v-else class="absolute inset-0 flex items-center justify-center text-xs text-ds-brown/40 font-semibold uppercase tracking-wider">
                {{ $t("explore.card.no_thumbnail") }}
            </div>
            <div
                v-if="project.project_streak_days > 0"
                class="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-parchment/95 border-2 border-ds-brown text-xs font-bold text-ds-brown"
            >
                <Flame class="w-3 h-3 text-ds-danger" />
                {{ $t("explore.card.streak_days", { n: project.project_streak_days }) }}
            </div>
            <div
                v-if="fruitIcon"
                class="absolute top-2 right-2 w-8 h-8 bg-parchment/95 border-2 border-ds-brown flex items-center justify-center"
                :title="project.fruit ?? ''"
            >
                <img :src="fruitIcon" :alt="project.fruit ?? ''" class="w-5 h-5 object-contain">
            </div>
            <div
                v-if="project.is_extra_fruity"
                class="absolute bottom-2 right-2"
            >
                <ExtraFruityBadge compact />
            </div>
        </div>
        <div class="flex flex-1 flex-col gap-2 p-3">
            <h3 class="text-base font-bold text-ds-brown leading-tight line-clamp-2">{{ project.name }}</h3>
            <p v-if="project.description" class="text-xs text-ds-brown/70 leading-snug line-clamp-2">{{ project.description }}</p>
            <div class="flex items-center justify-between gap-2 mt-1">
                <button
                    type="button"
                    class="flex items-center gap-2 min-w-0 hover:opacity-70 transition-opacity"
                    @click="handleOwnerClick"
                >
                    <div class="w-6 h-6 rounded-full overflow-hidden border-2 border-ds-brown/40 shrink-0">
                        <img v-if="project.owner.image" :src="project.owner.image" :alt="ownerDisplayName" class="w-full h-full object-cover">
                        <div v-else class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-[10px] font-bold text-ds-brown">{{ ownerDisplayName.charAt(0).toUpperCase() }}</div>
                    </div>
                    <span class="text-xs text-ds-brown/80 truncate">{{ ownerDisplayName }}</span>
                </button>
                <div class="flex items-center gap-1 shrink-0">
                    <span
                        class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        :class="project.has_shipped ? 'bg-ds-success text-parchment' : 'bg-ds-warning text-ds-brown'"
                    >
                        {{ project.has_shipped ? $t("explore.card.shipped") : $t("explore.card.in_progress") }}
                    </span>
                    <span class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-ds-brown/10 text-ds-brown/80">{{ project.type }}</span>
                    <span v-if="project.level" class="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-ds-brown/10 text-ds-brown/80">L{{ project.level }}</span>
                </div>
            </div>
            <div class="flex items-center justify-between gap-2 mt-auto pt-2 border-t-2 border-ds-brown/10">
                <button
                    type="button"
                    class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border-2 transition-colors"
                    :class="[
                        project.current_user_upvoted
                            ? 'bg-ds-brown text-parchment border-ds-brown'
                            : 'bg-parchment text-ds-brown border-ds-brown/40 hover:border-ds-brown',
                        (!effectiveCanUpvote || isOwner) && 'opacity-60 cursor-help',
                    ]"
                    :aria-disabled="!effectiveCanUpvote || isOwner"
                    :title="isOwner ? $t('explore.upvote.self_disabled') : effectiveUpvoteDisabledReason ?? $t('explore.upvote.label')"
                    @click="handleUpvote"
                >
                    <ChevronUp class="w-3.5 h-3.5" />
                    <span ref="upvoteCountRef" class="tabular-nums">{{ project.upvote_count }}</span>
                </button>
                <span class="text-[10px] text-ds-brown/40 uppercase tracking-wider">{{ $t("explore.card.view_project") }}</span>
            </div>
        </div>
    </div>
</template>
