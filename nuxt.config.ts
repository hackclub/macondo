import { createRequire } from "node:module";

const resolveCertificateAsset = createRequire(import.meta.url).resolve;

const hcbOauthSecret =
  process.env.NUXT_HCB_SECRET ||
  process.env.HCB_SECRET ||
  process.env.NUXT_HCB_API ||
  process.env.HCB_API;

const archiveSocialImage = new URL(
  "/og-macondo.webp",
  process.env.NUXT_PUBLIC_SITE_URL || "https://macondo.hackclub.com",
).href;

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },

  // A dependency leaves a libuv handle open, so `nuxt build` never exits and hangs Docker.
  // `close` only fires after a successful build; the env var is set only in the Dockerfile.
  hooks: {
    close() {
      if (process.env.NUXT_FORCE_EXIT_AFTER_BUILD === "1") {
        process.exit(0);
      }
    },
  },

  nitro: {
    experimental: {
      websocket: true,
    },
    compressPublicAssets: true,
    sourceMap: false,
    // Satori's font shaper opens these files dynamically, beyond Nitro's JS tracing.
    externals: {
      traceInclude: [
        resolveCertificateAsset("harfbuzzjs/hb.wasm"),
        resolveCertificateAsset("harfbuzzjs/hb-subset.wasm"),
      ],
    },
    // Nitro defaults to es2019, which lacks the BigInt literals server/lib/invite-code.ts uses.
    esbuild: {
      options: {
        target: "es2020",
      },
    },
  },

  app: {
    head: {
      title: "Macondo",
    },
    pageTransition: { name: "page", mode: "out-in" },
  },

  css: ["~/assets/css/global.css"],

  tailwindcss: {
    exposeConfig: true,
    viewer: process.env.NODE_ENV !== "production",
    // Theme lives in tailwind.config.ts: the typography plugin isn't serializable here.
  },


  runtimeConfig: {
    redisUrl: process.env.REDIS_URL,
    databaseUrl: process.env.DATABASE_URL,
    hackclubAuthClientId: process.env.HACKCLUB_AUTH_ID,
    betterAuthUrl: process.env.BETTER_AUTH_URL,
    hackclubAuthClientSecret:
      process.env.HACKCLUB_AUTH_SECRET ||
      process.env.HACKCLUB_AUTH_CLIENT_SECRET,
    hackclubCdnKey: process.env.HACKCLUB_CDN_KEY,
    // Signs shop catalog browser tokens and doubles as the SSR lane header (server/lib/ui-token.ts).
    uiGateSecret:
      process.env.NUXT_UI_GATE_SECRET ||
      process.env.HACKCLUB_AUTH_SECRET ||
      process.env.HACKCLUB_AUTH_CLIENT_SECRET ||
      "",
    hcbApiToken:
      process.env.NUXT_HCB_API_TOKEN ||
      process.env.HCB_API_TOKEN ||
      (hcbOauthSecret?.startsWith("hcb_") ? hcbOauthSecret : undefined),
    hcbApi: process.env.NUXT_HCB_API || process.env.HCB_API,
    hcbOauthUid:
      process.env.NUXT_HCB_OAUTH_UID ||
      process.env.NUXT_HCB_UID ||
      process.env.HCB_OAUTH_UID ||
      process.env.HCB_UID,
    hcbOauthSecret,
    hcbOauthScope: process.env.NUXT_HCB_OAUTH_SCOPE || process.env.HCB_OAUTH_SCOPE,
    hcbOrganizationId:
      process.env.NUXT_HCB_ORGANIZATION_ID || process.env.HCB_ORGANIZATION_ID,
    hackatimeAdminKey: process.env.HACKATIME_ADMIN_KEY,
    hackatimeOauthUid:
      process.env.NUXT_HACKATIME_OAUTH_UID || process.env.HACKATIME_OAUTH_UID,
    hackatimeOauthSecret:
      process.env.NUXT_HACKATIME_OAUTH_SECRET ||
      process.env.HACKATIME_OAUTH_SECRET,
    slackBotToken: process.env.NUXT_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN,
    // Separate review bot, intentionally unused by ship/support/streak notifications.
    reviewSlackBotToken:
      process.env.NUXT_REVIEW_SLACK_BOT_TOKEN ||
      process.env.REVIEW_SLACK_BOT_TOKEN ||
      process.env.NUXT_SLACK_REVIEW_BOT_TOKEN ||
      process.env.SLACK_REVIEW_BOT_TOKEN,
    reviewSlackChannelId:
      process.env.NUXT_REVIEW_SLACK_CHANNEL_ID ||
      process.env.REVIEW_SLACK_CHANNEL_ID ||
      process.env.NUXT_SLACK_REVIEW_CHANNEL_ID ||
      process.env.SLACK_REVIEW_CHANNEL_ID ||
      "C0B1PUGJ7RU",
    // Must belong to a workspace admin: only admins can invite guest users to channels.
    slackUserToken: process.env.NUXT_SLACK_USER_TOKEN || process.env.SLACK_USER_TOKEN,
    slackSigningSecret: process.env.NUXT_SLACK_SIGNING_SECRET || process.env.SLACK_SIGNING_SECRET,
    slackSupportBtsChannelId:
      process.env.NUXT_SLACK_SUPPORT_BTS_CHANNEL_ID ||
      process.env.SLACK_SUPPORT_BTS_CHANNEL_ID ||
      "C0AKE4VT8FK",
    slackSupportSummaryChannelId:
      process.env.NUXT_SLACK_SUPPORT_SUMMARY_CHANNEL_ID ||
      process.env.SLACK_SUPPORT_SUMMARY_CHANNEL_ID ||
      "C0AJXQM1477",
    slackSupportPublicChannelId:
      process.env.NUXT_SLACK_SUPPORT_PUBLIC_CHANNEL_ID ||
      process.env.SLACK_SUPPORT_PUBLIC_CHANNEL_ID ||
      "C0AU8AWD5BN",
    // Watched for "macondo" mentions that may be help requests. Defaults to the ship channel.
    slackMacondoMentionChannelId:
      process.env.NUXT_SLACK_MACONDO_MENTION_CHANNEL_ID ||
      process.env.SLACK_MACONDO_MENTION_CHANNEL_ID ||
      "C07TM4C0AQ5",
    slackMacondoMainChannelId:
      process.env.NUXT_SLACK_MACONDO_MAIN_CHANNEL_ID ||
      process.env.SLACK_MACONDO_MAIN_CHANNEL_ID ||
      "C0AUZ1LAMH6",
    slackMacondoBulletinChannelId:
      process.env.NUXT_SLACK_MACONDO_BULLETIN_CHANNEL_ID ||
      process.env.SLACK_MACONDO_BULLETIN_CHANNEL_ID ||
      "C0AUZ1P2DEC",
    slackOrganizerIds:
      process.env.NUXT_SLACK_ORGANIZER_IDS ||
      process.env.SLACK_ORGANIZER_IDS ||
      "",
    slackEventAttendeeChannelId:
      process.env.NUXT_SLACK_EVENT_ATTENDEE_CHANNEL_ID ||
      process.env.SLACK_EVENT_ATTENDEE_CHANNEL_ID ||
      "",
    // No default on purpose: the webhook URL is a credential and belongs only in Doppler.
    slackShopLogWebhookUrl:
      process.env.NUXT_SLACK_SHOP_LOG_WEBHOOK_URL ||
      process.env.SLACK_SHOP_LOG_WEBHOOK_URL ||
      "",

    // Transactional email only; server/lib/loops.ts talks to Airtable, not this key.
    // Template ids come from env so staging and prod can differ; unset = skipped.
    loopsApiKey: process.env.NUXT_LOOPS_API_KEY || process.env.LOOPS_API_KEY,
    loopsTemplateShipApproved: process.env.NUXT_LOOPS_TEMPLATE_SHIP_APPROVED || "",
    loopsTemplateShipRejected: process.env.NUXT_LOOPS_TEMPLATE_SHIP_REJECTED || "",
    loopsTemplateShipNeedsChanges: process.env.NUXT_LOOPS_TEMPLATE_SHIP_NEEDS_CHANGES || "",
    loopsTemplateShipDecisionReversed: process.env.NUXT_LOOPS_TEMPLATE_SHIP_DECISION_REVERSED || "",
    loopsTemplateHardwareGrantSent: process.env.NUXT_LOOPS_TEMPLATE_HARDWARE_GRANT_SENT || "",
    loopsTemplateShopGrantSent: process.env.NUXT_LOOPS_TEMPLATE_SHOP_GRANT_SENT || "",
    loopsTemplateShopGrantFallbackSent: process.env.NUXT_LOOPS_TEMPLATE_SHOP_GRANT_FALLBACK_SENT || "",
    loopsTemplateGrantCancelled: process.env.NUXT_LOOPS_TEMPLATE_GRANT_CANCELLED || "",
    loopsTemplateTicketReply: process.env.NUXT_LOOPS_TEMPLATE_TICKET_REPLY || "",
    loopsTemplateTicketResolved: process.env.NUXT_LOOPS_TEMPLATE_TICKET_RESOLVED || "",
    loopsTemplateTicketReopened: process.env.NUXT_LOOPS_TEMPLATE_TICKET_REOPENED || "",
    loopsTemplateEventQualified: process.env.NUXT_LOOPS_TEMPLATE_EVENT_QUALIFIED || "",

    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    // Optional; authenticated requests get a much larger GitHub rate limit.
    githubToken:
      process.env.NUXT_GITHUB_TOKEN ||
      process.env.GITHUB_API_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.githubToken,
    hackclubAiKey:
      process.env.NUXT_HACKCLUB_AI_KEY ||
      process.env.HACKCLUB_AI_KEY,
    aiPrimaryModel:
      process.env.NUXT_AI_PRIMARY_MODEL ||
      "qwen/qwen3-next-80b-a3b-instruct",
    airtableToken:
      process.env.NUXT_AIRTABLE_TOKEN ||
      process.env.AIRTABLE_TOKEN,
    airtableUnifiedToken:
      process.env.NUXT_AIRTABLE_UNIFIED_TOKEN ||
      process.env.AIRTABLE_UNIFIED_TOKEN ||
      "",
    theseusApiKey:
      process.env.NUXT_THESEUS_API_KEY ||
      process.env.THESEUS_API_KEY,
    theseusLetterQueue:
      process.env.NUXT_THESEUS_LETTER_QUEUE ||
      process.env.THESEUS_LETTER_QUEUE ||
      "macondo",
    // Empty ids/secrets are safe: ship submits are never blocked and inbound webhooks are rejected.
    ariBaseUrl:
      process.env.NUXT_ARI_BASE_URL ||
      process.env.ARI_BASE_URL ||
      "https://webhooks.ari.hackclub.com",
    ariProgramId:
      process.env.NUXT_ARI_PROGRAM_ID ||
      process.env.ARI_PROGRAM_ID ||
      "",
    ariIngestSecret:
      process.env.NUXT_ARI_INGEST_SECRET ||
      process.env.ARI_INGEST_SECRET ||
      "",
    // ARI's outbound signing secret; injected at runtime as NUXT_ARI_WEBHOOK_SECRET.
    ariWebhookSecret:
      process.env.NUXT_ARI_WEBHOOK_SECRET ||
      process.env.ARI_WEBHOOK_SECRET ||
      "",
    // Must match ARI's "Collaborative projects" toggle: collaborators on a non-collaborative program is a 422.
    ariCollaborative:
      process.env.NUXT_ARI_COLLABORATIVE ||
      process.env.ARI_COLLABORATIVE ||
      "false",
  },

  modules: [
    "@nuxt/fonts",
    "nuxt-site-config",
    "@nuxtjs/robots",
    "@nuxtjs/sitemap",
    "nuxt-schema-org",
    "nuxt-seo-utils",
    "@nuxtjs/mdc",
    "./modules/docs-archive",
    "@nuxtjs/i18n",
    "@nuxtjs/tailwindcss",
  ],

  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL || "https://macondo.hackclub.com",
    name: "Macondo",
    description: "Make personal projects. Win free prizes.",
    defaultLocale: "en",
    trailingSlash: false,
  },

  sitemap: {
    sources: ["/api/__sitemap__/docs"],
  },

  robots: {
    blockAiBots: false,
    groups: [
      {
        userAgent: ["*"],
        allow: ["/"],
        disallow: [
          "/internal/",
          "/api/",
          "/dashboard",
          "/profile",
          "/onboarding",
          "/shop",
          "/exchange",
          "/notifications",
          "/projects/",
          "/support/",
          "/settings/",
          "/guides/",
        ],
      },
    ],
  },

  // The event archive uses one static social image instead of a renderer endpoint.
  seo: { meta: { ogImage: archiveSocialImage, twitterImage: archiveSocialImage } },

  // Register the archive typography globally.
  fonts: {
    families: [
      {
        name: "Are You Serious",
        weights: [400],
        global: true,
      },
      {
        name: "Satoro",
        provider: "local",
        src: "/fonts/Satoro/Satoro.ttf",
        weight: 400,
        global: true,
      },
      {
        name: "Inter",
        weights: [400, 500, 600, 700],
        global: true,
      },
    ],
  },

  schemaOrg: {
    identity: {
      type: "Organization",
      name: "Macondo",
      url: "https://macondo.hackclub.com",
      logo: "https://macondo.hackclub.com/android-chrome-512x512.webp",
      sameAs: [
        "https://hackclub.com",
        "https://github.com/hackclub",
      ],
    },
  },

  // Markdown and syntax highlighting are compiled by modules/docs-archive at build time.
  mdc: { highlight: false },

  routeRules: {
    "/internal/**": {
      ssr: false,
      robots: false,
      sitemap: false,
    },
    "/dashboard": { robots: false, sitemap: false },
    "/profile": { robots: false, sitemap: false },
    "/onboarding": { robots: false, sitemap: false },
    "/shop": { robots: false, sitemap: false },
    "/exchange": { robots: false, sitemap: false },
    "/notifications": { robots: false, sitemap: false },
    "/projects/**": { robots: false, sitemap: false },
    "/support/**": { robots: false, sitemap: false },
    "/settings/**": { robots: false, sitemap: false },
    "/guides/**": { robots: false, sitemap: false },
    "/api/**": { robots: false, sitemap: false },
    // No swr on "/": stale cached HTML after a deploy points at deleted /_nuxt chunks.
    "/": { sitemap: { priority: 1.0, changefreq: "weekly" } },
    "/minecraft": { sitemap: { priority: 0.9, changefreq: "monthly" } },
    "/docs/**": { sitemap: { priority: 0.7, changefreq: "monthly" } },
  },

  i18n: {
    locales: [
      { code: "en", file: "en.json", isCatchallLocale: true },
      { code: "es", file: "es.json" },
      { code: "pt", file: "pt.json" },
    ],
    langDir: "locales",
    defaultLocale: "en",
    strategy: "no_prefix",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "i18n_locale",
      fallbackLocale: "en",
    },
    // Tutorial prompts contain trusted HTML rendered via v-html, which strict mode rejects.
    compilation: {
      strictMessage: false,
    },
  },

  vite: {
    optimizeDeps: {
      // Heavy dynamically imported libs are left out on purpose; pre-bundling defeats the lazy load.
      include: [
        "@unhead/schema-org/vue",
        "lucide-vue-next",
      ],
    },
  },

  sourcemap: {
    client: false,
    server: false,
  },
});
