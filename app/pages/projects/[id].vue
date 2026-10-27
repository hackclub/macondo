<script setup lang="ts">
import {
  ArrowLeft,
  ExternalLink,
  Flag,
  PlaneTakeoff,
  CheckCircle2,
  CircleX,
  RotateCcw,
  NotebookPen,
  Sprout,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  GitBranch,
} from "lucide-vue-next";
import { levelConfig, type ProjectLevel } from '~/data/fruitLevels';

const _prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

type GsapRuntime = typeof import("gsap")["gsap"];
let gsapPromise: Promise<GsapRuntime> | null = null;
function getGsap(): Promise<GsapRuntime> {
  if (!gsapPromise) gsapPromise = import("gsap").then((m) => m.gsap);
  return gsapPromise;
}

function onJournalEnter(el: Element, done: () => void) {
  if (_prefersReducedMotion()) { done(); return; }
  void getGsap().then((gsap) => gsap.fromTo(
    el as HTMLElement,
    { opacity: 0, y: -8 },
    { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", onComplete: done },
  ));
}
function onJournalLeave(el: Element, done: () => void) {
  if (_prefersReducedMotion()) { done(); return; }
  void getGsap().then((gsap) => {
    gsap.to(el as HTMLElement, {
      opacity: 0, x: -20, duration: 0.3, ease: "power2.in", onComplete: done,
    });
  });
}

const { showAlert } = useAlertDialog();

const descMd = ref<Awaited<ReturnType<typeof useLazyMarkdown>> | null>(null);
// Escaped plain text so the v-html never flashes empty while markdown loads.
function plainTextFallback(text: string): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
async function renderDescMd(text: string) {
  if (!descMd.value) {
    return plainTextFallback(text);
  }
  return descMd.value
    .renderSafeMarkdown(text ?? "", { linkify: true })
    .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
onMounted(async () => {
  descMd.value = await useLazyMarkdown();
  void refreshDescriptionHtml();
});

// Timestamps render only after mount: SSR formats in UTC/default locale,
// which would cause a hydration mismatch with the visitor's locale.
const timestampsReady = ref(false);
onMounted(() => {
  timestampsReady.value = true;
});

definePageMeta({
  layout: false,
});

const props = defineProps<{
  embeddedProjectId?: number;
  embeddedWindowed?: boolean;
}>();

const route = useRoute();
const projectId = props.embeddedProjectId || Number(route.params.id);

const { user, isLoggedIn, signIn } = useAuth();
const { locale: funFactLocale, t: tI18n, te: teI18n } = useI18n();

type JournalEntryRecord = {
  id: number;
  short_brief: string;
  long_brief: string;
  hours: number | null;
  created_at: string;
  archived: boolean;
  archived_at: string | null;
  // optional: create/update responses return the bare row without the author join
  author_id?: string | null;
  author_username?: string | null;
  author_slack_id?: string | null;
  author_image?: string | null;
};

type ProjectDetails = {
  id: number;
  user_id: string;
  viewer_is_owner?: boolean;
  viewer_can_edit?: boolean;
  owner: {
    id: string;
    image: string | null;
    username: string | null;
    slack_id: string | null;
  } | null;
  name: string;
  type: 'software' | 'hardware';
  level: string | null;
  description: string;
  fruit: string | null;
  stage: number | null;
  project_streak_days: number | null;
  last_worked_date: string | null;
  thumbnail_url: string | null;
  repository_url: string | null;
  demo_url: string | null;
  hackatime_projects: string[] | null;
  permRejected?: boolean;
  guide: string | null;
  journals?: JournalEntryRecord[];
  activeShip?: {
    id: number;
    status: "under_review" | "pending_second_pass";
    created_at: string | null;
  } | null;
  // owner-only: locked fruit waiting on this project's build-complete submission
  pendingFruit?: {
    amount: number;
    fruit_type: string | null;
  } | null;
  reward_estimate_multiplier?: number;
  // max of journal-hours sum and the latest ship's cumulative Hackatime snapshot
  public_total_hours?: number;
  upvote_count?: number;
  current_user_upvoted?: boolean;
  // "under_review" while a ship is under_review, pending_fraud_review or needs_changes
  streakStatus?: "active" | "under_review";
};

const { data: project, error: fetchError, pending, refresh } = await useLazyFetch<ProjectDetails>(`/api/projects/${projectId}`);

// Must stay declared above every watch/computed that reads it during setup,
// or the TDZ error 500s every project page.
const activeShip = computed(() => project.value?.activeShip ?? null);

// Mirrors explore.vue / ProjectExploreCard upvote semantics.
const upvoteDisabledReason = computed<string | null>(() => {
  if (!isLoggedIn.value) return tI18n("explore.upvote.login_required");
  if (user.value?.hca_verification_status !== "verified") {
    return tI18n("explore.upvote.verify_required");
  }
  return null;
});

async function handleUpvote() {
  const p = project.value;
  if (!p) return;
  if (p.viewer_is_owner) {
    void showAlert({ tone: "info", message: tI18n("explore.upvote.self_disabled") });
    return;
  }
  if (!isLoggedIn.value) {
    signIn();
    return;
  }
  if (upvoteDisabledReason.value) {
    void showAlert({ tone: "info", message: upvoteDisabledReason.value });
    return;
  }
  const prev = { upvoted: !!p.current_user_upvoted, count: p.upvote_count ?? 0 };
  p.current_user_upvoted = !prev.upvoted;
  p.upvote_count = prev.upvoted ? prev.count - 1 : prev.count + 1;
  try {
    const res = await $fetch<{ upvoted: boolean; count: number }>(
      `/api/projects/${projectId}/upvote`,
      { method: "POST" },
    );
    p.current_user_upvoted = res.upvoted;
    p.upvote_count = res.count;
  } catch (err) {
    console.error("[project] upvote failed", err);
    p.current_user_upvoted = prev.upvoted;
    p.upvote_count = prev.count;
  }
}
const hasActiveReview = computed(() => !!activeShip.value);
// Shown as accepted so students don't withdraw a ship awaiting only the final check.
const isSecondPass = computed(
  () => activeShip.value?.status === "pending_second_pass",
);

// Blocking fetch of the slim /og endpoint so unfurlers (no JS) get meta.
// Skipped when embedded, since the host page owns the document head.
if (!props.embeddedProjectId) {
  const { data: ogData } = await useAsyncData(`project-og-${projectId}`, () =>
    $fetch(`/api/projects/${projectId}/og`).catch(() => null),
  );
  const ogDescription = () =>
    ogData.value
      ? `A ${ogData.value.type} project on Macondo${ogData.value.hours ? `, ${ogData.value.hours}h in` : ""}.`
      : undefined;
  useSeoMeta({
    title: () => (ogData.value ? `${ogData.value.name} · Macondo` : undefined),
    ogTitle: () => (ogData.value ? `${ogData.value.name} · Macondo` : undefined),
    description: ogDescription,
    ogDescription,
    ogType: "website",
    twitterCard: "summary_large_image",
  });
  if (import.meta.server && ogData.value) {
    defineOgImage("Project", {
      title: ogData.value.name,
      owner: ogData.value.ownerName,
      ownerImage: ogData.value.ownerImage
        ? `/api/og/thumb?u=${encodeURIComponent(ogData.value.ownerImage)}`
        : undefined,
      hours: ogData.value.hours,
      image: ogData.value.hasThumbnail
        ? `/api/og/thumb?u=${encodeURIComponent(ogData.value.thumbnailUrl ?? "")}`
        : undefined,
    });
  }
}

const isOwner = computed(() => {
  return !!user.value && !!project.value && user.value.id === project.value.user_id;
});

// Owner or active collaborator; gates the member-only read views (hours, notes, archived journals).
const isMember = computed(() => {
  return project.value?.viewer_can_edit ?? isOwner.value;
});

const projectStreakCalendarOpen = ref(false);

const ownerDisplayName = computed(() => project.value?.owner?.username ?? '—');

const isWindowed = computed(() => props.embeddedWindowed || route.query.windowed === '1');

const emit = defineEmits<{ close: [] }>();

function closeModal() {
  if (props.embeddedWindowed) {
    emit('close');
  } else if (import.meta.client) {
    window.parent.postMessage({ type: 'close-modal' }, '*');
  }
}

const hasJournals = computed(() => journalEntries.value.length > 0);

// Only html guide projects have generated files to download.
const isHtmlGuideProject = computed(
  () => (project.value as Record<string, unknown>)?.guide === 'html',
);

const currentStage = computed(() => Number(project.value?.stage) || 1);
const fruitName = computed(() => (project.value?.fruit as string) || '');

const projectStreakDays = computed(() => Number(project.value?.project_streak_days) || 0);
// Server value respects level-specific caps; the fallback covers stale payloads mid-deploy.
const projectMultiplier = computed(() => {
  const serverMultiplier = Number(project.value?.reward_estimate_multiplier);
  return Number.isFinite(serverMultiplier) && serverMultiplier >= 1
    ? serverMultiplier
    : 1 + projectStreakDays.value * 0.01; // 1% bonus per streak day
});

const stageLabel = computed(() => {
  const key = `project_detail.plant_stage.${currentStage.value}`;
  return teI18n(key) ? tI18n(key) : tI18n('project_detail.plant_stage.1');
});

const fruitFunFacts: Record<string, string[]> = {
  Mango: [
    "Mango trees can reach up to 45 meters in height, with dense foliage that stays green throughout the entire year!",
    "Mango trees don't require constant watering and can survive fires and long periods of drought.",
    "It is speculated that mangoes were first introduced to America by the Portuguese, who cultivated them in Brazil during the colonial period.",
    "Mango wood can be used for crafting furniture, instruments, and many more things!",
    "In some indigenous communities, mango is used as a disinfectant, contraceptive, or even as a tint for skin conditions like vitiligo.",
  ],
  Avocado: [
    "The first evidence of avocado consumption dates from 10,000 years ago, found in Coaxcatlan, Mexico!",
    "There exist 8 known species of avocados, 3 of them commonly used.",
    "Avocados aren't sweet nor salty, but a secret third thing called umami.",
    "Avocado fruit and oils are widely used in beauty products.",
    "Avocado trees grow from 8 to 20 meters tall, with hermaphrodite flowers that open and close throughout the day!",
  ],
  Papaya: [
    "Its name derives from the Mayan term 'paapay-ya', meaning 'marbled sapodilla'.",
    "There's a famous Colombian saying: 'No des papaya' (Don't give papaya) - a warning to be careful so no one takes advantage of you!",
    "Papaya peel contains papain, an enzyme widely used in the pharmaceutical industry for its anti-inflammatory and healing effects.",
    "Papayas can sometimes weigh up to 20 kilograms!",
    "Papaya trees can grow in all sorts of land, from the driest and most abandoned parcel to a big enough houseplant.",
  ],
  Guava: [
    "Guavas contain four times more vitamin C than oranges!",
    "There are over a hundred different guava species.",
    "Colombia is one of the greatest producers of guavas, but demand is so high it rarely gets exported!",
    "One of the most popular candies made with guava is the Bocadillo, made by cooking guavas with sugarcane and wrapping it in dried Bijao leaves.",
    "Even if you don't recognize a guava by looks, its characteristic smell will always make it identifiable.",
  ],
  Pineapple: [
    "A pineapple plant produces fruit only once a year! One whole year for this sweet, fragrant fruit.",
    "The 'pine' in 'pineapple' actually refers to 'pinecone', due to their similar shape. Pineapples definitely taste better, though.",
    "Pineapples can vary their color according to the season - some can even be blue, red, purple and white!",
    "Sometimes eating too much pineapple can make your mouth burn and itch, thanks to an enzyme called bromelain.",
    "Pineapples, known in Spanish as 'ananás', means 'excellent fruits' in Portuguese.",
  ],
  Cocoa: [
    "Theobroma means 'food of the gods' in Greek! Cacao has been used by indigenous communities for over 5,300 years.",
    "Cacao can increase dopamine and serotonin levels thanks to theobromine - so when people say chocolate brings happiness, it's actually true!",
    "The Mayans had a cacao god, Ek Chuah, and the Aztecs believed Quetzalcoatl gave cacao to humanity as a gift.",
    "Cacao cultivators had to maintain celibacy for thirteen days before beginning its planting!",
    "Cacao also contains epicatechin, a component said to reduce the risks of diabetes, cancer, and heart attacks.",
  ],
  Coconut: [
    "It generally takes from 4 to 6 months for a coconut to be fully ripe.",
    "There are fossil registers of plants similar to coconut palms that grew in New Zealand around 15 million years ago!",
    "Coconuts are used to make Cocadas, a popular Latin American sweet made with grated coconut and sugarcane.",
    "Although coconuts seem to be nuts, they actually fall under the same category as peaches and avocados!",
    "Coconut palms can grow up to 30 meters tall, with leaves that can reach 4 to 7 meters long.",
  ],
  Watermelon: [
    "The Guinness record for the heaviest watermelon ever was given to one weighing more than 159kg!",
    "Watermelon seeds are edible — rich in vitamin E, they can be eaten roasted or used in folk medicine.",
    "Originally cultivated for their high water content, watermelons were stored to consume during dry seasons as a portable water source.",
    "Archaeologists have found watermelon seeds in ancient sites, some being over 5,000 years old!",
    "Also known as sandía, melón de agua, acendría, sindria, or patilla — its scientific name is Citrullus lanatus.",
  ],
};

const fruitFunFactsEs: Record<string, string[]> = {
  Mango: [
    "¡Los árboles de mango pueden alcanzar hasta 45 metros de altura, con un follaje denso que se mantiene verde todo el año!",
    "Los mangos no necesitan riego constante y sobreviven a incendios y largos períodos de sequía.",
    "Se cree que el mango llegó a América gracias a los portugueses, que lo cultivaron en Brasil durante la época colonial.",
    "¡La madera del mango sirve para fabricar muebles, instrumentos y mucho más!",
    "En algunas comunidades indígenas el mango se usa como desinfectante, anticonceptivo o incluso como tinte para la piel.",
  ],
  Avocado: [
    "¡La primera evidencia del consumo de aguacate data de hace 10 000 años, encontrada en Coaxcatlán, México!",
    "Existen 8 especies conocidas de aguacate; 3 se usan comúnmente.",
    "Los aguacates no son ni dulces ni salados, sino un tercer sabor secreto llamado umami.",
    "El aguacate y sus aceites se usan mucho en productos de belleza.",
    "¡Los árboles crecen entre 8 y 20 metros, con flores hermafroditas que abren y cierran durante el día!",
  ],
  Papaya: [
    'Su nombre viene del maya "paapay-ya", que significa "zapote jaspeado".',
    '¡En Colombia hay un dicho famoso: "No des papaya" — sé precavido para que nadie se aproveche de ti!',
    "La cáscara de la papaya contiene papaína, una enzima muy usada en la industria farmacéutica por su efecto antiinflamatorio y cicatrizante.",
    "¡Las papayas pueden llegar a pesar hasta 20 kg!",
    "El árbol de papaya crece en casi cualquier suelo, desde parcelas muy secas hasta una maceta grande en casa.",
  ],
  Guava: [
    "¡Las guayabas contienen cuatro veces más vitamina C que las naranjas!",
    "Existen más de cien especies distintas de guayaba.",
    "¡Colombia es uno de los mayores productores, pero la demanda interna es tan alta que casi no se exporta!",
    "Uno de los dulces más populares es el Bocadillo: guayaba y panela cocinadas y envueltas en hoja de bijao.",
    "Aunque no reconozcas una guayaba por su forma, su aroma característico siempre la delata.",
  ],
  Pineapple: [
    "¡Una planta de piña produce fruto solo una vez al año! Un año entero para una sola fruta dulce y aromática.",
    '"Pineapple" hace referencia a la piña del pino por su forma parecida. La piña de comer definitivamente sabe mejor.',
    "¡Las piñas pueden variar de color según la temporada: azules, rojas, púrpuras o blancas!",
    "Comer demasiada piña a veces hace que la boca arda por una enzima llamada bromelina.",
    'Piña se conoce también como "ananás", palabra que en portugués significa "fruta excelente".',
  ],
  Cocoa: [
    '¡"Theobroma" significa en griego "alimento de los dioses"! El cacao lleva más de 5 300 años siendo usado por comunidades indígenas.',
    "El cacao sube los niveles de dopamina y serotonina gracias a la teobromina — ¡así que sí, el chocolate sí trae felicidad!",
    "Los mayas tenían un dios del cacao, Ek Chuah, y los aztecas creían que Quetzalcóatl regaló el cacao a la humanidad.",
    "¡Los cultivadores de cacao debían mantener celibato durante trece días antes de sembrarlo!",
    "También contiene epicatequina, un componente que reduce los riesgos de diabetes, cáncer e infartos.",
  ],
  Coconut: [
    "Un coco suele tardar entre 4 y 6 meses en madurar por completo.",
    "¡Hay registros fósiles de plantas parecidas al coco en Nueva Zelanda de hace unos 15 millones de años!",
    "Los cocos sirven para preparar cocadas, un dulce típico latinoamericano con coco rallado y panela.",
    "¡Aunque el coco parece una nuez, está en la misma categoría que los duraznos y los aguacates!",
    "Las palmas de coco alcanzan hasta 30 metros de altura, con hojas de 4 a 7 metros de largo.",
  ],
  Watermelon: [
    "¡El récord Guinness de la sandía más pesada del mundo lo tiene una que pesó más de 159 kg!",
    "Las semillas de la sandía son comestibles; se pueden comer tostadas y usar en medicina popular por su vitamina E.",
    "Originalmente se cultivaban por su alto contenido en agua y se almacenaban para las épocas secas.",
    "¡Arqueólogos han encontrado semillas de sandía en asentamientos de más de 5 000 años!",
    "También conocida como sandía, melón de agua, acendría, sindria o patilla — su nombre científico es Citrullus lanatus.",
  ],
};
const funFact = computed(() => {
  const pool = funFactLocale.value === "es" && fruitFunFactsEs[fruitName.value]
    ? fruitFunFactsEs[fruitName.value]
    : fruitFunFacts[fruitName.value];
  if (!pool || pool.length === 0) return "";
  return pool[Math.floor(Math.abs(fruitName.value.length * 7) % pool.length)] || pool[0]; // stable pick per fruit
});

function translateFruitName(raw: string | null | undefined): string {
  if (!raw) return tI18n("project_detail.fruit_name.fruit");
  const key = `project_detail.fruit_name.${raw}`;
  return teI18n(key) ? tI18n(key) : raw;
}
const translatedFruitName = computed(() => translateFruitName(fruitName.value));

// The ledger stores gold; the fruit count is informational only.
function formatGoldWithFruit(goldAmount: number): string {
  const gold = Math.floor(goldAmount);
  const goldPerFruit = levelConfig[Number(project.value?.level) as ProjectLevel]?.goldPerFruit;
  if (!goldPerFruit || !project.value?.fruit) {
    return `${gold} gold`;
  }
  return `${gold} gold (${Math.floor(gold / goldPerFruit)} ${translateFruitName(project.value.fruit)})`;
}

const thumbnailUrl = computed(() => {
  return (project.value?.thumbnail_url as string) || '';
});

// Mirrors server/lib/github.ts host set, which can't be imported client-side.
const repoProvider = computed<{ label: string; isGithub: boolean } | null>(
  () => {
    const url = project.value?.repository_url as string | null | undefined;
    if (!url) return null;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === "github.com") return { label: "GitHub", isGithub: true };
      if (host === "codeberg.org") return { label: "Codeberg", isGithub: false };
      return { label: "Repository", isGithub: false };
    } catch {
      return null;
    }
  },
);

