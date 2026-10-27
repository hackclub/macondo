<script setup lang="ts">
import { ref } from "vue";
import { ArrowDown, ArrowUp, Check, Trash2, ExternalLink, Users } from "lucide-vue-next";

const { t } = useI18n();
const { isLoggedIn, user, signIn } = useAuth();

export interface ShopSuggestion {
  id: number;
  name: string;
  description: string | null;
  store_url: string | null;
  image_url: string | null;
  cluster_id: number | null;
  group_tag: string | null;
  upvote_count: number;
  downvote_count: number;
  show_username: boolean;
  created_at: string | null;
  submitter: { username: string | null; image: string | null } | null;
  vote?: "up" | "down" | null;
  voted: boolean;
  downvoted?: boolean;
  can_delete: boolean;
}

const props = defineProps<{
  suggestion: ShopSuggestion;
  variant?: "card" | "strip";
  showDelete?: boolean;
}>();

const emit = defineEmits<{
  (e: "voted", id: number, voted: boolean, count: number, downvoted: boolean, downvoteCount: number, removed: boolean): void;
  (e: "deleted", id: number): void;
}>();

const localVote = ref<"up" | "down" | null>(props.suggestion.vote ?? (props.suggestion.downvoted ? "down" : props.suggestion.voted ? "up" : null));
const localUpvoteCount = ref(props.suggestion.upvote_count);
const localDownvoteCount = ref(props.suggestion.downvote_count);
const voting = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);

// Reset on prop swap when the list refreshes.
watch(
  () => props.suggestion.id,
  (newId, oldId) => {
    if (newId !== oldId) {
      localVote.value = props.suggestion.vote ?? (props.suggestion.downvoted ? "down" : props.suggestion.voted ? "up" : null);
      localUpvoteCount.value = props.suggestion.upvote_count;
      localDownvoteCount.value = props.suggestion.downvote_count;
    }
  },
);
watch(
  () => [props.suggestion.vote, props.suggestion.voted, props.suggestion.downvoted, props.suggestion.upvote_count, props.suggestion.downvote_count] as const,
  ([vote, voted, downvoted, upvotes, downvotes]) => {
    localVote.value = vote ?? (downvoted ? "down" : voted ? "up" : null);
    localUpvoteCount.value = upvotes;
    localDownvoteCount.value = downvotes;
  },
);

const isVerified = computed(
  () => user.value?.hca_verification_status === "verified",
);

function voteTooltip(): string {
  if (!isLoggedIn.value) return t("shop_suggestion.sign_in_to_vote");
  if (!isVerified.value) return t("shop_suggestion.verify_to_vote");
  return localVote.value === "up"
    ? t("shop_suggestion.unvote")
    : t("shop_suggestion.vote");
}

function downvoteTooltip(): string {
  if (!isLoggedIn.value) return t("shop_suggestion.sign_in_to_vote");
  if (!isVerified.value) return t("shop_suggestion.verify_to_vote");
  return localVote.value === "down"
    ? t("shop_suggestion.remove_downvote")
    : t("shop_suggestion.downvote");
}

async function onVote(direction: "up" | "down") {
  if (!isLoggedIn.value) {
    signIn();
    return;
  }
  if (!isVerified.value) return;
  if (voting.value) return;

  voting.value = true;
  const prevVote = localVote.value;
  const prevUpvoteCount = localUpvoteCount.value;
  const prevDownvoteCount = localDownvoteCount.value;
  localVote.value = prevVote === direction ? null : direction;
  localUpvoteCount.value = prevUpvoteCount + (prevVote === "up" ? -1 : 0) + (localVote.value === "up" ? 1 : 0);
  localDownvoteCount.value = prevDownvoteCount + (prevVote === "down" ? -1 : 0) + (localVote.value === "down" ? 1 : 0);

  try {
    const res = await $fetch<{
      vote: "up" | "down" | null;
      voted: boolean;
      downvoted: boolean;
      count: number;
      upvote_count: number;
      downvote_count: number;
      removed: boolean;
    }>(
      `/api/shop/requests/${props.suggestion.id}/vote`,
      { method: "POST", body: { direction } },
    );
    localVote.value = res.vote;
    localUpvoteCount.value = res.upvote_count;
    localDownvoteCount.value = res.downvote_count;
    emit("voted", props.suggestion.id, res.voted, res.count, res.downvoted, res.downvote_count, res.removed);
  } catch (err) {
    localVote.value = prevVote;
    localUpvoteCount.value = prevUpvoteCount;
    localDownvoteCount.value = prevDownvoteCount;
    console.warn("[ShopSuggestionCard] vote failed", err as { data?: { statusMessage?: string }; statusMessage?: string });
  } finally {
    voting.value = false;
  }
}

async function onDelete() {
  if (deleting.value) return;
  deleteError.value = null;
  deleting.value = true;
  try {
    await $fetch(`/api/shop/requests/${props.suggestion.id}`, {
      method: "DELETE",
    });
    emit("deleted", props.suggestion.id);
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }; statusMessage?: string };
    deleteError.value =
      e?.data?.statusMessage ??
      e?.statusMessage ??
      t("shop_suggestion.delete_blocked");
  } finally {
    deleting.value = false;
  }
}

