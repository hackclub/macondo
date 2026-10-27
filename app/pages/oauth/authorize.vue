<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";

// Not session-authed: the visitor proves they're a supaadmin by pasting a Macondo MCP token,
// which /api/oauth/authorize validates before returning the claude.ai redirect.
definePageMeta({ layout: false });

const route = useRoute();

const redirectUri = computed(() => String(route.query.redirect_uri ?? ""));
const state = computed(() => String(route.query.state ?? ""));
const codeChallenge = computed(() => String(route.query.code_challenge ?? ""));
const codeChallengeMethod = computed(() =>
  String(route.query.code_challenge_method ?? ""),
);

const paramError = computed(() => {
  if (!redirectUri.value) return "This authorization link is missing a redirect_uri.";
  if (codeChallenge.value && codeChallengeMethod.value !== "S256") {
    return "This client requested an unsupported PKCE method (only S256 is allowed).";
  }
  return null;
});

// Where the freshly-minted authorization code is headed. The flow mints a
// 90-day admin-scoped token downstream, so the destination must be visible
// before the submitter pastes their MCP token — the token is the credential.
const destinationOrigin = computed(() => {
  try {
    return new URL(redirectUri.value).origin;
  } catch {
    return "";
  }
});

const isKnownDestination = computed(() => {
  try {
    const host = new URL(redirectUri.value).hostname.toLowerCase();
    return host === "claude.ai" || host.endsWith(".claude.ai");
  } catch {
    return false;
  }
});

const token = ref("");
const submitting = ref(false);
const error = ref<string | null>(null);

async function authorize() {
  error.value = null;
  if (!token.value.trim()) {
    error.value = "Paste a Macondo MCP token to continue.";
    return;
  }
  submitting.value = true;
  try {
    const res = await $fetch<{ redirect: string }>("/api/oauth/authorize", {
      method: "POST",
      body: {
        token: token.value.trim(),
        redirect_uri: redirectUri.value,
        state: state.value,
        code_challenge: codeChallenge.value,
        code_challenge_method: codeChallengeMethod.value,
      },
    });
    await navigateTo(res.redirect, { external: true });
  } catch (e: unknown) {
    error.value =
      (e as { data?: { statusMessage?: string }; statusMessage?: string })?.data
        ?.statusMessage ??
      (e as { statusMessage?: string })?.statusMessage ??
      "Authorization failed. Check the token and try again.";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="min-h-screen w-full flex items-center justify-center bg-parchment p-6 text-ds-brown"
  >
    <div class="w-full max-w-md border-[3px] border-ds-brown bg-parchment p-8">
      <h1 class="font-title text-3xl mb-2">Connect to Macondo</h1>
      <p class="text-sm mb-6">
        Authorize the Model Context Protocol connection. Paste a Macondo MCP
        token to continue, this proves you are a supaadmin.
      </p>

      <div
        v-if="paramError"
        class="border-[3px] border-ds-danger p-4 text-ds-danger text-sm"
      >
        {{ paramError }}
      </div>

      <form v-else class="space-y-4" @submit.prevent="authorize">
        <div class="border-[3px] border-ds-brown bg-ds-cream p-3">
          <p class="text-xs font-bold uppercase tracking-wide text-ds-brown/70">
            Redirect destination
          </p>
          <code class="mt-1 block break-all text-sm">{{ destinationOrigin || redirectUri }}</code>
          <p
            v-if="!isKnownDestination"
            class="mt-2 border-[3px] border-ds-danger p-2 text-xs font-bold text-ds-danger"
          >
            This destination is not a known connector domain. Verify you trust
            it before continuing — the authorization code goes straight to this
            URL.
          </p>
        </div>

        <label class="block text-sm font-bold" for="mcp-token">MCP token</label>
        <input
          id="mcp-token"
          v-model="token"
          type="password"
          autocomplete="off"
          placeholder="macondo_mcp_..."
          class="w-full border-[3px] border-ds-brown bg-ds-cream px-3 py-2 text-ds-brown placeholder:text-ds-brown/50 focus:outline-none"
        />

        <p
          v-if="error"
          class="border-[3px] border-ds-danger p-3 text-ds-danger text-sm"
        >
          {{ error }}
        </p>

        <button
          type="submit"
          class="ds-btn-primary w-full"
          :disabled="submitting"
        >
          {{ submitting ? "Authorizing..." : "Authorize" }}
        </button>
      </form>

      <p class="text-xs mt-6 text-ds-brown/70">
        Don't have a token? A supaadmin mints them under Ops &rarr; MCP in the
        internal admin.
      </p>
    </div>
  </div>
</template>