const descriptionHtml = ref('');
async function refreshDescriptionHtml() {
  descriptionHtml.value = await renderDescMd(
    (project.value?.description as string) || 'No description',
  );
}
watch(
  () => project.value?.description,
  () => { void refreshDescriptionHtml(); },
  { immediate: true },
);

// Live Hackatime totals for the member hours chip. Client-only: SSR $fetch carries no session cookie.
const hackatimeProjectsList = ref<{ name: string; total_seconds: number; total_seconds_in_window?: number }[]>([]);
const loadingHackatime = ref(false);

async function loadHackatimeProjects() {
  if (import.meta.server) return;
  if (loadingHackatime.value || hackatimeProjectsList.value.length > 0) return;
  if (!project.value) return;
  loadingHackatime.value = true;
  try {
    // program hours start date (MACONDO_HOURS_START_DATE)
    hackatimeProjectsList.value = (await $fetch<{ projects: { name: string; total_seconds: number; total_seconds_in_window?: number }[] }>(`/api/hackatime/projects?since=${encodeURIComponent("2026-04-15")}`)).projects;
  } catch (error) {
    hackatimeProjectsList.value = [];
    console.error("[hackatime] load failed", error);
  } finally {
    loadingHackatime.value = false;
  }
}

watch(isMember, (member) => {
  if (member) void loadHackatimeProjects();
}, { immediate: true });

