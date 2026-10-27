<script setup lang="ts">
import ProjectExploreCard, { type ProjectExploreItem } from "~/components/ProjectExploreCard.vue";

// fetch by user id: usernames come from slack display names and aren't unique (ticket 6633)
const props = defineProps<{
  userId: string;
  excludeProjectId: number;
  windowed?: boolean;
}>();

type MakerResponse = {
  id: string;
  username: string | null;
  project_count: number;
  total_upvotes: number;
  top_streak_days: number;
  projects: ProjectExploreItem[];
};

const { data } = useLazyFetch<MakerResponse | null>(
  () => `/api/users/${encodeURIComponent(props.userId)}`,
  { default: () => null },
);

const maker = computed(() => data.value);
const otherProjects = computed(() =>
  (maker.value?.projects ?? [])
    .filter((p) => p.id !== props.excludeProjectId)
    .slice(0, 6), // show at most six other projects
);

function openProject(id: number) {
  void navigateTo(`/projects/${id}`);
}
function openPerson(usernameOrId: string) {
  void navigateTo(`/u/${usernameOrId}`);
}
</script>

<template>
  <component :is="windowed ? 'div' : 'WoodFrame'" v-if="otherProjects.length > 0">
    <div :class="windowed && 'pb-4 border-b-2 border-ds-brown'">
      <div class="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 class="text-lg font-bold text-ds-brown">
          {{ $t("project_detail.more_by_maker.heading", { name: maker?.username }) }}
        </h2>
        <NuxtLink
          :to="`/u/${maker?.id}`"
          class="text-xs font-semibold text-ds-brown underline hover:opacity-70"
        >
          {{ $t("project_detail.more_by_maker.view_profile") }}
        </NuxtLink>
      </div>
      <p class="text-xs text-ds-brown/60 mb-4">
        {{ $t("project_detail.more_by_maker.stats", {
          projects: maker?.project_count ?? 0,
          upvotes: maker?.total_upvotes ?? 0,
          streak: maker?.top_streak_days ?? 0,
        }) }}
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ProjectExploreCard
          v-for="p in otherProjects"
          :key="p.id"
          :project="p"
          :can-upvote="false"
          :upvote-disabled-reason="null"
          :is-owner="false"
          :as-link="true"
          @open-project="openProject"
          @open-person="openPerson"
        />
      </div>
    </div>
  </component>
</template>
