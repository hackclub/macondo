<script setup lang="ts">

import { ChevronDown } from "lucide-vue-next";

type RosterCollaborator = {
  id?: number;
  user_id: string;
  username: string | null;
  slack_id: string | null;
  image: string | null;
  status: string;
};

type RosterResponse = {
  owner_id: string | null;
  is_owner: boolean;
  collaborators: RosterCollaborator[];
};

type OwnerInfo = {
  id: string;
  // users.name is real-name PII, so mentions use username or slack_id
  username: string | null;
  slack_id: string | null;
  image: string | null;
};

type JournalForBreakdown = {
  id: number;
  short_brief: string;
  hours: number | null;
  override_hours: number | null;
  author_id: string | null;
  created_at: string | Date | null;
};

const props = defineProps<{
  projectId: number;
  owner: OwnerInfo;
  journals: JournalForBreakdown[];
}>();

const { t } = useI18n();

const sectionOpen = ref(false);
const journalExpanded = ref<Record<string, boolean>>({});

const { data } = useFetch<RosterResponse>(
  () => `/api/projects/${props.projectId}/collaborators`,
  { default: () => ({ owner_id: null, is_owner: false, collaborators: [] }) },
);

const activeCollaborators = computed(() =>
  (data.value?.collaborators ?? []).filter(
    (c) => c.status === "active" && c.user_id !== props.owner.id,
  ),
);
const memberCount = computed(() => activeCollaborators.value.length + 1);

type MemberCard = {
  user_id: string;
  username: string | null;
  slack_id: string | null;
  image: string | null;
  is_owner: boolean;
};
const members = computed<MemberCard[]>(() => {
  const list: MemberCard[] = [
    {
      user_id: props.owner.id,
      username: props.owner.username,
      slack_id: props.owner.slack_id,
      image: props.owner.image,
      is_owner: true,
    },
  ];
  for (const c of activeCollaborators.value) {
    list.push({
      user_id: c.user_id,
      username: c.username,
      slack_id: c.slack_id,
      image: c.image,
      is_owner: false,
    });
  }
  return list;
});

function journalsFor(userId: string) {
  return props.journals.filter((j) => j.author_id === userId);
}
function totalHoursFor(userId: string) {
  return Math.round(
    journalsFor(userId).reduce(
      (acc, j) => acc + Number(j.override_hours ?? j.hours ?? 0),
      0,
    ) * 10,
  ) / 10;
}

function toggleJournals(userId: string) {
  journalExpanded.value[userId] = !journalExpanded.value[userId];
}