function formatHackatimeHours(totalSeconds: number): string {
  return (totalSeconds / 3600).toFixed(1) + 'h';
}

const totalHackatimeSeconds = computed(() => {
  let total = 0;
  for (const name of (project.value?.hackatime_projects as string[]) || []) {
    const match = hackatimeProjectsList.value.find((hp) => hp.name === name);
    if (match) total += match.total_seconds_in_window ?? match.total_seconds;
  }
  return total;
});

const journalEntries = computed(() => project.value?.journals ?? []);
const showArchivedSection = ref(false);

const activeJournals = computed(() =>
  journalEntries.value.filter((j) => !j.archived),
);

// Viewer-only: group approval splits gold by each member's hours, and Hackatime is already per-viewer.
const myJournalHours = computed(() =>
  activeJournals.value.reduce(
    (sum, j) =>
      j.author_id === user.value?.id ? sum + (Number(j.hours) || 0) : sum,
    0,
  ),
);

const totalLoggedSeconds = computed(
  () => totalHackatimeSeconds.value + myJournalHours.value * 3600,
);

// Rounded because the server aggregate is approximate; matches the OG unfurl number.
const publicHoursRounded = computed(() =>
  Math.round(Number(project.value?.public_total_hours ?? 0)),
);

// Off-screen sizers measure both chip texts so the width animates between exact sizes.
const hoursHovered = ref(false);
const hoursDefaultSizer = ref<HTMLElement | null>(null);
const hoursBreakdownSizer = ref<HTMLElement | null>(null);
const hoursDefaultWidth = ref(0);
const hoursBreakdownWidth = ref(0);

function measureHoursWidths() {
  if (hoursDefaultSizer.value) hoursDefaultWidth.value = hoursDefaultSizer.value.offsetWidth;
  if (hoursBreakdownSizer.value) hoursBreakdownWidth.value = hoursBreakdownSizer.value.offsetWidth;
}

onMounted(() => {
  void nextTick(measureHoursWidths);
});

watch(
  [totalLoggedSeconds, totalHackatimeSeconds, myJournalHours],
  () => void nextTick(measureHoursWidths),
);

const archivedJournals = computed(() =>
  [...journalEntries.value]
    .filter((j) => j.archived)
    .sort(
      (a, b) =>
        new Date(b.archived_at ?? b.created_at).getTime() -
        new Date(a.archived_at ?? a.created_at).getTime(),
    ),
);

type ShipHistoryItem = {
  id: number;
  status: string;
  hackatime_hours: number | null;
  override_hours: number | null;
  needs_funding?: boolean;
  needs_funding_amount_cents?: number | null;
  decision_user_message: string | null;
  decision_user_message_original?: string | null;
  decision_user_message_is_translated?: boolean;
  decision_user_message_is_edited?: boolean;
  decision_user_message_attachments?: Array<{ url: string; filename: string; mime_type: string; sha: string }> | null;
  is_fraud_rejection?: boolean;
  created_at: string | null;
  reviewed_at: string | null;
  fruitRewarded: number;
  grantAmountCents?: number | null;
  grantStatus?: "queued" | "sent" | null;
};
const shipHistory = ref<ShipHistoryItem[]>([]);