const showImg = computed(
  () => Boolean(props.suggestion.image_url) && !imgFailed.value,
);
const imgFailed = ref(false);

const timeAgo = computed(() => {
  if (!props.suggestion.created_at) return "";
  const mins = Math.round((Date.now() - new Date(props.suggestion.created_at).getTime()) / 60_000);
  if (mins < 1) return t("shop_suggestion.just_now");
  if (mins < 60) return t("shop_suggestion.minutes_ago", { count: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("shop_suggestion.hours_ago", { count: hrs });
  return t("shop_suggestion.days_ago", { count: Math.round(hrs / 24) });
});
</script>

<template>
  <div
    :class="[
      'flex flex-col gap-3 border border-ds-brown/15 bg-parchment/80 transition-all',
      variant === 'strip' ? 'p-3 w-72 shrink-0' : 'p-4',
    ]"
  >
    <div
      v-if="showImg"
      :class="[
        'overflow-hidden bg-ds-brown/5',
        variant === 'strip' ? 'h-32' : 'h-40',
      ]"
    >
      <img
        :src="suggestion.image_url!"
        :alt="suggestion.name"
        loading="lazy"
        class="w-full h-full object-cover"
        @error="imgFailed = true"
      >
    </div>
    <div
      v-else
      :class="[
        'bg-ds-brown/5 flex items-center justify-center text-ds-brown/30',
        variant === 'strip' ? 'h-32' : 'h-40',
      ]"
    >
      <span class="text-xs">{{ t("shop_suggestion.no_image") }}</span>
    </div>

    <div v-if="suggestion.group_tag" class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-ds-brown/55">
      <span class="bg-ds-brown/10 px-2 py-0.5">{{ suggestion.group_tag }}</span>
    </div>

    <div class="flex flex-col gap-1">
      <h3 class="text-sm font-bold text-ds-brown leading-tight line-clamp-2">
        {{ suggestion.name }}
      </h3>
      <p
        v-if="suggestion.description"
        class="text-xs text-ds-brown/65 line-clamp-3"
      >
        {{ suggestion.description }}
      </p>
    </div>

    <a
      v-if="suggestion.store_url"
      :href="suggestion.store_url"
      target="_blank"
      rel="noopener noreferrer"
      class="text-xs font-semibold text-ds-brown/70 hover:text-ds-brown flex items-center gap-1"
    >
      {{ t("shop_suggestion.view_store") }}
      <ExternalLink class="w-3 h-3" />
    </a>

    <div class="flex items-center gap-2 text-xs text-ds-brown/50">
      <template v-if="suggestion.show_username && suggestion.submitter">
        <img
          v-if="suggestion.submitter.image"
          :src="suggestion.submitter.image"
          :alt="suggestion.submitter.username ?? ''"
          class="w-4 h-4 object-cover"
        >
        <span class="font-semibold">
          {{ suggestion.submitter.username ?? t("shop_suggestion.anonymous") }}
        </span>
      </template>
      <template v-else>
        <Users class="w-3 h-3" />
        <span class="font-semibold">{{ t("shop_suggestion.anonymous") }}</span>
      </template>
      <span v-if="timeAgo">· {{ timeAgo }}</span>
    </div>

    <div class="flex items-center justify-between gap-2 pt-1 mt-auto">
      <button
        type="button"
        :disabled="voting || (isLoggedIn && !isVerified)"
        :title="voteTooltip()"
        :class="[
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border-[2px] transition-all',
          localVote === 'up'
            ? 'border-ds-brown bg-ds-brown text-parchment'
            : 'border-ds-brown/30 text-ds-brown hover:border-ds-brown/60',
          (isLoggedIn && !isVerified) ? 'opacity-50 cursor-not-allowed' : '',
        ]"
        @click="onVote('up')"
      >
        <Check v-if="localVote === 'up'" class="w-3.5 h-3.5" />
        <ArrowUp v-else class="w-3.5 h-3.5" />
        {{ localUpvoteCount }}
      </button>

      <button
        type="button"
        :disabled="voting || (isLoggedIn && !isVerified)"
        :title="downvoteTooltip()"
        :class="[
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border-[2px] transition-all',
          localVote === 'down'
            ? 'border-ds-danger bg-ds-danger text-parchment'
            : 'border-ds-brown/30 text-ds-brown hover:border-ds-danger/60 hover:text-ds-danger',
          (isLoggedIn && !isVerified) ? 'opacity-50 cursor-not-allowed' : '',
        ]"
        @click="onVote('down')"
      >
        <Check v-if="localVote === 'down'" class="w-3.5 h-3.5" />
        <ArrowDown v-else class="w-3.5 h-3.5" />
        {{ localDownvoteCount }}
      </button>

      <button
        v-if="showDelete && deleting"
        type="button"
        disabled
        class="text-xs text-ds-brown/40"
      >
        {{ t("shop_suggestion.deleting") }}
      </button>
      <button
        v-else-if="showDelete"
        type="button"
        :disabled="deleting"
        :title="t('shop_suggestion.delete_own')"
        class="text-ds-brown/40 hover:text-ds-danger transition-colors"
        @click="onDelete"
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>
    </div>

    <p v-if="deleteError" class="text-[11px] text-ds-danger font-semibold">
      {{ deleteError }}
    </p>
  </div>
</template>