function formatDate(value: string | Date | null) {
  if (!value) return "";
  return (value instanceof Date ? value : new Date(value)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Vue transitions can't animate height: auto, so JS hooks drive max-height from scrollHeight.
function onEnter(el: Element) {
  const target = el as HTMLElement;
  target.style.maxHeight = "0px";
  target.style.opacity = "0";
  target.style.overflow = "hidden";
  // force a reflow so the browser sees the start state
  void target.offsetHeight;
  target.style.transition = "max-height 280ms ease-out, opacity 200ms ease-out";
  target.style.maxHeight = `${target.scrollHeight}px`;
  target.style.opacity = "1";
}
function onAfterEnter(el: Element) {
  const target = el as HTMLElement;
  target.style.transition = "";
  target.style.maxHeight = "";
  target.style.opacity = "";
  target.style.overflow = "";
}
function onLeave(el: Element) {
  const target = el as HTMLElement;
  target.style.maxHeight = `${target.scrollHeight}px`;
  target.style.opacity = "1";
  target.style.overflow = "hidden";
  void target.offsetHeight;
  target.style.transition = "max-height 220ms ease-in, opacity 180ms ease-in";
  target.style.maxHeight = "0px";
  target.style.opacity = "0";
}
</script>

<template>
  <section class="border-[3px] border-ds-brown bg-parchment">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-ds-brown/5 transition-colors"
      :aria-expanded="sectionOpen"
      @click="sectionOpen = !sectionOpen"
    >
      <span class="text-lg font-bold text-ds-brown">
        {{ t("group_projects.collaborators.heading") }}
      </span>
      <div class="flex items-center gap-3">
        <span class="text-xs text-ds-brown/60 font-mono">
          {{ memberCount }}
        </span>
        <ChevronDown
          :size="20"
          class="text-ds-brown transition-transform duration-200"
          :class="sectionOpen ? 'rotate-180' : ''"
        />
      </div>
    </button>

    <Transition
      :css="false"
      @enter="onEnter"
      @after-enter="onAfterEnter"
      @leave="onLeave"
    >
      <div v-if="sectionOpen" class="border-t-[3px] border-ds-brown">
        <div class="px-5 py-4 flex flex-col gap-4">
          <p class="text-sm text-ds-brown/70">
            {{ t("group_projects.collaborators.subheading") }}
          </p>

          <ul class="flex flex-col gap-3">
            <li
              v-for="m in members"
              :key="m.user_id"
              class="border-[3px] border-ds-brown bg-ds-brown/5 p-3 flex flex-col gap-3"
            >
              <header class="flex items-center gap-3 flex-wrap">
                <img
                  v-if="m.image"
                  :src="m.image"
                  :alt="m.username ?? ''"
                  class="w-10 h-10 object-cover border-[3px] border-ds-brown shrink-0"
                >
                <div
                  v-else
                  class="w-10 h-10 border-[3px] border-ds-brown bg-ds-brown/10 flex items-center justify-center text-base font-bold text-ds-brown shrink-0"
                >
                  {{ (m.username ?? m.slack_id ?? "?").charAt(0) }}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-ds-brown truncate">
                    {{ m.username ?? m.slack_id ?? t("group_projects.collaborators.collaborator_role") }}
                  </div>
                  <div class="text-xs uppercase tracking-widest text-ds-brown/70">
                    {{ m.is_owner ? t("group_projects.collaborators.owner_role") : t("group_projects.collaborators.collaborator_role") }}
                  </div>
                </div>
              </header>

              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div class="border-[3px] border-ds-brown/30 bg-parchment/60 px-3 py-2">
                  <dt class="text-[10px] uppercase tracking-widest text-ds-brown/60 font-bold">
                    {{ t("group_projects.collaborators.journals_label") }}
                  </dt>
                  <dd class="font-mono text-xl text-ds-brown">{{ journalsFor(m.user_id).length }}</dd>
                </div>
                <div class="border-[3px] border-ds-brown/30 bg-parchment/60 px-3 py-2">
                  <dt class="text-[10px] uppercase tracking-widest text-ds-brown/60 font-bold">
                    {{ t("group_projects.collaborators.hours_label") }}
                  </dt>
                  <dd class="font-mono text-xl text-ds-brown">{{ totalHoursFor(m.user_id) }}</dd>
                </div>
              </dl>

              <button
                v-if="journalsFor(m.user_id).length > 0"
                type="button"
                class="ds-btn-ghost text-xs self-start"
                @click="toggleJournals(m.user_id)"
              >
                {{ journalExpanded[m.user_id]
                  ? t("group_projects.collaborators.hide_journals")
                  : journalsFor(m.user_id).length === 1
                    ? t("group_projects.collaborators.show_journals_one")
                    : t("group_projects.collaborators.show_journals_many", { count: journalsFor(m.user_id).length }) }}
              </button>

              <Transition
                :css="false"
                @enter="onEnter"
                @after-enter="onAfterEnter"
                @leave="onLeave"
              >
                <ul
                  v-if="journalExpanded[m.user_id] && journalsFor(m.user_id).length > 0"
                  class="flex flex-col gap-1 border-t-[3px] border-ds-brown/30 pt-3"
                >
                  <li
                    v-for="j in journalsFor(m.user_id)"
                    :key="j.id"
                    class="flex items-baseline justify-between gap-2 text-sm text-ds-brown"
                  >
                    <span class="truncate flex-1 min-w-0">{{ j.short_brief }}</span>
                    <span class="text-xs text-ds-brown/60 font-mono whitespace-nowrap">
                      {{ Number(j.override_hours ?? j.hours ?? 0).toFixed(1) }}h
                      <span class="ml-1 text-ds-brown/40">{{ formatDate(j.created_at) }}</span>
                    </span>
                  </li>
                </ul>
              </Transition>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </section>
</template>