type TimelineEvent =
  | { kind: "created"; at: string; key: string }
  | { kind: "journal"; at: string; key: string; entry: JournalEntryRecord }
  | { kind: "ship_submit"; at: string; key: string; ship: ShipHistoryItem; ordinal: number }
  | { kind: "ship_decision"; at: string; key: string; ship: ShipHistoryItem; ordinal: number };

const timelineTab = ref<"timeline" | "journal">("timeline");

// Archived journals stay hidden so students can declutter without losing review context.
const timelineEvents = computed<TimelineEvent[]>(() => {
  const events: TimelineEvent[] = [];
  const proj = project.value;
  if (!proj) return events;

  const createdAt = (proj as unknown as { created_at?: string }).created_at;
  if (createdAt) {
    events.push({ kind: "created", at: createdAt, key: `created-${proj.id}` });
  }

  for (const entry of journalEntries.value) {
    if (entry.archived) continue;
    events.push({
      kind: "journal",
      at: entry.created_at,
      key: `journal-${entry.id}`,
      entry,
    });
  }

  // shipHistory is newest-first; reverse so ordinal 1 is the earliest ship
  [...shipHistory.value].reverse().forEach((ship, idx) => {
    const ordinal = idx + 1;
    if (ship.created_at) {
      events.push({
        kind: "ship_submit",
        at: ship.created_at,
        key: `ship-submit-${ship.id}`,
        ship,
        ordinal,
      });
    }
    if (ship.reviewed_at && (ship.status === "shipped"
      || ship.status === "shipped_missing_airtable"
      || ship.status === "rejected"
      || ship.status === "needs_changes")) {
      events.push({
        kind: "ship_decision",
        at: ship.reviewed_at,
        key: `ship-decision-${ship.id}`,
        ship,
        ordinal,
      });
    }
  });

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events;
});

function shipDecisionLabel(status: string): string {
  if (status === "shipped" || status === "shipped_missing_airtable") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "needs_changes") return "needs changes";
  return status;
}

