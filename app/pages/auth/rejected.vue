<!-- Fatal HCA rejections and closed sign-ups: no session was created, so no app shell or sign-in retry. -->
<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "#imports";

definePageMeta({
  layout: "public",
});

const route = useRoute();

// Set by the auth callback when someone without a Macondo account signs in.
const signupsClosed = computed(() => route.query.closed === "1");

const reason = computed(() => {
  const r = route.query.reason;
  if (typeof r === "string" && r.trim()) return r.trim();
  return null;
});

const details = computed(() => {
  const d = route.query.details;
  if (typeof d === "string" && d.trim()) return d.trim();
  return null;
});

useHead({
  title: signupsClosed.value ? "Sign-ups are closed" : "Account not eligible",
  meta: [{ name: "robots", content: "noindex,nofollow" }],
});
</script>

<template>
  <main class="min-h-screen flex items-center justify-center px-4 py-12 bg-ds-cream">
    <div v-if="signupsClosed" class="max-w-xl w-full bg-white border-[3px] border-ds-brown p-6 md:p-8 text-ds-brown">
      <h1 class="text-2xl md:text-3xl font-extrabold mb-2">
        Macondo isn't accepting new sign-ups.
      </h1>
      <p class="text-sm text-ds-brown/80 mb-6">
        Macondo has ended, so only people who already have an account can sign in.
        We couldn't find a Macondo account for this Hack Club Auth account.
      </p>
      <a
        href="/"
        class="inline-flex items-center px-4 py-2 border-2 border-ds-brown text-ds-brown font-bold hover:bg-ds-brown hover:text-ds-cream text-sm"
      >Back to home</a>
    </div>
    <div v-else class="max-w-xl w-full bg-white border-[3px] border-ds-brown p-6 md:p-8 text-ds-brown">
      <h1 class="text-2xl md:text-3xl font-extrabold mb-2">
        Your Hack Club Auth account isn't eligible to join Macondo.
      </h1>
      <p class="text-sm text-ds-brown/80 mb-6">
        Hack Club Auth has marked this account as ineligible to participate
        in Macondo. We can't create an account for you here until that
        changes on their end.
      </p>

      <div v-if="reason || details" class="border-2 border-ds-brown bg-ds-cream/40 p-4 mb-6">
        <div v-if="reason" class="text-sm font-bold mb-1">Reason</div>
        <p v-if="reason" class="text-sm text-ds-brown whitespace-pre-wrap break-words">
          {{ reason }}
        </p>
        <div v-if="details" class="text-sm font-bold mt-3 mb-1">Details</div>
        <p v-if="details" class="text-sm text-ds-brown/80 whitespace-pre-wrap break-words">
          {{ details }}
        </p>
      </div>

      <div class="text-sm text-ds-brown/80 space-y-2 mb-6">
        <p>
          If you think this is wrong, head over to
          <a
            href="https://auth.hackclub.com"
            class="underline font-bold hover:no-underline"
            target="_blank"
            rel="noopener"
          >auth.hackclub.com</a>
          and open a ticket. They handle eligibility decisions, we don't.
        </p>
        <p>
          Once your account is verified there, come back and try signing in
          again here.
        </p>
      </div>

      <div class="flex flex-wrap gap-3 text-sm">
        <a
          href="https://auth.hackclub.com"
          class="inline-flex items-center px-4 py-2 bg-ds-brown text-ds-cream font-bold hover:bg-ds-brown/90"
          target="_blank"
          rel="noopener"
        >Open auth.hackclub.com</a>
        <a
          href="/"
          class="inline-flex items-center px-4 py-2 border-2 border-ds-brown text-ds-brown font-bold hover:bg-ds-brown hover:text-ds-cream"
        >Back to home</a>
      </div>
    </div>
  </main>
</template>
