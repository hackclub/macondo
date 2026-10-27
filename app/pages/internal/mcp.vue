<script setup lang="ts">
import { computed, ref } from "vue";

// Route + API are gated by canManageMcpTokens; a raw token is only seen once, right after minting.
definePageMeta({ layout: "internal" });

type TokenRow = {
  id: string;
  label: string;
  last4: string;
  can_write: boolean;
  owner_name: string;
  owner_email: string;
  owner_image: string | null;
  state: "active" | "expired" | "revoked";
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

const origin = useRequestURL().origin;
const endpointUrl = computed(() => `${origin}/api/mcp`);

const { data, refresh } = await useFetch<{ endpoint: string; tokens: TokenRow[] }>(
  "/api/internal/mcp/tokens",
  { server: false, default: () => ({ endpoint: "/api/mcp", tokens: [] }) },
);

const createOpen = ref(false);
const newLabel = ref("");
const newExpiry = ref<"" | "30" | "90" | "365">("");
const newCanWrite = ref(false);
const creating = ref(false);
const createError = ref("");

const revealOpen = ref(false);
const revealedToken = ref("");
const revealedLabel = ref("");
const copied = ref(false);

const confirm = ref<{ type: "revoke" | "delete"; id: string; label: string } | null>(
  null,
);
const confirming = ref(false);

function openCreate() {
  newLabel.value = "";
  newExpiry.value = "";
  newCanWrite.value = false;
  createError.value = "";
  createOpen.value = true;
}

async function doCreate() {
  if (creating.value) return;
  creating.value = true;
  createError.value = "";
  try {
    const res = await $fetch<{ token: string; label: string }>(
      "/api/internal/mcp/tokens",
      {
        method: "POST",
        body: {
          label: newLabel.value.trim() || undefined,
          days: newExpiry.value ? Number(newExpiry.value) : null,
          canWrite: newCanWrite.value,
        },
      },
    );
    createOpen.value = false;
    revealedToken.value = res.token;
    revealedLabel.value = res.label;
    copied.value = false;
    revealOpen.value = true;
    await refresh();
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    createError.value =
      err?.data?.statusMessage ?? err?.statusMessage ?? "Failed to mint token.";
  } finally {
    creating.value = false;
  }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(revealedToken.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

function askRevoke(t: TokenRow) {
  confirm.value = { type: "revoke", id: t.id, label: t.label };
}
function askDelete(t: TokenRow) {
  confirm.value = { type: "delete", id: t.id, label: t.label };
}

async function doConfirm() {
  if (!confirm.value || confirming.value) return;
  confirming.value = true;
  try {
    if (confirm.value.type === "revoke") {
      await $fetch(`/api/internal/mcp/tokens/${confirm.value.id}/revoke`, {
        method: "POST",
      });
    } else {
      await $fetch(`/api/internal/mcp/tokens/${confirm.value.id}`, {
        method: "DELETE",
      });
    }
    confirm.value = null;
    await refresh();
  } finally {
    confirming.value = false;
  }
}

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}
function fmtDay(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "never";
}

const claudeCodeCmd = computed(
  () =>
    `claude mcp add --transport http macondo ${endpointUrl.value} --header "Authorization: Bearer YOUR_TOKEN"`,
);
</script>

<template>
  <div class="min-h-screen text-zinc-100 px-4 md:px-8 pb-8 pt-32 md:pt-24">
    <div class="max-w-5xl mx-auto flex flex-col gap-6">
      <div class="flex flex-col gap-2">
        <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Ops</p>
        <h1 class="text-3xl font-bold text-white tracking-tight">MCP server</h1>
        <p class="text-sm text-zinc-400 max-w-3xl">
          Programmatic, supaadmin-scoped access to Macondo over the Model Context
          Protocol. Mint a token below and connect from Claude Code, or add the
          endpoint as a claude.ai custom connector. Every request re-checks that
          the token owner is still a supaadmin, so a demotion or revoke kills
          access on the next call. Read-write tokens can additionally adjust
          gold, set roles, and resolve tickets, all audited.
        </p>
      </div>

      <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
        <div>
          <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Connect</p>
          <h2 class="text-xl font-bold text-white">Endpoint</h2>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
            MCP URL
          </span>
          <code class="text-sm text-emerald-200 bg-black/30 border border-zinc-800 px-3 py-2 break-all">
            {{ endpointUrl }}
          </code>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
            Claude Code
          </span>
          <code class="text-xs text-zinc-300 bg-black/30 border border-zinc-800 px-3 py-2 break-all">
            {{ claudeCodeCmd }}
          </code>
        </div>
        <p class="text-xs text-zinc-500">
          For claude.ai, add a custom connector pointing at the MCP URL above and
          complete the OAuth prompt by pasting a token minted here.
        </p>
      </section>

      <section class="border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Tokens</p>
            <h2 class="text-xl font-bold text-white">Active &amp; past tokens</h2>
          </div>
          <button
            type="button"
            class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors"
            @click="openCreate"
          >
            New token
          </button>
        </div>

        <p v-if="!data?.tokens.length" class="text-sm text-zinc-500">
          No MCP tokens yet. Mint one to connect.
        </p>

        <div
          v-for="t in data?.tokens ?? []"
          :key="t.id"
          class="border border-zinc-800 bg-black/20 p-4 flex flex-col gap-2"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="font-semibold text-white truncate">{{ t.label }}</span>
              <span class="text-[11px] text-zinc-500 font-mono">…{{ t.last4 }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span
                class="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border"
                :class="
                  t.can_write
                    ? 'text-amber-200 border-amber-500/40 bg-amber-500/10'
                    : 'text-zinc-400 border-zinc-700 bg-zinc-800/40'
                "
              >
                {{ t.can_write ? "read-write" : "read-only" }}
              </span>
              <span
                class="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border"
                :class="{
                  'text-emerald-200 border-emerald-500/40 bg-emerald-500/10': t.state === 'active',
                  'text-zinc-400 border-zinc-700 bg-zinc-800/40': t.state === 'expired',
                  'text-rose-200 border-rose-500/40 bg-rose-500/10': t.state === 'revoked',
                }"
              >
                {{ t.state }}
              </span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span>owner: {{ t.owner_name }} ({{ t.owner_email }})</span>
            <span>last used: {{ fmt(t.last_used_at) }}</span>
            <span>expires: {{ fmtDay(t.expires_at) }}</span>
          </div>
          <div class="flex justify-end gap-2">
            <button
              v-if="t.state === 'active'"
              type="button"
              class="text-xs font-bold text-rose-200 hover:bg-rose-700/30 border border-rose-700/60 px-3 py-1.5 transition-colors"
              @click="askRevoke(t)"
            >
              Revoke
            </button>
            <button
              v-else
              type="button"
              class="text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 border border-zinc-700 px-3 py-1.5 transition-colors"
              @click="askDelete(t)"
            >
              Delete
            </button>
          </div>
        </div>
      </section>
    </div>

    <Transition name="modal-fade" appear>
      <div
        v-if="createOpen"
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="createOpen = false"
      >
        <div
          class="modal-fade-panel relative bg-zinc-950 border border-emerald-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
        >
          <h2 class="text-emerald-200 font-bold text-lg">New MCP token</h2>

          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
              Label
            </label>
            <input
              v-model="newLabel"
              type="text"
              placeholder="(defaults to your name + today's date)"
              class="bg-black/30 border border-zinc-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-emerald-600 placeholder:text-zinc-600"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
              Expiry
            </label>
            <select
              v-model="newExpiry"
              class="bg-black/30 border border-zinc-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-emerald-600"
            >
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </div>

          <label class="flex items-start gap-2 text-sm text-zinc-300">
            <input v-model="newCanWrite" type="checkbox" class="mt-0.5" />
            <span>
              Read-write scope
              <span class="block text-[11px] text-zinc-500">
                Allows the mutation tools (adjust gold, set roles, resolve
                tickets). Leave off for a read-only token.
              </span>
            </span>
          </label>

          <p v-if="createError" class="text-rose-400 text-xs">{{ createError }}</p>

          <div class="flex gap-2 justify-end">
            <button
              class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
              :disabled="creating"
              @click="createOpen = false"
            >
              Cancel
            </button>
            <button
              class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors disabled:opacity-50"
              :disabled="creating"
              @click="doCreate"
            >
              {{ creating ? "Minting…" : "Mint token" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal-fade" appear>
      <div
        v-if="revealOpen"
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="revealOpen = false"
      >
        <div
          class="modal-fade-panel relative bg-zinc-950 border border-emerald-700 p-6 w-full max-w-lg flex flex-col gap-4 internal-modal-grid-bg"
        >
          <h2 class="text-emerald-200 font-bold text-lg">Token minted</h2>
          <p class="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 p-2">
            Copy this now, it is shown once and never again. Anyone with it gets
            {{ revealedLabel ? `"${revealedLabel}"` : "this token's" }} access.
          </p>
          <code class="text-xs text-emerald-200 bg-black/40 border border-zinc-800 px-3 py-3 break-all select-all">
            {{ revealedToken }}
          </code>
          <div class="flex gap-2 justify-end">
            <button
              class="text-sm font-bold bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 border border-emerald-700 px-4 py-2 transition-colors"
              @click="copyToken"
            >
              {{ copied ? "Copied" : "Copy" }}
            </button>
            <button
              class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
              @click="revealOpen = false"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal-fade" appear>
      <div
        v-if="confirm"
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="confirm = null"
      >
        <div
          class="modal-fade-panel relative bg-zinc-950 border border-rose-700 p-6 w-full max-w-md flex flex-col gap-4 internal-modal-grid-bg"
        >
          <h2 class="text-rose-200 font-bold text-lg">
            {{ confirm?.type === "revoke" ? "Revoke token?" : "Delete token?" }}
          </h2>
          <p class="text-zinc-300 text-sm">
            <template v-if="confirm?.type === 'revoke'">
              <strong class="text-white">"{{ confirm?.label }}"</strong>
              will stop working immediately on its next request. The row stays in
              the list for audit.
            </template>
            <template v-else>
              Permanently remove
              <strong class="text-white">"{{ confirm?.label }}"</strong>
              from the list. This is cleanup only, the token is already dead.
            </template>
          </p>
          <div class="flex gap-2 justify-end">
            <button
              class="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors"
              :disabled="confirming"
              @click="confirm = null"
            >
              Cancel
            </button>
            <button
              class="text-sm font-bold bg-rose-700/40 text-rose-100 hover:bg-rose-700/60 border border-rose-700 px-4 py-2 transition-colors disabled:opacity-50"
              :disabled="confirming"
              @click="doConfirm"
            >
              {{ confirming ? "Working…" : confirm?.type === "revoke" ? "Revoke" : "Delete" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