function formatTimelineTime(iso: string): string {
  // empty until mounted to avoid a hydration mismatch (see timestampsReady)
  if (!timestampsReady.value) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatLocalDateTime(iso: string): string {
  if (!timestampsReady.value) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Per-ship toggle between AI-translated feedback and the reviewer's original English.
const showingOriginalShipIds = ref<Set<number>>(new Set());

function isShowingOriginal(shipId: number): boolean {
  return showingOriginalShipIds.value.has(shipId);
}

function toggleShowOriginal(shipId: number) {
  const next = new Set(showingOriginalShipIds.value);
  if (next.has(shipId)) next.delete(shipId);
  else next.add(shipId);
  showingOriginalShipIds.value = next;
}

async function loadShipHistory() {
  try {
    shipHistory.value = await $fetch<ShipHistoryItem[]>(`/api/projects/${projectId}/ships`);
  } catch {
    shipHistory.value = [];
  }
}

if (import.meta.client) {
  watch(
    () => project.value?.id,
    (id) => {
      if (id && shipHistory.value.length === 0) loadShipHistory();
    },
    { immediate: true },
  );

  // feedback is translated server-side per the i18n_locale cookie, so refetch on locale change
  const { locale } = useI18n();
  watch(locale, async () => {
    await Promise.all([refresh(), loadShipHistory()]);
  });
}

const shippedShips = computed(() =>
  shipHistory.value.filter((s) => s.status === "shipped" || s.status === "shipped_missing_airtable"),
);

// Floored per ship so the total equals the sum of the displayed values.
const totalFruitEarned = computed(() =>
  shippedShips.value.reduce((sum, s) => sum + Math.floor(s.fruitRewarded ?? 0), 0),
);

const permRejected = computed(() => project.value?.permRejected === true);

// "In queue", not "under review": students read that as active review and opened tickets.
function formatShipStatus(_status: "under_review" | "pending_second_pass") {
  // second pass has its own banner (see isSecondPass)
  return "In queue";
}

// Reports are filed as support tickets; category "other" keeps them out of
// AUTO_ANSWER_CATEGORIES so the KB agent never auto-answers one.
const showReportModal = ref(false);
const reportReason = ref('');
const reportSubmitting = ref(false);

const canReportProject = computed(() => !!user.value && !!project.value && !isOwner.value);

function openReportModal() {
  reportReason.value = '';
  showReportModal.value = true;
}

async function submitReport() {
  const reason = reportReason.value.trim();
  if (reason.length < 10 || reportSubmitting.value || !project.value) return;
  reportSubmitting.value = true;
  try {
    await $fetch('/api/support/tickets', {
      method: 'POST',
      body: {
        subject: `${tI18n('project_detail.report_subject_prefix')}: ${project.value.name}`.slice(0, 200), // subject length cap
        // the Slack mirror doesn't render related_project_id, so link it in the body
        body: `${reason}\n\n${window.location.origin}/projects/${projectId}`,
        category: 'other',
        priority: 'high',
        related_project_id: project.value.id,
      },
    });
    showReportModal.value = false;
    await showAlert({ tone: 'success', message: tI18n('project_detail.report_sent') });
  } catch (err) {
    await showAlert({
      tone: 'error',
      message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || tI18n('project_detail.report_failed'),
    });
  } finally {
    reportSubmitting.value = false;
  }
}
</script>

<template>
  <div :class="isWindowed ? 'bg-parchment' : 'min-h-screen bg-parchment'">
    <div v-if="pending && !project" class="flex items-center justify-center min-h-[60vh]">
      <component :is="'div'" class="max-w-sm mx-4">
        <div class="p-8 text-center">
          <div class="w-10 h-10 border-[3px] border-ds-brown/30 border-t-ds-brown rounded-full animate-spin mx-auto mb-3" />
          <p class="text-sm text-ds-brown/60">Loading project...</p>
        </div>
      </component>
    </div>

    <div v-else-if="fetchError || !project" class="flex items-center justify-center min-h-[60vh]">
      <component :is="'div'" class="max-w-sm mx-4">
        <div class="p-8 text-center">
          <h2 class="text-xl font-bold text-ds-brown mb-2">Project not found</h2>
          <p class="text-sm text-ds-brown/60">This project doesn't exist or has been deleted.</p>
        </div>
      </component>
    </div>

    <template v-else>
      <div class="max-w-4xl mx-auto px-4 pb-12 pt-6 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <button
            v-if="isWindowed"
            class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
            @click="closeModal"
          >
            <ArrowLeft :size="16" />
            {{ $t('project_detail.back_to_farm') }}
          </button>
          <NuxtLink
            v-else
            to="/dashboard"
            class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
          >
            <ArrowLeft :size="16" />
            {{ $t('project_detail.back_to_farm') }}
          </NuxtLink>
          <a
            v-if="isWindowed"
            :href="`/projects/${projectId}`"
            target="_blank"
            class="text-sm text-ds-brown flex items-center gap-1 hover:opacity-70 transition-opacity"
          >
            <ExternalLink :size="16" />
            open in new tab
          </a>
        </div>

        <component :is="'div'">
          <div class="flex flex-col" :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
            <div class="relative w-full h-40 sm:h-64 bg-ds-brown/10 overflow-hidden border-[3px] border-ds-brown">
              <img
                v-if="thumbnailUrl"
                :src="thumbnailUrl"
                alt="Project thumbnail"
                class="w-full h-full object-cover"
              >
              <div v-else class="w-full h-full bg-parchment relative overflow-hidden flex items-center justify-center">
                <img
                  v-for="n in 8"
                  :key="n"
                  :src="['/images/fruits/avocado/icon_exterior.webp', '/images/fruits/mango/icon.webp', '/images/fruits/papaya/icon_exterior.webp', '/images/fruits/guava/icon_exterior.webp', '/images/fruits/pineapple/icon.webp', '/images/fruits/cocoa/icon_exterior.webp', '/images/fruits/coco/icon_exterior.webp', '/images/fruits/avocado/icon_interior.webp'][n - 1]"
                  class="absolute opacity-15 w-8 h-8 object-contain pointer-events-none"
                  :style="{ top: `${10 + ((n * 37) % 80)}%`, left: `${5 + ((n * 43) % 90)}%`, transform: `rotate(${n * 45}deg)` }"
                  alt=""
                >
                <span class="relative z-10 text-ds-brown/40 text-sm font-bold">No image yet</span>
              </div>
            </div>

            <div
              v-if="hasActiveReview"
              class="mt-4 border-[3px] border-ds-success/80 bg-[#edf0c4] px-4 py-3"
            >
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <template v-if="isSecondPass">
                    <p class="text-sm font-bold text-ds-brown">
                      {{ isMember ? "Your project has been accepted!" : "This project has been accepted" }}
                    </p>
                    <p class="text-xs text-ds-brown/70 mt-1">
                      It passed review and is waiting on a final second-pass check before
                      {{ isMember ? "your rewards are released. There's nothing you need to do." : 'the reward is released.' }}
                    </p>
                  </template>
                  <template v-else>
                    <p class="text-sm font-bold text-ds-brown">
                      {{ isMember ? 'Your project is in the review queue!' : 'This project is in the review queue' }}
                    </p>
                    <p class="text-xs text-ds-brown/70 mt-1">
                      {{ formatShipStatus(activeShip!.status) }}
                      <template v-if="activeShip?.created_at">
                        since {{ formatLocalDateTime(activeShip.created_at) }}.
                      </template>
                    </p>
                  </template>
                  <p
                    v-if="isMember && project.streakStatus === 'under_review'"
                    class="text-xs font-bold text-ds-brown mt-1"
                  >
                    {{ $t('project_detail.streak_protected_under_review') }}
                  </p>
                </div>
              </div>
            </div>

            <div class="p-4">
              <div>
                <div class="flex items-center gap-2 min-w-0 flex-wrap">
                  <h1 class="text-xl sm:text-2xl font-bold text-ds-brown break-words min-w-0">{{ (project.name as string) || 'Untitled' }}</h1>
                  <ExtraFruityBadge v-if="(project as { is_extra_fruity?: boolean }).is_extra_fruity" />
                  <button
                    type="button"
                    class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border-2 transition-colors shrink-0"
                    :class="[
                      project.current_user_upvoted
                        ? 'bg-ds-brown text-parchment border-ds-brown'
                        : 'bg-parchment text-ds-brown border-ds-brown/40 hover:border-ds-brown',
                      (project.viewer_is_owner || upvoteDisabledReason) && 'opacity-60 cursor-help',
                    ]"
                    :aria-disabled="!!(project.viewer_is_owner || upvoteDisabledReason)"
                    :title="project.viewer_is_owner ? $t('explore.upvote.self_disabled') : upvoteDisabledReason ?? $t('explore.upvote.label')"
                    @click.prevent.stop="handleUpvote"
                  >
                    <ChevronUp class="w-3.5 h-3.5" />
                    <span class="tabular-nums">{{ project.upvote_count ?? 0 }}</span>
                  </button>
                </div>

                <div class="mt-1">
                  <div class="text-sm text-ds-brown/70 break-words min-w-0 prose-desc" v-html="descriptionHtml" />
                </div>

                <NuxtLink
                  v-if="project.owner"
                  :to="`/u/${project.owner.id}`"
                  class="flex items-center gap-2 mt-2 w-fit hover:opacity-70 transition-opacity no-underline"
                >
                  <div class="w-8 h-8 rounded-full overflow-hidden border-2 border-ds-brown/40 shrink-0">
                    <img v-if="project.owner.image" :src="project.owner.image" :alt="ownerDisplayName" class="w-full h-full object-cover">
                    <div v-else class="w-full h-full bg-ds-brown/20 flex items-center justify-center text-xs font-bold text-ds-brown">
                      {{ ownerDisplayName.charAt(0).toUpperCase() }}
                    </div>
                  </div>
                  <span class="text-sm font-semibold text-ds-brown/80 truncate">by {{ ownerDisplayName }}</span>
                </NuxtLink>

                <!-- Own row so the hours chip's hover-expand doesn't wrap chips below. -->
                <div
                  v-if="project.pendingFruit && project.pendingFruit.amount > 0"
                  class="flex flex-wrap items-center gap-2 mt-2"
                >
                  <div
                    class="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold border-[3px] border-tuscan-sun-700/60 bg-tuscan-sun-400/15 text-tuscan-sun-800"
                    :title="`${Math.floor(project.pendingFruit.amount)} gold pending.`"
                  >
                    <img
                      src="/images/icons/money.webp"
                      alt="gold"
                      class="w-7 h-7 grayscale opacity-80"
                    >
                    {{ Math.floor(project.pendingFruit.amount) }} pending
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
                  <!-- Off-screen sizers for the hours chip width animation. -->
                  <template v-if="isMember && totalLoggedSeconds > 0">
                    <span
                      ref="hoursDefaultSizer"
                      class="fixed -top-[9999px] -left-[9999px] inline-flex items-center px-3 py-1.5 text-sm font-bold border-[3px] border-ds-brown whitespace-nowrap pointer-events-none"
                      aria-hidden="true"
                    >
                      {{ formatHackatimeHours(totalLoggedSeconds) }} logged
                    </span>
                    <span
                      ref="hoursBreakdownSizer"
                      class="fixed -top-[9999px] -left-[9999px] inline-flex items-center px-3 py-1.5 text-sm font-bold border-[3px] border-ds-brown whitespace-nowrap pointer-events-none"
                      aria-hidden="true"
                    >
                      {{ formatHackatimeHours(totalHackatimeSeconds) }} Hackatime + {{ formatHackatimeHours(myJournalHours * 3600) }} journals
                    </span>
                  </template>
                  <!-- In flow (not absolute) so expanding pushes siblings instead of overlaying them. -->
                  <span
                    v-if="isMember && totalLoggedSeconds > 0"
                    class="group relative inline-flex items-center text-sm font-bold border-[3px] border-ds-brown bg-ds-brown text-parchment whitespace-nowrap cursor-default overflow-hidden transition-[width] duration-200 ease-out"
                    :style="
                        hoursDefaultWidth > 0
                            ? { width: (hoursHovered ? hoursBreakdownWidth : hoursDefaultWidth) + 'px' }
                            : { width: 'auto' }
                    "
                    @mouseenter="hoursHovered = true"
                    @mouseleave="hoursHovered = false"
                    :title="$t('project_detail.hackatime_total_tooltip')"
                  >
                    <span class="px-3 py-1.5">
                      {{ formatHackatimeHours(totalHackatimeSeconds) }} Hackatime + {{ formatHackatimeHours(myJournalHours * 3600) }} journals
                    </span>
                    <span class="absolute inset-0 flex items-center px-3 bg-ds-brown transition-opacity duration-200 ease-out group-hover:opacity-0">
                      {{ formatHackatimeHours(totalLoggedSeconds) }} logged
                    </span>
                  </span>

                  <!-- !isMember stops the public number flashing at editors while
                       their Hackatime list loads. -->
                  <span
                    v-else-if="!isMember && publicHoursRounded >= 1"
                    class="inline-flex items-center px-3 py-1.5 text-sm font-bold border-[3px] border-ds-brown bg-ds-brown text-parchment whitespace-nowrap cursor-default"
                    :title="$t('project_detail.public_hours_tooltip')"
                  >
                    {{ $t('project_detail.public_hours_chip', { hours: publicHoursRounded }) }}
                  </span>

                  <span class="inline-flex items-center px-3 py-1.5 text-sm font-bold border-[3px] border-ds-brown bg-ds-brown text-parchment">
                    Level {{ project.level ?? '-' }} · {{ project.type === 'hardware' ? 'Hardware' : 'Software' }}
                  </span>

                  <div v-if="project.repository_url" class="flex items-center">
                    <a
                      :href="project.repository_url as string"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="flex items-center gap-2 text-sm font-semibold text-ds-brown/70 hover:text-ds-brown transition-colors px-3 py-1.5 border-[3px] border-ds-brown/20 hover:border-ds-brown/40"
                    >
                      <svg v-if="repoProvider?.isGithub" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                      <GitBranch v-else :size="20" />
                      {{ repoProvider?.label ?? 'Repository' }}
                    </a>
                  </div>

                  <div v-if="project.demo_url" class="flex items-center">
                    <a
                      :href="project.demo_url as string"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="flex items-center gap-2 text-sm font-semibold text-ds-brown/70 hover:text-ds-brown transition-colors px-3 py-1.5 border-[3px] border-ds-brown/20 hover:border-ds-brown/40"
                    >
                      <ExternalLink :size="16" />
                      Demo
                    </a>
                  </div>

                </div>

                <div v-if="isHtmlGuideProject && isMember" class="flex flex-wrap items-center gap-2 mt-3">
                  <a
                    :href="`/api/projects/${projectId}/download`"
                    class="px-3 py-1.5 text-xs font-bold border-2 border-ds-brown/40 text-ds-brown hover:border-ds-brown transition-colors"
                    download
                  >
                    {{ $t('project_detail.download_files') }}
                  </a>
                </div>
              </div>

              <div class="flex items-center gap-4 mt-4">
                <PlantDisplay
                  v-if="fruitName"
                  :fruit="fruitName"
                  :stage="currentStage"
                  class="shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <p v-if="fruitName" class="text-lg font-bold text-ds-brown">{{ translatedFruitName }}</p>
                  <p class="text-sm font-bold text-ds-brown/60">{{ $t('project_detail.stage_label', { stage: currentStage, name: stageLabel }) }}</p>
                  <div class="flex flex-wrap items-center gap-2 mt-2">
                    <span
                      class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border-2 border-ds-brown/20 bg-ds-brown/5 text-ds-brown"
                      :title="$t('project_detail.plant_growth_tooltip')"
                    >
                      🔥 {{ $t('project_detail.project_streak_days', { count: projectStreakDays }) }}
                    </span>
                    <span
                      class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border-2 border-ds-brown/20 bg-ds-brown/5 text-ds-brown"
                      :title="$t('project_detail.ship_bonus_tooltip', { multiplier: projectMultiplier.toFixed(2) })"
                    >
                      {{ $t('project_detail.ship_bonus', { multiplier: projectMultiplier.toFixed(2) }) }}
                    </span>
                  </div>
                  <!-- Explains why this differs from the dashboard (any-project) streak. -->
                  <p v-if="isMember" class="text-xs text-ds-brown/40 mt-1">
                    {{ $t('project_detail.project_streak_explainer') }}
                  </p>
                  <p v-if="funFact" class="text-xs text-ds-brown/40 mt-2 italic">{{ funFact }}</p>
                </div>
              </div>
            </div>
          </div>
        </component>

        <component :is="'div'" v-if="isMember && permRejected">
          <div class="p-4 border-[3px] border-ds-danger bg-ds-danger/10" :class="isWindowed && 'mb-4'">
            <div class="flex items-start gap-3">
              <CircleX :size="22" class="text-ds-danger shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-bold text-ds-danger">{{ $t('project_detail.perm_rejected_title') }}</h3>
                <p class="text-sm text-ds-brown/80 mt-1">
                  {{ $t('project_detail.perm_rejected_body') }}
                </p>
              </div>
            </div>
          </div>
        </component>

        <ProjectCollaboratorsSection
          v-if="project?.id && project?.owner"
          :project-id="project.id"
          :owner="{
            id: project.owner.id,
            username: project.owner.username,
            slack_id: project.owner.slack_id,
            image: project.owner.image,
          }"
          :journals="(journalEntries ?? []).map((j) => ({
            id: j.id,
            short_brief: j.short_brief,
            hours: j.hours,
            override_hours: (j as { override_hours?: number | null }).override_hours ?? null,
            author_id: j.author_id ?? project?.user_id ?? null,
            created_at: j.created_at,
          }))"
        />

        <!-- Notes stay available during review, so gated on isMember. -->
        <component :is="'div'" v-if="isMember">
          <ProjectNotes :project-id="projectId" />
        </component>

        <component :is="'div'" v-if="isMember || hasJournals || shipHistory.length > 0">
          <div class="p-4" :class="isWindowed && 'pb-4 border-b-2 border-ds-brown'">
            <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div class="flex gap-4 border-b-2 border-ds-brown/20 pb-0 -mb-0">
                <button
                  type="button"
                  class="text-xl font-bold pb-1 transition-colors"
                  :class="timelineTab === 'timeline'
                    ? 'text-ds-brown border-b-[3px] border-ds-brown -mb-[2px]'
                    : 'text-ds-brown/50 hover:text-ds-brown/80'"
                  @click="timelineTab = 'timeline'"
                >
                  {{ $t('project_detail.ship_history_title') }}
                </button>
                <button
                  type="button"
                  class="text-xl font-bold pb-1 transition-colors"
                  :class="timelineTab === 'journal'
                    ? 'text-ds-brown border-b-[3px] border-ds-brown -mb-[2px]'
                    : 'text-ds-brown/50 hover:text-ds-brown/80'"
                  @click="timelineTab = 'journal'"
                >
                  {{ $t('project_detail.journal_section_title') }}
                </button>
              </div>
            </div>

            <div
              v-if="timelineTab === 'timeline' && totalFruitEarned > 0"
              class="mb-4 p-3 border-[3px] border-ds-success bg-ds-success/5"
            >
              <p class="text-sm font-bold text-ds-brown">
                Total Earned: {{ formatGoldWithFruit(totalFruitEarned) }}
              </p>
              <p class="text-xs text-ds-brown/60 mt-1">
                From {{ shippedShips.length }} approved ship(s)
              </p>
            </div>

            <Transition name="tab-fade" mode="out-in">
            <div v-if="timelineTab === 'timeline'" :key="'timeline'">
              <div v-if="timelineEvents.length === 0 && archivedJournals.length === 0" class="text-center py-8 text-ds-brown/40 text-sm">
                {{ $t('project_detail.no_timeline_events') }}
              </div>
              <div v-else-if="timelineEvents.length > 0" class="flex flex-col">
                <div
                  v-for="(evt, idx) in timelineEvents"
                  :key="evt.key"
                  class="px-1"
                >
                  <template v-if="evt.kind === 'journal'">
                    <div class="ml-0 border-[3px] border-ds-brown/25 bg-parchment/60 p-4">
                      <div class="flex items-start gap-3 mb-3">
                        <div class="shrink-0 w-10 h-10 flex items-center justify-center bg-ds-brown/10 border-[2px] border-ds-brown text-ds-brown">
                          <NotebookPen class="w-5 h-5" />
                        </div>
                        <div class="flex-1 min-w-0 flex flex-col gap-1">
                          <div class="text-lg font-bold text-ds-brown truncate">
                            {{ evt.entry.short_brief || $t('project_detail.journal_entry') }}
                            <span v-if="evt.entry.archived" class="text-xs font-normal text-ds-brown/40 ml-2">{{ $t('journal.archived_tag') }}</span>
                          </div>
                          <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2 min-w-0 flex-1">
                              <span class="text-xs text-ds-brown/60 whitespace-nowrap">
                                {{ formatTimelineTime(evt.at) }}
                              </span>
                              <span
                                v-if="evt.entry.author_username || evt.entry.author_slack_id"
                                class="inline-flex items-center gap-1 bg-ds-brown/10 px-2 py-0.5 rounded-full text-xs font-semibold text-ds-brown whitespace-nowrap"
                                :title="`Written by ${evt.entry.author_username ?? evt.entry.author_slack_id}`"
                              >
                                <img
                                  v-if="evt.entry.author_image"
                                  :src="evt.entry.author_image"
                                  :alt="evt.entry.author_username ?? ''"
                                  class="w-4 h-4 border border-ds-brown/30 object-cover"
                                >
                                <span class="truncate max-w-[8rem]">{{ evt.entry.author_username ?? evt.entry.author_slack_id }}</span>
                              </span>
                            </div>
                            <div class="flex items-center gap-2 text-xs text-ds-brown/60 shrink-0">
                              <span v-if="evt.entry.hours" class="bg-ds-brown/10 px-2 py-0.5 rounded-full font-semibold text-ds-brown">
                                {{ evt.entry.hours }}h
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <JournalEntry
                        :entry="evt.entry"
                        :hide-title="true"
                      />
                    </div>
                  </template>
                  <template v-else-if="evt.kind === 'ship_decision'">
                    <div class="ml-0 border-[3px] border-ds-brown/25 bg-parchment/60 overflow-hidden">
                      <div
                        class="flex items-center gap-3 px-4 py-3 border-b-[2px]"
                        :class="evt.ship.status === 'shipped' || evt.ship.status === 'shipped_missing_airtable'
                          ? 'bg-ds-success/15 border-ds-success/60'
                          : evt.ship.status === 'rejected'
                            ? 'bg-ds-danger/10 border-ds-danger/60'
                            : 'bg-ds-warning/15 border-ds-warning/60'"
                      >
                        <div
                          class="shrink-0 w-9 h-9 flex items-center justify-center border-[2px] bg-parchment"
                          :class="evt.ship.status === 'shipped' || evt.ship.status === 'shipped_missing_airtable'
                            ? 'border-ds-success text-ds-success'
                            : evt.ship.status === 'rejected'
                              ? 'border-ds-danger text-ds-danger'
                              : 'border-ds-warning text-ds-brown'"
                        >
                          <CheckCircle2 v-if="evt.ship.status === 'shipped' || evt.ship.status === 'shipped_missing_airtable'" class="w-5 h-5" />
                          <CircleX v-else-if="evt.ship.status === 'rejected'" class="w-5 h-5" />
                          <RotateCcw v-else class="w-5 h-5" />
                        </div>
                        <div class="flex items-baseline justify-between gap-3 flex-wrap flex-1 min-w-0">
                          <span class="text-base font-bold text-ds-brown">
                            {{ $t('project_detail.ship_prefix', { id: evt.ordinal }) }} {{ shipDecisionLabel(evt.ship.status) }}
                          </span>
                          <span class="text-xs text-ds-brown/60">{{ formatTimelineTime(evt.at) }}</span>
                        </div>
                      </div>

                      <div
                        v-if="(evt.ship.grantAmountCents != null && evt.ship.grantAmountCents > 0)
                          || (evt.ship.fruitRewarded > 0 && (evt.ship.status === 'shipped' || evt.ship.status === 'shipped_missing_airtable'))
                          || evt.ship.decision_user_message
                          || evt.ship.is_fraud_rejection"
                        class="px-4 py-3 flex flex-col gap-3"
                      >
                        <div
                          v-if="(evt.ship.grantAmountCents != null && evt.ship.grantAmountCents > 0)
                            || (evt.ship.fruitRewarded > 0 && (evt.ship.status === 'shipped' || evt.ship.status === 'shipped_missing_airtable'))"
                          class="flex flex-wrap items-center gap-x-4 gap-y-1"
                        >
                          <p
                            v-if="evt.ship.grantAmountCents != null && evt.ship.grantAmountCents > 0"
                            class="text-xs text-ds-brown/80 font-bold"
                          >
                            ${{ (evt.ship.grantAmountCents / 100).toFixed(2) }} grant
                            <span v-if="evt.ship.grantStatus === 'sent'" class="text-ds-success/70">· sent</span>
                            <span v-else-if="evt.ship.grantStatus === 'queued'" class="text-ds-brown/50">· queued</span>
                          </p>
                          <p
                            v-if="evt.ship.fruitRewarded > 0 && (evt.ship.status === 'shipped' || evt.ship.status === 'shipped_missing_airtable')"
                            class="text-xs text-ds-brown/70"
                          >
                            {{ formatGoldWithFruit(evt.ship.fruitRewarded) }}
                          </p>
                        </div>

                        <div
                          v-if="evt.ship.is_fraud_rejection"
                          class="border-[2px] border-ds-brown/30 bg-parchment p-3"
                        >
                          <p class="text-[11px] font-bold uppercase tracking-wider text-ds-brown/50 mb-1">
                            {{ $t('project_detail.fraud_squad_rejection_title') }}
                          </p>
                          <p class="text-sm text-ds-brown leading-relaxed">
                            {{ $t('project_detail.fraud_squad_rejection_intro') }}
                            <a
                              href="https://hackclub.enterprise.slack.com/archives/D0AGPCFRY8J"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="font-bold underline text-ds-brown hover:text-ds-danger"
                            >{{ $t('project_detail.fraud_squad_rejection_link_label') }}</a>
                            {{ $t('project_detail.fraud_squad_rejection_outro') }}
                          </p>
                        </div>
                        <div
                          v-else-if="evt.ship.decision_user_message"
                          class="border-[2px] border-ds-brown/30 bg-parchment p-3"
                        >
                          <p class="text-[11px] font-bold uppercase tracking-wider text-ds-brown/50 mb-1">
                            {{ $t('project_detail.reviewer_notes') }}
                          </p>
                          <p class="text-sm text-ds-brown whitespace-pre-wrap leading-relaxed">
                            {{ isShowingOriginal(evt.ship.id)
                              ? evt.ship.decision_user_message_original
                              : evt.ship.decision_user_message }}
                          </p>
                          <button
                            v-if="evt.ship.decision_user_message_is_translated"
                            type="button"
                            class="mt-2 text-[10px] text-ds-brown/50 underline hover:text-ds-brown"
                            @click="toggleShowOriginal(evt.ship.id)"
                          >
                            {{ isShowingOriginal(evt.ship.id)
                              ? $t('reviewer_feedback.show_translated')
                              : $t('reviewer_feedback.show_original') }}
                          </button>
                          <div
                            v-if="evt.ship.decision_user_message_attachments && evt.ship.decision_user_message_attachments.length > 0"
                            class="mt-3 flex flex-wrap gap-2"
                          >
                            <a
                              v-for="att in evt.ship.decision_user_message_attachments"
                              :key="att.url"
                              :href="att.url"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="block border-[2px] border-ds-brown/30 hover:border-ds-brown transition-colors"
                            >
                              <img :src="att.url" :alt="att.filename" class="h-24 w-24 object-cover">
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="flex items-center gap-3 py-2">
                      <div
                        class="shrink-0 w-8 h-8 flex items-center justify-center border-[2px]"
                        :class="evt.kind === 'created'
                          ? 'bg-ds-success/15 border-ds-success text-ds-success'
                          : 'bg-ds-brown/10 border-ds-brown text-ds-brown'"
                      >
                        <Sprout v-if="evt.kind === 'created'" class="w-4 h-4" />
                        <PlaneTakeoff v-else class="w-4 h-4" />
                      </div>
                      <div class="flex items-baseline justify-between gap-3 flex-wrap flex-1 min-w-0">
                        <span class="text-sm text-ds-brown">
                          <template v-if="evt.kind === 'created'">
                            {{ $t('project_detail.timeline_created', { name: project.name }) }}
                          </template>
                          <template v-else-if="evt.kind === 'ship_submit'">
                            {{ $t('project_detail.timeline_submitted', { id: evt.ordinal }) }}
                          </template>
                        </span>
                        <span class="text-xs text-ds-brown/60">{{ formatTimelineTime(evt.at) }}</span>
                      </div>
                    </div>
                  </template>

                  <div
                    v-if="idx < timelineEvents.length - 1"
                    class="ml-4 h-6 border-l-2 border-ds-brown/20"
                  />
                </div>
              </div>

              <div
                v-if="isMember && archivedJournals.length > 0"
                class="mt-6"
              >
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-2 px-3 py-2 border-[3px] border-ds-brown/25 bg-parchment/60 hover:bg-ds-brown/5 transition-colors text-left"
                  @click="showArchivedSection = !showArchivedSection"
                >
                  <span class="flex items-center gap-2 text-sm font-bold text-ds-brown">
                    <ChevronDown v-if="showArchivedSection" :size="16" />
                    <ChevronRight v-else :size="16" />
                    {{ $t('project_detail.archived_section_title') }}
                    <span class="bg-ds-brown/10 px-2 py-0.5 rounded-full text-xs text-ds-brown">
                      {{ archivedJournals.length }}
                    </span>
                  </span>
                </button>
                <div v-if="showArchivedSection" class="mt-3 flex flex-col gap-3">
                  <div
                    v-for="entry in archivedJournals"
                    :key="`archived-${entry.id}`"
                    class="ml-0 border-[3px] border-ds-brown/25 bg-parchment/40 p-4 opacity-80"
                  >
                    <div class="flex items-start gap-3 mb-3">
                      <div class="shrink-0 w-10 h-10 flex items-center justify-center bg-ds-brown/10 border-[2px] border-ds-brown text-ds-brown/60">
                        <NotebookPen class="w-5 h-5" />
                      </div>
                      <div class="flex-1 min-w-0 flex flex-col gap-1">
                        <div class="text-lg font-bold text-ds-brown/80 truncate">
                          {{ entry.short_brief || $t('project_detail.journal_entry') }}
                          <span class="text-xs font-normal text-ds-brown/40 ml-2">{{ $t('journal.archived_tag') }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                          <span class="text-xs text-ds-brown/60 whitespace-nowrap">
                            {{ formatTimelineTime(entry.created_at) }}
                          </span>
                          <div class="flex items-center gap-2 text-xs text-ds-brown/60 shrink-0">
                            <span v-if="entry.hours" class="bg-ds-brown/10 px-2 py-0.5 rounded-full font-semibold text-ds-brown">
                              {{ entry.hours }}h
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <JournalEntry
                      :entry="entry"
                      :hide-title="true"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="timelineTab === 'journal'" :key="'journal'">
              <TransitionGroup
                v-if="activeJournals.length > 0"
                tag="div"
                :css="false"
                appear
                class="flex flex-col gap-4"
                @enter="onJournalEnter"
                @leave="onJournalLeave"
              >
                <JournalEntry
                  v-for="entry in activeJournals"
                  :key="entry.id"
                  :entry="entry"
                />
              </TransitionGroup>
              <div v-else-if="archivedJournals.length === 0" class="text-center py-8 text-ds-brown/40 text-sm">
                {{ $t('project_detail.no_journal_entries') }}
              </div>

              <div
                v-if="isMember && archivedJournals.length > 0"
                class="mt-6"
              >
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-2 px-3 py-2 border-[3px] border-ds-brown/25 bg-parchment/60 hover:bg-ds-brown/5 transition-colors text-left"
                  @click="showArchivedSection = !showArchivedSection"
                >
                  <span class="flex items-center gap-2 text-sm font-bold text-ds-brown">
                    <ChevronDown v-if="showArchivedSection" :size="16" />
                    <ChevronRight v-else :size="16" />
                    {{ $t('project_detail.archived_section_title') }}
                    <span class="bg-ds-brown/10 px-2 py-0.5 rounded-full text-xs text-ds-brown">
                      {{ archivedJournals.length }}
                    </span>
                  </span>
                </button>
                <TransitionGroup
                  v-if="showArchivedSection"
                  tag="div"
                  :css="false"
                  appear
                  class="mt-3 flex flex-col gap-4"
                  @enter="onJournalEnter"
                  @leave="onJournalLeave"
                >
                  <div
                    v-for="entry in archivedJournals"
                    :key="`archived-journal-tab-${entry.id}`"
                    class="opacity-80"
                  >
                    <JournalEntry :entry="entry" />
                  </div>
                </TransitionGroup>
              </div>
            </div>
            </Transition>
          </div>
        </component>

        <div v-if="isMember" class="border-t-2 border-ds-brown/15 pt-5">
          <button
            type="button"
            class="flex items-center justify-between w-full text-left text-lg font-bold text-ds-brown hover:opacity-80"
            :aria-expanded="projectStreakCalendarOpen"
            @click="projectStreakCalendarOpen = !projectStreakCalendarOpen"
          >
            <span>Project streak history</span>
            <ChevronDown
              :size="18"
              :class="['transition-transform duration-200', projectStreakCalendarOpen && 'rotate-180']"
            />
          </button>
          <div v-if="projectStreakCalendarOpen" class="mt-4">
            <StreakCalendar :project-id="projectId" />
          </div>
        </div>

        <MoreByMaker
          v-if="project?.owner?.username"
          :user-id="project.owner.id"
          :exclude-project-id="projectId"
          :windowed="isWindowed"
        />

        <div v-if="canReportProject" class="flex justify-center pt-2">
          <button
            type="button"
            class="text-xs text-ds-brown/50 hover:text-ds-danger transition-colors flex items-center gap-1.5"
            @click="openReportModal"
          >
            <Flag :size="13" />
            {{ $t('project_detail.report_project') }}
          </button>
        </div>
      </div>
    </template>

    <!-- No WoodFrame: this route renders frameless when opened standalone. -->
    <Teleport to="body">
      <div
        v-if="showReportModal"
        class="fixed inset-0 z-[600] bg-black/50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-project-title"
        @click.self="showReportModal = false"
      >
        <div class="w-full max-w-lg border-[3px] border-ds-brown bg-parchment p-5 shadow-xl">
          <div class="flex items-start justify-between gap-4">
            <h2 id="report-project-title" class="text-xl font-extrabold text-ds-brown">
              {{ $t('project_detail.report_title') }}
            </h2>
            <button
              type="button"
              class="text-ds-brown/60 hover:text-ds-brown text-xl leading-none"
              :aria-label="$t('project_detail.cancel')"
              @click="showReportModal = false"
            >×</button>
          </div>
          <p class="mt-1 text-xs text-ds-brown/60">{{ $t('project_detail.report_intro') }}</p>

          <textarea
            v-model="reportReason"
            rows="5"
            maxlength="2000"
            :placeholder="$t('project_detail.report_placeholder')"
            class="ds-input resize-none w-full mt-4 text-sm"
          />

          <div class="flex items-center justify-between gap-3 mt-4">
            <span class="text-[10px] text-ds-brown/40 tabular-nums">{{ reportReason.trim().length }}/2000</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="ds-btn-ghost text-xs"
                :disabled="reportSubmitting"
                @click="showReportModal = false"
              >{{ $t('project_detail.cancel') }}</button>
              <button
                type="button"
                class="ds-btn-danger text-xs disabled:opacity-50"
                :disabled="reportSubmitting || reportReason.trim().length < 10"
                @click="submitReport"
              >
                {{ reportSubmitting ? $t('project_detail.report_sending') : $t('project_detail.report_submit') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.prose-desc :deep(h1),
.prose-desc :deep(h2),
.prose-desc :deep(h3) {
  @apply font-bold text-ds-brown mt-2 mb-1;
}
.prose-desc :deep(h1) { @apply text-lg; }
.prose-desc :deep(h2) { @apply text-base; }
.prose-desc :deep(h3) { @apply text-sm; }
.prose-desc :deep(p) { @apply mb-1; }
.prose-desc :deep(ul),
.prose-desc :deep(ol) { @apply pl-5 mb-1; }
.prose-desc :deep(ul) { @apply list-disc; }
.prose-desc :deep(ol) { @apply list-decimal; }
.prose-desc :deep(code) { @apply bg-ds-brown/10 px-1 py-0.5 text-xs rounded break-all; }
.prose-desc :deep(pre) { @apply bg-ds-brown/10 p-2 rounded my-1 overflow-x-auto text-xs; }
.prose-desc :deep(a) { @apply text-blue-700 underline break-all; }
.prose-desc :deep(blockquote) { @apply border-l-2 border-ds-brown/30 pl-3 italic text-ds-brown/60; }
.prose-desc :deep(strong) { @apply font-bold; }
.prose-desc :deep(em) { @apply italic; }
.prose-desc :deep(del) { @apply line-through; }

/* CSS, not GSAP: a JS transition with mode="out-in" could deadlock and blank the tab. */
.tab-fade-enter-active {
  transition: opacity 0.2s ease-out;
}
.tab-fade-leave-active {
  transition: opacity 0.15s ease-in;
}
.tab-fade-enter-from,
.tab-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tab-fade-enter-active,
  .tab-fade-leave-active {
    transition: none;
  }
}

</style>
