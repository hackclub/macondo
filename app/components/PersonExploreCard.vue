<script setup lang="ts">
import { ChevronUp, Flame, Folder, Slack } from "lucide-vue-next";

export interface PersonExploreItem {
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
    last_active_date: string | null;
    created_at: string | Date | null;
    project_count: number;
    total_upvotes: number;
    top_streak_days: number;
}

const props = defineProps<{
    person: PersonExploreItem;
    asLink: boolean;
}>();

const emit = defineEmits<{
    'open-person': [usernameOrId: string];
}>();

// Routing uses the immutable id, not the (often empty / spaced) username.
const handle = computed(() => props.person.id);

const displayName = computed(() => props.person.username ?? "—");

const slackUrl = computed(() =>
    props.person.slack_id
        ? `https://hackclub.slack.com/team/${props.person.slack_id}`
        : null,
);

const memberSince = computed(() => {
    if (!props.person.created_at) return "";
    return new Date(props.person.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
});

function handleClick() {
    if (props.asLink) return;
    emit("open-person", handle.value);
}
</script>

<template>
    <NuxtLink
        v-if="asLink"
        :to="`/u/${handle}`"
        :data-card-id="`u-${person.id}`"
        class="group flex flex-col items-center gap-3 p-4 bg-parchment border-[3px] border-ds-brown/20 hover:border-ds-brown/60 cursor-pointer transition-colors text-center no-underline"
    >
        <div class="w-16 h-16 rounded-full overflow-hidden border-[3px] border-ds-brown shrink-0">
            <img
                v-if="person.image"
                :src="person.image"
                :alt="displayName"
                class="w-full h-full object-cover"
                loading="lazy"
            >
            <div
                v-else
                class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-2xl font-bold text-ds-brown"
            >
                {{ displayName.charAt(0).toUpperCase() }}
            </div>
        </div>
        <div class="flex flex-col items-center gap-0.5 min-w-0 w-full">
            <h3 class="text-sm font-bold text-ds-brown truncate w-full">{{ displayName }}</h3>
            <a
                v-if="slackUrl"
                :href="slackUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-ds-brown/70 hover:text-ds-brown flex items-center gap-1 no-underline truncate w-full justify-center"
                @click.stop
            >
                <Slack class="w-3 h-3" />
                <span class="truncate">View on Slack</span>
            </a>
            <p v-else-if="memberSince" class="text-xs text-ds-brown/60 truncate w-full">{{ $t("profile_public.member_since") }} {{ memberSince }}</p>
        </div>
        <div class="flex items-center gap-2 w-full justify-center text-[11px] font-semibold text-ds-brown/80 pt-2 border-t-2 border-ds-brown/10">
            <span class="flex items-center gap-1" :title="$t('profile_public.projects')"><Folder class="w-3 h-3" />{{ person.project_count }}</span>
            <span class="text-ds-brown/30">·</span>
            <span class="flex items-center gap-1" :title="$t('profile_public.total_upvotes')"><ChevronUp class="w-3 h-3" />{{ person.total_upvotes }}</span>
            <span class="text-ds-brown/30">·</span>
            <span class="flex items-center gap-1" :title="$t('profile_public.top_streak')"><Flame class="w-3 h-3 text-ds-danger" />{{ person.top_streak_days }}d</span>
        </div>
    </NuxtLink>
    <button
        v-else
        type="button"
        :data-card-id="`u-${person.id}`"
        class="group flex flex-col items-center gap-3 p-4 bg-parchment border-[3px] border-ds-brown/20 hover:border-ds-brown/60 cursor-pointer transition-colors text-center no-underline"
        @click="handleClick"
    >
        <div class="w-16 h-16 rounded-full overflow-hidden border-[3px] border-ds-brown shrink-0">
            <img
                v-if="person.image"
                :src="person.image"
                :alt="displayName"
                class="w-full h-full object-cover"
                loading="lazy"
            >
            <div
                v-else
                class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-2xl font-bold text-ds-brown"
            >
                {{ displayName.charAt(0).toUpperCase() }}
            </div>
        </div>
        <div class="flex flex-col items-center gap-0.5 min-w-0 w-full">
            <h3 class="text-sm font-bold text-ds-brown truncate w-full">{{ displayName }}</h3>
            <a
                v-if="slackUrl"
                :href="slackUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-ds-brown/70 hover:text-ds-brown flex items-center gap-1 no-underline truncate w-full justify-center"
                @click.stop
            >
                <Slack class="w-3 h-3" />
                <span class="truncate">View on Slack</span>
            </a>
            <p v-else-if="memberSince" class="text-xs text-ds-brown/60 truncate w-full">{{ $t("profile_public.member_since") }} {{ memberSince }}</p>
        </div>
        <div class="flex items-center gap-2 w-full justify-center text-[11px] font-semibold text-ds-brown/80 pt-2 border-t-2 border-ds-brown/10">
            <span class="flex items-center gap-1" :title="$t('profile_public.projects')"><Folder class="w-3 h-3" />{{ person.project_count }}</span>
            <span class="text-ds-brown/30">·</span>
            <span class="flex items-center gap-1" :title="$t('profile_public.total_upvotes')"><ChevronUp class="w-3 h-3" />{{ person.total_upvotes }}</span>
            <span class="text-ds-brown/30">·</span>
            <span class="flex items-center gap-1" :title="$t('profile_public.top_streak')"><Flame class="w-3 h-3 text-ds-danger" />{{ person.top_streak_days }}d</span>
        </div>
    </button>
</template>
