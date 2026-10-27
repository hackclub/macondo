<script setup lang="ts">
import { fruits as fruitData, type Fruit } from "~/data/fruitLevels";
import { Clock, ExternalLink, Eye, Link2, Users, X } from "lucide-vue-next";

let gsapPromise: Promise<typeof import("gsap").default> | null = null;
function loadGsap(): Promise<typeof import("gsap").default> {
  if (!gsapPromise) gsapPromise = import("gsap").then((m) => m.default);
  return gsapPromise;
}

const props = defineProps<{
  highlightElement?: string | null;
  showStore?: boolean;
  showEncounters?: boolean;
  bareMode?: boolean;
  showDocsHint?: boolean;
  // user_id is the owner; when it differs from currentUserId the tile shows a "shared with me" badge
  projects?: { id: number | string; name?: string; fruit?: string; level?: string; stage?: number; user_id?: string | null }[];
  currentUserId?: string | null;
}>();

const emit = defineEmits<{
  'open-project': [project: { id: number | string; name?: string; fruit?: string; level?: string; stage?: number; user_id?: string | null }];
  'open-profile': [];
  'open-shop': [];
  'open-explore': [];
}>();

function isSharedProject(project: { user_id?: string | null } | null | undefined): boolean {
  if (!project || !project.user_id) return false;
  if (!props.currentUserId) return false;
  return project.user_id !== props.currentUserId;
}

const { t, locale } = useI18n();

const localizedDashboardDir = computed(() =>
  locale.value === "es" ? "es" : "en",
);
const houseImageSrc = computed(
  () => `/images/dashboard/${localizedDashboardDir.value}/house.webp`,
);
const donkeyImageSrc = computed(
  () => `/images/dashboard/${localizedDashboardDir.value}/donkey.webp`,
);
const exploreImageSrc = computed(
  () => `/images/dashboard/${localizedDashboardDir.value}/explore.webp`,
);

const { blend: nightBlend } = useNightMode();

const houseNightSrc = computed(
  () => `/images/dashboard/${localizedDashboardDir.value}/house_night.webp?v=3`,
);
const donkeyNightSrc = computed(
  () => `/images/dashboard/${localizedDashboardDir.value}/donkey_night.webp`,
);
const exploreNightSrc = computed(
  () => `/images/dashboard/${localizedDashboardDir.value}/explore_night.webp`,
);

// fallback disc radii, used until the first frame publishes the live --b{i}r
const discR = ["72px", "88px", "80px", "96px", "84px"] as const;

// binds disc i to butterfly i's published position and radius
function discBind(i: number): Record<string, string> {
  return {
    "--bx": `var(--b${i - 1}x, -9999px)`,
    "--by": `var(--b${i - 1}y, -9999px)`,
    "--disc-r": `var(--b${i - 1}r, ${discR[i - 1]})`,
  };
}

const palmSlots = [
  { cls: "palma-1", flip: true, night: "/images/dashboard/palma_night.webp?v=3" },
  { cls: "palma-2", flip: false, night: "/images/dashboard/palma_night.webp?v=3" },
  { cls: "palma-3", flip: false, night: "/images/dashboard/palma_night.webp?v=3" },
  { cls: "palma-4", flip: true, night: "/images/dashboard/palma_night.webp?v=3" },
  { cls: "palma-5", flip: false, night: "/images/dashboard/palma_night.webp?v=3" },
  { cls: "palma-6", flip: true, night: "/images/dashboard/palma_night.webp?v=3" },
  { cls: "palma-7", flip: true, night: "/images/dashboard/palma_night.webp?v=3" },
] as const;

// per stage: [size px, bottom offset px, % clipped from the bottom to hide roots]
const fruitDisplayConfig: Record<string, [number, number, number][]> = {
  Mango:      [[70, 5, 0], [110, 0, 20], [120, 0, 20], [130, -10, 0]],
  Guava:      [[55, 2, 0], [85, -8, 0], [100, -15, 0], [115, -20, 0]],
  Cocoa:      [[50, 10, 0], [80, 5, 0], [100, 0, 0], [120, -8, 0]],
  Avocado:    [[60, 5, 0], [90, 0, 0], [110, -5, 0], [130, -10, 0]],
  Coconut:    [[45, 10, 0], [60, 8, 0], [75, 5, 0], [95, 5, 0]],
  Papaya:     [[60, 5, 0], [85, 0, 0], [100, -3, 0], [115, -5, 0]],
  Pineapple:  [[55, 10, 0], [70, 8, 0], [85, 5, 0], [100, 5, 0]],
  Watermelon: [[55, 10, 0], [70, 8, 0], [85, 5, 0], [100, 5, 0]],
};

function getFruit(fruitName?: string): Fruit | null {
  if (!fruitName) return null;
  return fruitData.find(f => f.name === fruitName) ?? null;
}

function getFruitStageImage(fruitName?: string, stage?: number): string | null {
  const fruit = getFruit(fruitName);
  if (!fruit || fruit.stages.length === 0) return null;
  return fruit.stages[Math.min(Math.max((stage || 1) - 1, 0), fruit.stages.length - 1)] ?? null;
}

function getFruitDisplay(fruitName?: string, stage?: number): { size: number; bottom: number; clipBottom: number } {
  const s = Math.min(Math.max((stage || 1), 1), 4);
  const config = fruitName ? fruitDisplayConfig[fruitName] : null;
  if (config) {
    const [size, bottom, clipBottom] = config[s - 1]!;
    return { size, bottom, clipBottom };
  }
  return { size: [65, 85, 105, 130][s - 1] ?? 85, bottom: 10, clipBottom: 0 };
}

const filledPlots = computed(() => props.projects?.length ?? 0);

const colStep = { left: 83, top: -31 };
const rowStep = { left: -32, top: -62 };

const tileCount = computed(() => Math.max(1, filledPlots.value + 1));

const gridDimensions = computed(() => {
  const total = tileCount.value;
  let cols = 1, rows = 1;
  while (cols * rows < total) {
    if (cols <= rows) cols++;
    else rows++;
  }
  return { cols, rows };
});

// Seeded random so jitter is stable across re-renders
function seededRandom(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

const gridTiles = computed(() => {
  const { cols, rows } = gridDimensions.value;
  // mobile: farm-area sits at top:56px scaled 0.55; anchor the cluster a fixed gap
  // above the house (top:42%) on any phone height, sliding down if it would hit the navbar
  let origin: { left: number; top: number };
  if (isMobile.value) {
    let originTop = (0.42 * viewportHeight.value - 30 - 56) / 0.55 - 90; // 30px gap above the house, 90px tile height
    const navbarBuffer = 20;
    const clusterRise = (cols - 1) * Math.abs(colStep.top) + (rows - 1) * Math.abs(rowStep.top);
    if (originTop - clusterRise < navbarBuffer) {
      originTop = navbarBuffer + clusterRise;
    }
    origin = { left: 150, top: originTop };
  } else {
    origin = { left: 150, top: 350 };
  }
  const tiles = [];
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (count >= tileCount.value) break;
      const seed = row * cols + col;
      const centerCol = (cols - 1) / 2;
      const centerRow = (rows - 1) / 2;
      const dirLeft = col < centerCol ? 1 : col > centerCol ? -1 : 0;
      const dirTop = row < centerRow ? 1 : row > centerRow ? -1 : 0;
      const jitterLeft = Math.round(seededRandom(seed) * 2) * (dirLeft || (seededRandom(seed + 50) > 0.5 ? 1 : -1));
      const jitterTop = Math.round(seededRandom(seed + 100) * 2) * (dirTop || (seededRandom(seed + 150) > 0.5 ? 1 : -1));
      tiles.push({
        left: origin.left + col * colStep.left + row * rowStep.left + jitterLeft,
        top: origin.top + col * colStep.top + row * rowStep.top + jitterTop,
      });
      count++;
    }
  }
  return tiles;
});

const tileOrder = ref<number[]>([]);

// the immediate watch run happens before onMounted positions tiles, so it skips the collision pass
const initialProjectsHandled = ref(false);

watch(() => props.projects, () => {
  const totalTiles = tileCount.value;
  const newOrder: number[] = new Array(totalTiles).fill(-1);
  const projects = props.projects || [];
  // keep existing assignments even when totalTiles grew, so a new project can't land on a dragged tile
  const assigned = new Set<number>();
  for (let i = 0; i < tileOrder.value.length && i < totalTiles; i++) {
    const pi = tileOrder.value[i] ?? -1;
    if (pi >= 0 && pi < projects.length && !assigned.has(pi)) {
      newOrder[i] = pi;
      assigned.add(pi);
    }
  }
  let nextEmpty = 0;
  for (let pi = 0; pi < projects.length; pi++) {
    if (assigned.has(pi)) continue;
    while (nextEmpty < totalTiles && newOrder[nextEmpty] !== -1) nextEmpty++;
    if (nextEmpty < totalTiles) {
      newOrder[nextEmpty] = pi;
    }
  }
  tileOrder.value = newOrder;

  // re-check collisions once the new tile renders; setTimeout, not rAF, since rAF stalls in background tabs.
  // the first immediate run is skipped because validateTilePositions isn't declared yet
  if (initialProjectsHandled.value && import.meta.client) {
    nextTick(() => setTimeout(() => validateTilePositions(), 0));
  }
  initialProjectsHandled.value = true;
}, { immediate: true, deep: true });

function getProjectForTile(tileIndex: number) {
  const pi = tileOrder.value[tileIndex] ?? -1;
  if (pi < 0) return null;
  return (props.projects || [])[pi] || null;
}

const hoveredProject = ref<{ id: number | string; name?: string; fruit?: string; stage?: number } | null>(null);

function handleTileEnter(tileIndex: number) {
  const p = getProjectForTile(tileIndex);
  if (p) hoveredProject.value = p;
}

function handleTileLeave() {
  hoveredProject.value = null;
}

const didDrag = ref(false);

function handleTileClick(tileIndex: number, event?: MouseEvent) {
  if (didDrag.value) {
    didDrag.value = false;
    return;
  }
  const p = getProjectForTile(tileIndex);
  if (p) {
    // tiles aren't real anchors, so replicate ctrl/cmd+click opening a new tab
    if (event && (event.ctrlKey || event.metaKey)) {
      openProjectInNewTab(p);
      return;
    }
    emit('open-project', p);
  }
}

// middle-click opens a new tab, unless it's the release of a drag
function handleTileAux(tileIndex: number, event: MouseEvent) {
  if (event.button !== 1) return;
  if (didDrag.value) {
    didDrag.value = false;
    return;
  }
  const p = getProjectForTile(tileIndex);
  if (p) {
    event.preventDefault();
    openProjectInNewTab(p);
  }
}

function openProjectInNewTab(project: { id: number | string }) {
  if (!import.meta.client) return;
  window.open(`/projects/${project.id}`, '_blank', 'noopener');
}

// personal per-project color tags, stored only in localStorage
const TAGS_KEY = 'macondo_project_tags';
const projectTags = ref<Record<number, string>>({});
const TAG_COLORS: Array<{ key: string; hex: string }> = [
  { key: 'red', hex: '#892808' },
  { key: 'amber', hex: '#FFB774' },
  { key: 'green', hex: '#91A160' },
  { key: 'blue', hex: '#5b7fa6' },
  { key: 'purple', hex: '#7a5ba6' },
  { key: 'pink', hex: '#b86b8a' },
];

function loadProjectTags() {
  try {
    const raw = window.localStorage.getItem(TAGS_KEY);
    if (!raw) return;
    const next: Record<number, string> = {};
    for (const [id, key] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
      if (typeof key === 'string') next[Number(id)] = key;
    }
    projectTags.value = next;
  } catch {
    // Ignore corrupt or blocked storage.
  }
}
function persistProjectTags() {
  try {
    window.localStorage.setItem(TAGS_KEY, JSON.stringify(projectTags.value));
  } catch {
    // Ignore storage write failures.
  }
}
function tagHex(projectId: number | string | undefined | null): string | null {
  if (projectId == null) return null;
  const key = projectTags.value[Number(projectId)];
  return TAG_COLORS.find((c) => c.key === key)?.hex ?? null;
}
function setProjectTag(projectId: number, key: string | null) {
  if (key) {
    projectTags.value = { ...projectTags.value, [projectId]: key };
  } else {
    const { [projectId]: _removed, ...rest } = projectTags.value;
    projectTags.value = rest;
  }
  persistProjectTags();
}

const contextMenu = ref<{ x: number; y: number; project: { id: number | string; name?: string } } | null>(null);
const ctxCopied = ref(false);

function openContextMenu(tileIndex: number, event: MouseEvent) {
  const p = getProjectForTile(tileIndex);
  if (!p) {
    contextMenu.value = null;
    return;
  }
  ctxCopied.value = false;
  contextMenu.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)),
    project: p,
  };
}
function closeContextMenu() {
  contextMenu.value = null;
}
function ctxOpen() {
  if (!contextMenu.value) return;
  emit('open-project', contextMenu.value.project);
  closeContextMenu();
}
function ctxOpenNewTab() {
  if (!contextMenu.value) return;
  openProjectInNewTab(contextMenu.value.project);
  closeContextMenu();
}
async function ctxCopyLink() {
  if (!contextMenu.value || !import.meta.client) return;
  const url = `${window.location.origin}/projects/${contextMenu.value.project.id}`;
  try {
    await navigator.clipboard.writeText(url);
    ctxCopied.value = true;
    window.setTimeout(closeContextMenu, 700); // let the copied state show before closing
  } catch {
    closeContextMenu();
  }
}
function ctxHackatime() {
  if (import.meta.client) window.open('https://hackatime.hackclub.com', '_blank', 'noopener');
  closeContextMenu();
}
function ctxSetTag(key: string | null) {
  if (!contextMenu.value) return;
  setProjectTag(Number(contextMenu.value.project.id), key);
  closeContextMenu();
}

onMounted(loadProjectTags);

const dragFrom = ref<number | null>(null);
const dragging = ref(false);

const STORAGE_KEY = 'macondo-tile-positions';
const isMobile = ref(false);
// 700 is a mid-mobile height for ssr / pre-mount
const viewportHeight = ref(700);
// no projects means onboarding, where positions aren't persisted
const hasProjects = computed(() => (props.projects?.length ?? 0) > 0);

const tilePositions = reactive<Record<number, { left: number; top: number }>>({});
// hidden until saved positions load, to avoid a hydration flash
const tilesReady = ref(false);

function updateViewport() {
  isMobile.value = window.innerWidth < 768;
  viewportHeight.value = window.innerHeight;
}
if (import.meta.client) {
  updateViewport();
}
onMounted(() => {
  window.addEventListener('resize', updateViewport);
  window.addEventListener('orientationchange', updateViewport);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport);
  window.removeEventListener('orientationchange', updateViewport);
});

function reducedMotion(): boolean {
  return import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function startHoverPulse(event: MouseEvent) {
  const area = event.currentTarget as HTMLElement | null;
  // buildings stack a day and a night image, so glow both
  const imgs = area ? Array.from(area.querySelectorAll<HTMLElement>('img')) : [];
  if (!imgs.length) return;
  if (reducedMotion()) {
    imgs.forEach((img) => img.style.setProperty('--glow', '1'));
    return;
  }
  void loadGsap().then((gsap) => {
    gsap.killTweensOf(imgs);
    gsap.to(imgs, { '--glow': 1, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
  });
}

function endHoverPulse(event: MouseEvent) {
  const area = event.currentTarget as HTMLElement | null;
  const imgs = area ? Array.from(area.querySelectorAll<HTMLElement>('img')) : [];
  if (!imgs.length) return;
  void loadGsap().then((gsap) => {
    gsap.killTweensOf(imgs);
    gsap.to(imgs, { '--glow': 0, duration: 0.3, ease: 'power2.in', overwrite: 'auto' });
  });
}

watch(hasProjects, (has) => {
  if (!has && import.meta.client) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    for (const key of Object.keys(tilePositions)) {
      tilePositions[Number(key)] = undefined as unknown as (typeof tilePositions)[number];
    }
    for (const key of Object.keys(tilePositions)) {
      if (tilePositions[Number(key)] === undefined) {
        Reflect.deleteProperty(tilePositions, Number(key));
      }
    }
  }
});

function saveTilePositions() {
  if (import.meta.client && hasProjects.value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tilePositions));
    } catch { /* ignore */ }
  }
}

function getTilePosition(tileIndex: number) {
  // saved positions are in desktop farm coords and land under the house on mobile, so mobile uses the grid
  if (!isMobile.value && tilePositions[tileIndex]) return tilePositions[tileIndex];
  return gridTiles.value[tileIndex] || { left: 0, top: 0 };
}

const farmAreaRef = ref<HTMLElement | null>(null);
const houseRef = ref<HTMLElement | null>(null);
const donkeyRef = ref<HTMLElement | null>(null);

// tiles are diamonds inscribed in tileW x tileH; the L1 norm is separable, so
// clamping the center into the AABB per axis gives the true minimum distance
function overlapsElement(left: number, top: number, tileW: number, tileH: number, elRef: HTMLElement | null, farmRect: DOMRect): boolean {
  if (!elRef) return false;
  const r = elRef.getBoundingClientRect();
  const elLeft = r.left - farmRect.left;
  const elTop = r.top - farmRect.top;
  const cx = left + tileW / 2;
  const cy = top + tileH / 2;
  return Math.abs(cx - Math.max(elLeft, Math.min(cx, elLeft + r.width))) / (tileW / 2)
    + Math.abs(cy - Math.max(elTop, Math.min(cy, elTop + r.height))) / (tileH / 2) < 1;
}

// biased toward the top-right, the open farm area: a tile pushed elsewhere ended up
// under the donkey or other UI, which ate every click and drag
function pushOutside(left: number, top: number, tileW: number, tileH: number, elRef: HTMLElement | null, farmRect: DOMRect): { left: number; top: number } {
  if (!elRef) return { left, top };
  const r = elRef.getBoundingClientRect();
  const elLeft = r.left - farmRect.left;
  const elTop = r.top - farmRect.top;
  const elRight = elLeft + r.width;
  const elBottom = elTop + r.height;

  if (left >= elRight || left + tileW <= elLeft || top >= elBottom || top + tileH <= elTop) {
    return { left, top };
  }

  const maxLeft = Math.max(0, farmRect.width - tileW);

  const tryRight = { left: left + (elRight - left), top };
  const tryUp = { left, top: top - (top + tileH - elTop) };
  const tryDown = { left, top: top + (elBottom - top) };
  const tryLeft = { left: left - (left + tileW - elLeft), top };

  const inBounds = (m: { left: number; top: number }) =>
    m.left >= 0 && m.top >= 0 && m.left <= maxLeft && m.top <= farmRect.height - tileH;

  if (inBounds(tryRight)) return tryRight;
  if (inBounds(tryUp)) return tryUp;
  if (inBounds(tryDown)) return tryDown;
  if (inBounds(tryLeft)) return tryLeft;

  // every push leaves the farm: take the one nearest the top-right and let findFreeSpot finish
  const target = { left: maxLeft, top: 0 };
  const dist = (m: { left: number; top: number }) =>
    Math.abs(m.left - target.left) + Math.abs(m.top - target.top);
  return [tryRight, tryUp, tryDown, tryLeft].sort((a, b) => dist(a) - dist(b))[0]!;
}

// diamond hitboxes (not AABBs) so neighbours can touch along their diagonal edges;
// the Minkowski sum is a diamond, so overlap is an L1-stretched center distance < 1
function diamondsOverlap(
  aLeft: number, aTop: number, aW: number, aH: number,
  bLeft: number, bTop: number, bW: number, bH: number,
): boolean {
  return Math.abs(aLeft + aW / 2 - (bLeft + bW / 2)) / ((aW + bW) / 2)
    + Math.abs(aTop + aH / 2 - (bTop + bH / 2)) / ((aH + bH) / 2) < 1;
}

function findFreeSpot(
  preferredLeft: number,
  preferredTop: number,
  tileW: number,
  tileH: number,
  farmRect: DOMRect,
  occupied: Array<{ left: number; top: number; width: number; height: number }>,
  blockers: Array<HTMLElement | null>,
): { left: number; top: number } {
  const maxLeft = Math.max(0, farmRect.width - tileW);
  const maxTop = Math.max(0, farmRect.height - tileH);
  const clamp = (l: number, t: number) => ({
    left: Math.max(0, Math.min(maxLeft, l)),
    top: Math.max(0, Math.min(maxTop, t)),
  });
  const hits = (l: number, t: number): boolean => {
    for (const box of occupied) {
      if (diamondsOverlap(l, t, tileW, tileH, box.left, box.top, box.width, box.height)) return true;
    }
    for (const blocker of blockers) {
      if (overlapsElement(l, t, tileW, tileH, blocker, farmRect)) return true;
    }
    return false;
  };

  const start = clamp(preferredLeft, preferredTop);
  if (!hits(start.left, start.top)) return start;

  // spiral out in sub-tile steps so narrow gaps aren't skipped; top-first, right-first
  // matches pushOutside's top-right bias
  const step = Math.max(24, Math.floor(Math.min(tileW, tileH) * 0.4));
  const maxRadius = Math.ceil(Math.max(farmRect.width, farmRect.height) / step);
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = radius; dx >= -radius; dx--) {
        // perimeter only; smaller radii already covered the interior
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = clamp(
          preferredLeft + dx * step,
          preferredTop + dy * step,
        );
        if (!hits(candidate.left, candidate.top)) return candidate;
      }
    }
  }
  return start;
}

// also covers default grid spots, which can sit under the shop on short viewports
function validateTilePositions() {
  // runs even with no projects so the "make a project" tile can't spawn under the donkey
  if (!farmAreaRef.value || isMobile.value) return;
  const farmRect = farmAreaRef.value.getBoundingClientRect();
  const tileW = 120;
  const tileH = 90;
  // before layout, clamping would persist every tile at 0,0 and stack them all on next mount
  if (farmRect.width < tileW * 2 || farmRect.height < tileH * 2) return;
  let changed = false;

  const resolved: Array<{ index: number; left: number; top: number; wasCustom: boolean }> = [];
  for (let i = 0; i < tileCount.value; i++) {
    const current = getTilePosition(i);
    let pos = { left: current.left, top: current.top };
    const wasCustom = !!tilePositions[i];

    if (wasCustom && (pos.left < 0 || pos.top < 0
      || pos.left > farmRect.width - tileW || pos.top > farmRect.height - tileH
      || isNaN(pos.left) || isNaN(pos.top))) {
      pos = { ...(gridTiles.value[i] || { left: 0, top: 0 }) };
    }

    pos.left = Math.max(0, Math.min(pos.left, farmRect.width - tileW));
    pos.top = Math.max(0, Math.min(pos.top, farmRect.height - tileH));

    pos = pushOutside(pos.left, pos.top, tileW, tileH, houseRef.value, farmRect);
    pos = pushOutside(pos.left, pos.top, tileW, tileH, donkeyRef.value, farmRect);

    resolved.push({ index: i, left: pos.left, top: pos.top, wasCustom });
  }

  // place user-positioned tiles first so a new spawn is what moves
  resolved.sort((a, b) => Number(b.wasCustom) - Number(a.wasCustom) || a.index - b.index);

  const occupied: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (const tile of resolved) {
    const preferred = { left: tile.left, top: tile.top };
    const free = findFreeSpot(
      preferred.left,
      preferred.top,
      tileW,
      tileH,
      farmRect,
      occupied,
      [houseRef.value, donkeyRef.value],
    );
    occupied.push({ left: free.left, top: free.top, width: tileW, height: tileH });

    const current = getTilePosition(tile.index);
    if (free.left !== current.left || free.top !== current.top) {
      tilePositions[tile.index] = { left: free.left, top: free.top };
      changed = true;
    }
  }

  if (changed) saveTilePositions();
}

onMounted(() => {
  if (import.meta.client && hasProjects.value) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) Object.assign(tilePositions, JSON.parse(saved));
    } catch { /* ignore */ }

    // two tiles on identical coords means an old clamp-to-zero poisoned storage; drop it all
    const loaded = Object.values(tilePositions).filter((p): p is { left: number; top: number } => !!p);
    if (loaded.length >= 2) {
      const seen = new Set<string>();
      let duplicate = false;
      for (const p of loaded) {
        const key = `${p.left},${p.top}`;
        if (seen.has(key)) { duplicate = true; break; }
        seen.add(key);
      }
      if (duplicate) {
        for (const k of Object.keys(tilePositions)) Reflect.deleteProperty(tilePositions, Number(k));
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      }
    }
  }
  tilesReady.value = true;

  if (import.meta.client && hasProjects.value) {
    nextTick(() => setTimeout(() => validateTilePositions(), 0));

    // the shop and house shift as the viewport shrinks vertically
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(validateTilePositions, 150); // debounce resize events
    };
    window.addEventListener('resize', onResize);
    onBeforeUnmount(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    });
  }
});

function onDragStart(tileIndex: number, e: PointerEvent) {
  if (!hasProjects.value) return;

  const isTouch = e.pointerType === 'touch';

  const farmEl = farmAreaRef.value;
  if (!farmEl) return;

  const tileEl = e.currentTarget as HTMLElement;
  const tileRect = tileEl.getBoundingClientRect();

  // collisions use viewport (post-scale) pixels; only stored positions are unscaled,
  // so they survive the mobile scale transform
  const offsetX = e.clientX - tileRect.left;
  const offsetY = e.clientY - tileRect.top;
  const tileW = tileRect.width;
  const tileH = tileRect.height;

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const DRAG_THRESHOLD_PX = 5;
  const HOLD_CANCEL_PX = 10;
  const HOLD_DURATION_MS = 500;
  let dragStarted = false;
  let pressArmed = false;
  let movedSinceArm = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let lastValid = tilePositions[tileIndex] ? { ...tilePositions[tileIndex] } : getTilePosition(tileIndex);

  const cleanup = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    tileEl.classList.remove('farm-tile-press-pending');
    tileEl.classList.remove('farm-tile-press-armed');
    tileEl.removeEventListener('pointermove', onMove);
    tileEl.removeEventListener('pointerup', onUp);
    tileEl.removeEventListener('pointercancel', onCancel);
    try { tileEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const armDrag = () => {
    if (pressArmed) return;
    pressArmed = true;
    dragFrom.value = tileIndex;
    dragging.value = true;
    tileEl.classList.remove('farm-tile-press-pending');
    tileEl.classList.add('farm-tile-press-armed');
    if (isTouch) {
      // swallow the synthetic click after a touch so press-and-hold doesn't open the project
      didDrag.value = true;
      try { navigator.vibrate?.(20); } catch { /* ignore */ }
    }
    try { tileEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    const distSq = dx * dx + dy * dy;

    // sliding before the long-press fires means scroll intent, so let the page scroll
    if (isTouch && !pressArmed) {
      if (distSq > HOLD_CANCEL_PX * HOLD_CANCEL_PX) cleanup();
      return;
    }

    // 5px matches html5 dnd, so hand tremor doesn't swallow a click
    if (!isTouch && !dragStarted) {
      if (distSq < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      dragStarted = true;
      didDrag.value = true;
    }

    if (!pressArmed || dragFrom.value === null) return;

    if (isTouch) ev.preventDefault();

    const fr = farmEl.getBoundingClientRect();
    const scaleX = fr.width / farmEl.offsetWidth || 1;
    const scaleY = fr.height / farmEl.offsetHeight || 1;

    let newLeft = ev.clientX - fr.left - offsetX;
    let newTop = ev.clientY - fr.top - offsetY;

    newLeft = Math.max(0, Math.min(newLeft, fr.width - tileW));
    newTop = Math.max(0, Math.min(newTop, fr.height - tileH));

    const hitsHouse = overlapsElement(newLeft, newTop, tileW, tileH, houseRef.value, fr);
    const hitsDonkey = overlapsElement(newLeft, newTop, tileW, tileH, donkeyRef.value, fr);

    // other tiles are stored unscaled, so scale them into viewport space first
    let hitsTile = false;
    for (let i = 0; i < tileCount.value; i++) {
      if (i === dragFrom.value) continue;
      const other = getTilePosition(i);
      if (diamondsOverlap(newLeft, newTop, tileW, tileH, other.left * scaleX, other.top * scaleY, tileW, tileH)) {
        hitsTile = true;
        break;
      }
    }

    if (!hitsHouse && !hitsDonkey && !hitsTile) {
      lastValid = { left: newLeft / scaleX, top: newTop / scaleY };
      tilePositions[dragFrom.value] = lastValid;
      movedSinceArm = true;
    }
  };

  const onUp = () => {
    const shouldSave = pressArmed && movedSinceArm;
    cleanup();
    dragging.value = false;
    dragFrom.value = null;
    if (shouldSave) saveTilePositions();
  };

  const onCancel = () => {
    cleanup();
    dragging.value = false;
    dragFrom.value = null;
  };

  tileEl.addEventListener('pointermove', onMove);
  tileEl.addEventListener('pointerup', onUp);
  tileEl.addEventListener('pointercancel', onCancel);

  if (isTouch) {
    // no preventDefault, so a quick swipe can still bail out and scroll
    tileEl.classList.add('farm-tile-press-pending');
    holdTimer = setTimeout(() => {
      holdTimer = null;
      armDrag();
    }, HOLD_DURATION_MS);
  } else {
    e.preventDefault();
    armDrag();
  }
}
</script>

<template>
  <div class="game-world" :style="{ '--night': nightBlend }">
    <div class="night-bg" aria-hidden="true" />
    <!-- each disc follows a butterfly and shows a counter-translated day scene through a static mask;
         transform-only, so there is no per-frame masking or re-rasterization -->
    <div v-if="!bareMode" class="day-discs" aria-hidden="true">
      <div v-for="i in 5" :key="`bg${i}`" class="day-disc" :style="discBind(i)">
        <div class="day-disc-bg" />
      </div>
    </div>
    <!-- reveals the day buildings above the night scene; the low discs only reach the background -->
    <div v-if="!bareMode" class="day-discs-fg" aria-hidden="true">
      <div v-for="i in 5" :key="`fg${i}`" class="day-disc" :style="discBind(i)">
        <div class="day-disc-fg">
          <div class="house-area">
            <div class="building-stack house-stack">
              <img :src="houseImageSrc" class="house-img" alt="" draggable="false">
            </div>
          </div>
          <div class="donkey-area">
            <div class="building-stack">
              <img :src="donkeyImageSrc" class="donkey-img" alt="" draggable="false">
            </div>
          </div>
          <div class="explore-area">
            <div class="building-stack">
              <img :src="exploreImageSrc" class="explore-img" alt="" draggable="false">
            </div>
          </div>
          <div
            v-for="p in palmSlots"
            :key="p.cls"
            class="palma"
            :class="[p.cls, { 'palma-flip': p.flip }]"
          >
            <img src="/images/dashboard/palma.webp?v=3" class="palma-img palma-day" alt="" draggable="false">
          </div>
          <!-- day copy of the tiles, so daylight reveals them clipped like the trees, not as a whole-tile brightening -->
          <div class="farm-area">
            <div
              v-for="(tile, ti) in (tilesReady ? gridTiles : [])"
              :key="ti"
              class="farm-tile-iso"
              :style="{ left: getTilePosition(ti).left + 'px', top: getTilePosition(ti).top + 'px' }"
            >
              <img src="/images/tierra/ground_tile.webp" class="tile-img" alt="">
              <template v-if="getProjectForTile(ti)">
                <img
                  v-if="getFruitStageImage(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage)"
                  :src="getFruitStageImage(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage)!"
                  class="plot-fruit-icon-iso"
                  :style="{
                    width: getFruitDisplay(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage).size + 'px',
                    height: getFruitDisplay(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage).size + 'px',
                    bottom: (getFruitDisplay(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage).bottom + 15) + 'px',
                    clipPath: getFruitDisplay(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage).clipBottom > 0
                      ? `inset(0 0 ${getFruitDisplay(getProjectForTile(ti)?.fruit, getProjectForTile(ti)?.stage).clipBottom}% 0)`
                      : undefined,
                  }"
                  alt=""
                >
                <div v-else class="plot-seedling-iso" />
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- the isometric farm doesn't narrate linearly, so screen readers get the same actions as a list -->
    <ul class="sr-only" :aria-label="t('game_world.projects_list_label')">
      <li v-for="p in (projects ?? [])" :key="p.id">
        <button type="button" @click="emit('open-project', p)">
          {{ t('game_world.project_summary', { name: p.name || t('game_world.unnamed_project'), fruit: p.fruit || t('game_world.no_fruit'), stage: p.stage ?? 1 }) }}
        </button>
      </li>
      <li v-if="!bareMode">
        <button type="button" @click="emit('open-profile')">
          {{ t('game_world.open_profile') }}
        </button>
      </li>
      <li v-if="!bareMode">
        <button type="button" @click="emit('open-shop')">
          {{ t('game_world.open_shop') }}
        </button>
      </li>
    </ul>

    <div
      v-if="highlightElement"
      class="full-page-dim"
      aria-hidden="true"
    />

    <!-- lazy + async + dimensions so the 7 copies don't block first paint or cause CLS -->
    <div
      v-for="p in palmSlots"
      :key="p.cls"
      class="palma"
      :class="[p.cls, { 'palma-flip': p.flip }]"
      aria-hidden="true"
    >
      <img src="/images/dashboard/palma.webp?v=3" class="palma-img palma-day" alt="" draggable="false" width="678" height="1200" loading="lazy" decoding="async">
      <img :src="p.night" class="palma-img palma-night" alt="" draggable="false" loading="lazy" decoding="async">
    </div>

    <div
      v-if="showEncounters && !bareMode"
      id="encounters"
      class="encounter-box"
      :class="{ highlighted: highlightElement === 'encounters' }"
      aria-hidden="true"
    >
      <div class="encounter-island" />
      <span class="encounter-label">Encounters</span>
    </div>

    <div v-if="!bareMode" class="ground" aria-hidden="true">
      <div
        id="projects"
        ref="farmAreaRef"
        class="farm-area"
      >
            <div
              v-for="(tile, i) in (tilesReady ? gridTiles : [])"
              :key="i"
              class="farm-tile-iso"
              :class="{
                'farm-tile-project': !!getProjectForTile(i),
                'farm-tile-dragging-source': dragging && dragFrom === i,
                'highlighted': highlightElement === 'projects',
              }"
              :style="{
                left: getTilePosition(i).left + 'px',
                top: getTilePosition(i).top + 'px',
                zIndex: dragging && dragFrom === i ? 50 : undefined,
                animationDelay: (i * 60) + 'ms',
              }"
              :title="getProjectForTile(i) ? $t('dashboard.tile_open_hint') : undefined"
              @pointerdown="onDragStart(i, $event)"
              @mousedown.middle.prevent
              @click="handleTileClick(i, $event)"
              @auxclick="handleTileAux(i, $event)"
              @mouseenter.self="handleTileEnter(i)"
              @mouseleave="handleTileLeave"
              @contextmenu.prevent="openContextMenu(i, $event)"
            >
              <span
                v-if="getProjectForTile(i) && tagHex(getProjectForTile(i)?.id)"
                class="absolute top-1 right-1 w-3 h-3 border-2 border-white/80 z-[5] pointer-events-none"
                :style="{ background: tagHex(getProjectForTile(i)?.id) ?? undefined }"
              />
              <img :src="'/images/tierra/ground_tile.webp'" class="tile-img" alt="">
              <template v-if="getProjectForTile(i)">
                <img
                  v-if="getFruitStageImage(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage)"
                  :src="getFruitStageImage(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage)!"
                  class="plot-fruit-icon-iso"
                  :style="{
                    width: getFruitDisplay(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage).size + 'px',
                    height: getFruitDisplay(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage).size + 'px',
                    bottom: (getFruitDisplay(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage).bottom + 15) + 'px',
                    clipPath: getFruitDisplay(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage).clipBottom > 0
                      ? `inset(0 0 ${getFruitDisplay(getProjectForTile(i)?.fruit, getProjectForTile(i)?.stage).clipBottom}% 0)`
                      : undefined,
                  }"
                  :alt="getProjectForTile(i)?.fruit || 'plant'"
                >
                <div v-else class="plot-seedling-iso" />
                <div
                  v-if="isSharedProject(getProjectForTile(i))"
                  class="shared-badge"
                  :title="t('group_projects.shared_badge')"
                  :aria-label="t('group_projects.shared_badge')"
                >
                  <Users :size="12" />
                </div>
              </template>
            </div>

      </div>
    </div>

    <Transition name="panel">
      <div v-if="hoveredProject && !bareMode" class="project-panel" aria-hidden="true">
        <WoodFrame>
          <div class="flex items-center gap-4 p-4">
            <img
              v-if="getFruit(hoveredProject.fruit)?.icon"
              :src="getFruit(hoveredProject.fruit)!.icon"
              class="panel-fruit"
              :alt="hoveredProject.fruit || 'fruit'"
            >
            <div class="panel-info">
              <span class="panel-title">{{ hoveredProject.name || 'Project' }}</span>
              <span class="panel-hint">Click to open</span>
            </div>
          </div>
        </WoodFrame>
      </div>
    </Transition>

    <!-- houseRef sits on the img, not the wrapper, so collisions see the img's translateX transform -->
    <div
      v-if="!bareMode"
      class="house-area"
      :class="{ highlighted: highlightElement === 'house' || highlightElement === 'profile' }"
      aria-hidden="true"
      @click="emit('open-profile')"
      @mouseenter="startHoverPulse"
      @mouseleave="endHoverPulse"
    >
      <div class="building-stack house-stack">
        <img ref="houseRef" :src="houseImageSrc" alt="" class="house-img">
        <img :src="houseNightSrc" alt="" aria-hidden="true" class="house-img building-night building-night-center">
      </div>
    </div>

    <div
      v-if="!bareMode"
      ref="donkeyRef"
      class="donkey-area"
      :class="{ highlighted: highlightElement === 'shop' }"
      aria-hidden="true"
      @click="emit('open-shop')"
      @mouseenter="startHoverPulse"
      @mouseleave="endHoverPulse"
    >
      <div class="building-stack">
        <img :src="donkeyImageSrc" alt="" class="donkey-img">
        <img :src="donkeyNightSrc" alt="" aria-hidden="true" class="donkey-img building-night building-night-bottom">
      </div>
    </div>

    <div
      v-if="!bareMode"
      class="explore-area"
      :class="{ highlighted: highlightElement === 'explore' }"
      aria-hidden="true"
      @click="emit('open-explore')"
      @mouseenter="startHoverPulse"
      @mouseleave="endHoverPulse"
    >
      <div class="building-stack">
        <img :src="exploreImageSrc" alt="" class="explore-img">
        <img :src="exploreNightSrc" alt="" aria-hidden="true" class="explore-img building-night building-night-bottom">
      </div>
    </div>

    <NightButterflies v-if="!bareMode" />

    <div
      v-if="showStore && !bareMode"
      id="store"
      class="store-area"
      :class="{ highlighted: highlightElement === 'store' }"
      aria-hidden="true"
    >
      <div class="store-building">
        <div class="store-awning" />
        <div class="store-front">
          <span class="store-label">Store</span>
        </div>
      </div>
    </div>

    <div
      v-if="showDocsHint"
      class="docs-hint-pill"
      :class="{ highlighted: highlightElement === 'docs' }"
      aria-hidden="true"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {{ $t("nav.docs") }}
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="fixed inset-0 z-[150]"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <div
          class="fixed bg-parchment border-[3px] border-ds-brown shadow-xl w-52 py-1"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
          @click.stop
        >
          <p class="px-3 py-1.5 text-xs font-bold text-ds-brown/60 truncate">{{ contextMenu.project.name }}</p>
          <button type="button" class="w-full text-left px-3 py-1.5 text-sm text-ds-brown hover:bg-ds-brown/10 flex items-center gap-2" @click="ctxOpen">
            <Eye class="w-4 h-4 shrink-0" /> {{ $t("dashboard.quick_actions.open") }}
          </button>
          <button type="button" class="w-full text-left px-3 py-1.5 text-sm text-ds-brown hover:bg-ds-brown/10 flex items-center gap-2" @click="ctxOpenNewTab">
            <ExternalLink class="w-4 h-4 shrink-0" /> {{ $t("dashboard.quick_actions.open_new_tab") }}
          </button>
          <button type="button" class="w-full text-left px-3 py-1.5 text-sm text-ds-brown hover:bg-ds-brown/10 flex items-center gap-2" @click="ctxCopyLink">
            <Link2 class="w-4 h-4 shrink-0" /> {{ ctxCopied ? $t("dashboard.quick_actions.copied") : $t("dashboard.quick_actions.copy_link") }}
          </button>
          <button type="button" class="w-full text-left px-3 py-1.5 text-sm text-ds-brown hover:bg-ds-brown/10 flex items-center gap-2" @click="ctxHackatime">
            <Clock class="w-4 h-4 shrink-0" /> {{ $t("dashboard.quick_actions.hackatime") }}
          </button>
          <div class="border-t-2 border-ds-brown/15 mt-1 pt-2 px-3 pb-2">
            <span class="text-[10px] uppercase font-bold tracking-wide text-ds-brown/50">{{ $t("dashboard.quick_actions.tag") }}</span>
            <div class="flex items-center gap-1.5 mt-1.5">
              <button
                v-for="c in TAG_COLORS"
                :key="c.key"
                type="button"
                class="w-5 h-5 border-2 border-ds-brown/25 hover:scale-110 transition-transform"
                :style="{ background: c.hex }"
                :aria-label="c.key"
                @click="ctxSetTag(c.key)"
              />
              <button
                type="button"
                class="w-5 h-5 border-2 border-ds-brown/25 flex items-center justify-center text-ds-brown/50 hover:bg-ds-brown/10"
                :aria-label="$t('dashboard.quick_actions.clear_tag')"
                @click="ctxSetTag(null)"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.game-world {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: url('/images/dashboard/background.webp') top left / cover no-repeat;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

.night-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  /* raw night art with no tint or filter; the darkness comes from the painting itself */
  background: url('/images/dashboard/background_night.webp?v=3') top left / cover no-repeat;
  opacity: var(--night, 0);
  transition: opacity 0.6s ease;
  pointer-events: none;
}

.day-discs {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: var(--night, 0);
  transition: opacity 0.6s ease;
}
/* the mask is static; only the gpu-composited transform changes per frame */
.day-disc {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(var(--disc-r, 200px) * 2);
  height: calc(var(--disc-r, 200px) * 2);
  transform: translate(
    calc(var(--bx, -9999px) - var(--disc-r, 200px)),
    calc(var(--by, -9999px) - var(--disc-r, 200px))
  );
  overflow: hidden;
  /* soft offset lobes for an irregular glow; each fades out before the box edge
     so overflow:hidden never squares it off */
  -webkit-mask: var(--disc-blob);
  mask: var(--disc-blob);
  --disc-blob:
    radial-gradient(ellipse 40% 42% at 46% 44%, #000 0%, rgba(0,0,0,0.82) 40%, transparent 88%),
    radial-gradient(ellipse 33% 31% at 60% 53%, #000 0%, rgba(0,0,0,0.78) 36%, transparent 84%),
    radial-gradient(ellipse 30% 35% at 45% 61%, #000 0%, rgba(0,0,0,0.78) 34%, transparent 86%),
    radial-gradient(ellipse 25% 27% at 57% 39%, #000 0%, rgba(0,0,0,0.72) 30%, transparent 80%);
  will-change: transform;
}
/* vary the lobes so the five discs don't look stamped */
.day-discs-fg .day-disc:nth-child(2),
.day-discs .day-disc:nth-child(2) {
  --disc-blob:
    radial-gradient(ellipse 38% 40% at 54% 45%, #000 0%, rgba(0,0,0,0.82) 38%, transparent 86%),
    radial-gradient(ellipse 31% 34% at 40% 52%, #000 0%, rgba(0,0,0,0.78) 35%, transparent 84%),
    radial-gradient(ellipse 28% 30% at 55% 62%, #000 0%, rgba(0,0,0,0.76) 33%, transparent 85%),
    radial-gradient(ellipse 24% 26% at 44% 38%, #000 0%, rgba(0,0,0,0.72) 30%, transparent 80%);
}
.day-discs-fg .day-disc:nth-child(4),
.day-discs .day-disc:nth-child(4) {
  --disc-blob:
    radial-gradient(ellipse 41% 38% at 48% 52%, #000 0%, rgba(0,0,0,0.82) 39%, transparent 87%),
    radial-gradient(ellipse 30% 33% at 62% 46%, #000 0%, rgba(0,0,0,0.78) 35%, transparent 84%),
    radial-gradient(ellipse 27% 31% at 42% 47%, #000 0%, rgba(0,0,0,0.76) 33%, transparent 85%),
    radial-gradient(ellipse 23% 25% at 53% 63%, #000 0%, rgba(0,0,0,0.72) 30%, transparent 80%);
}
.day-discs-fg {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  opacity: var(--night, 0);
  transition: opacity 0.6s ease;
}
/* counter-translated so it stays registered to the farm; sized by --gw-w/--gw-h from NightButterflies */
.day-disc-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--gw-w, 1920px);
  height: var(--gw-h, 1080px);
  background: url('/images/dashboard/background.webp') top left / cover no-repeat;
  transform: translate(
    calc(var(--disc-r, 200px) - var(--bx, -9999px)),
    calc(var(--disc-r, 200px) - var(--by, -9999px))
  );
  will-change: transform;
}
/* no background, so the night scene shows through between the day art */
.day-disc-fg {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--gw-w, 1920px);
  height: var(--gw-h, 1080px);
  transform: translate(
    calc(var(--disc-r, 200px) - var(--bx, -9999px)),
    calc(var(--disc-r, 200px) - var(--by, -9999px))
  );
  will-change: transform;
}
/* the day copies reuse the real position classes to line up, but never cross-fade or glow */
.day-disc-fg .house-img,
.day-disc-fg .donkey-img,
.day-disc-fg .explore-img,
.day-disc-fg .palma-img {
  opacity: 1 !important;
  filter: none !important;
}
.day-disc-fg .farm-area {
  pointer-events: none;
}
.day-disc-fg .farm-tile-iso {
  filter: none !important;
  animation: none !important;
}


/* the day image defines the box; the night image overlays it and fades in with --night */
.building-stack {
  position: relative;
  display: inline-block;
}
.building-night {
  position: absolute;
  left: 0;
  top: 0;
  opacity: var(--night, 0);
  transition: opacity 0.6s ease;
  pointer-events: none;
  --glow: 0;
}
.building-night-center { object-position: center; }
.building-night-bottom { object-position: bottom; }

.house-img.building-night {
  transform-origin: 50% 50%;
  /* the night drawing is smaller and up-left in its canvas; ~7% aspect difference means
     this is close, not pixel-perfect (tune --house-night-scale / -tx / -ty) */
  transform:
    translate(var(--house-night-tx, 5%), var(--house-night-ty, 5%))
    scale(var(--house-night-scale, 1.1));
}

/* night buildings get no brightness filter (their art is already shaded); the
   inherited filter keeps the --glow highlight working on them */

/* plots dim per tile (see .farm-tile-iso): a scene-wide veil greyed the gaps, and a
   per-tile filter lets the butterflies relight single plots */

/* fade the day art out so none of it peeks around the night overlays */
.house-img:not(.building-night),
.donkey-img:not(.building-night),
.explore-img:not(.building-night),
.palma-day {
  opacity: calc(1 - var(--night, 0));
  transition: opacity 0.6s ease;
}

.ground {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  isolation: isolate;
}

/* drop .ground's stacking context so a highlighted tile (z 20) beats the dim overlay (z 15) */
.ground:has(.highlighted) {
  z-index: 20;
}

.farm-area {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 60%;
  transition: opacity 0.4s;
  z-index: 3;
  pointer-events: auto;
}

.farm-tile-iso {
  position: absolute;
  width: 120px;
  height: 90px;
  cursor: default;
  /* per tile so NightButterflies can override it inline near the flock */
  filter: brightness(calc(1 - 0.32 * var(--night, 0)));
  transition: transform 0.2s ease, filter 0.5s ease;
  /* staggered by each tile's inline animation-delay */
  animation: farm-tile-drop-in 0.45s cubic-bezier(0.25, 0.9, 0.3, 1.1) backwards;
}

@keyframes farm-tile-drop-in {
  0% {
    opacity: 0;
    transform: translateY(14px) scale(0.82);
  }
  60% {
    opacity: 1;
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.tile-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.farm-tile-project {
  cursor: pointer;
}

.farm-tile-project:hover,
.farm-tile-hovered {
  transform: scale(1.05);
  z-index: 10 !important;
  filter: brightness(1.15);
}

.plot-fruit-icon-iso {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  object-fit: contain;
  object-position: bottom;
  z-index: 5;
  pointer-events: none;
  filter: drop-shadow(0 0 1.5px white) drop-shadow(2px 6px 4px rgba(0, 0, 0, 0.4));
}

.shared-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #EACFB3;
  color: #684D3A;
  border: 2px solid #684D3A;
  z-index: 6;
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
}


.plot-seedling-iso {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 6px;
  height: 22px;
  background: #2d5a1e;
  border-radius: 1px;
  z-index: 1;
}

.plot-seedling-iso::before {
  content: "";
  position: absolute;
  top: -8px;
  left: -7px;
  width: 20px;
  height: 14px;
  background: #3a7a28;
  border-radius: 50%;
}

.project-panel {
  position: absolute;
  right: 40px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 20;
  max-width: 360px;
  /* never intercept clicks, so a tile beneath stays draggable */
  pointer-events: none;
}

.panel-fruit {
  width: 48px;
  height: 48px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(1px 3px 2px rgba(0, 0, 0, 0.2));
}

.panel-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.panel-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #684D3A;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.panel-hint {
  font-size: 0.7rem;
  color: rgba(104, 77, 58, 0.5);
}

.panel-enter-active {
  transition: all 0.25s ease-out;
}
.panel-leave-active {
  transition: all 0.2s ease-in;
}
.panel-enter-from {
  opacity: 0;
  transform: translateY(-50%) translateX(40px);
}
.panel-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(20px);
}

.area-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.store-area {
  position: absolute;
  bottom: 2%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  transition: opacity 0.4s;
}

.store-building {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.store-awning {
  width: 220px;
  height: 16px;
  background: repeating-linear-gradient(
    90deg,
    #c0392b 0px,
    #c0392b 20px,
    #fff 20px,
    #fff 40px
  );
  border-radius: 2px 2px 0 0;
}

.store-front {
  width: 200px;
  height: 50px;
  background: #8B6914;
  border: 2px solid #5C4A0A;
  display: flex;
  align-items: center;
  justify-content: center;
}

.store-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.house-area {
  position: absolute;
  left: 2%;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  cursor: pointer;
  transition: opacity 0.4s;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Extra padding so bounding box covers the full house image (offset by translateX) */
  padding-right: 40px;
}

.house-stack {
  /* on the wrapper so the night overlay shifts too; houseRef's rect still reflects it */
  transform: translateX(100px);
}

.house-img {
  width: 580px;
  height: auto;
  object-fit: contain;
  --glow: 0;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))
          drop-shadow(0 0 calc(4px * var(--glow)) rgba(255, 255, 255, var(--glow)))
          drop-shadow(0 0 calc(20px * var(--glow)) rgba(255, 255, 255, var(--glow)));
}

.house-label {
  margin-top: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.donkey-area {
  position: absolute;
  left: 38%;
  top: 78%;
  transform: translateY(-50%);
  z-index: 4;
  cursor: pointer;
  transition: opacity 0.4s;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.donkey-img {
  width: 350px;
  height: auto;
  object-fit: contain;
  --glow: 0;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))
          drop-shadow(0 0 calc(4px * var(--glow)) rgba(255, 255, 255, var(--glow)))
          drop-shadow(0 0 calc(20px * var(--glow)) rgba(255, 255, 255, var(--glow)));
}

.donkey-label {
  margin-top: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

/* under the house door, which sits near center because the house img is offset by translateX(100px) */
.explore-area {
  position: absolute;
  left: 32%;
  top: 80%;
  transform: translate(-50%, -50%);
  z-index: 4;
  cursor: pointer;
  transition: opacity 0.4s;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.explore-img {
  width: 110px;
  height: auto;
  object-fit: contain;
  --glow: 0;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))
          drop-shadow(0 0 calc(4px * var(--glow)) rgba(255, 255, 255, var(--glow)))
          drop-shadow(0 0 calc(20px * var(--glow)) rgba(255, 255, 255, var(--glow)));
}

.encounter-box {
  position: absolute;
  top: 8%;
  right: 10%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  z-index: 3;
  transition: opacity 0.4s;
}

.encounter-island {
  width: 100px;
  height: 40px;
  background: linear-gradient(to bottom, #4a7c3f, #3d6b35);
  border: 2px solid #2d5025;
  border-radius: 8px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}

.encounter-label {
  font-size: 0.65rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.full-page-dim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 15;
  pointer-events: none;
  animation: dim-fade-in 0.3s ease;
}

@keyframes dim-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.highlighted {
  z-index: 20 !important;
  animation: highlight-pulse 1.5s ease-in-out infinite;
}

@keyframes highlight-pulse {
  /* box-shadow, not a drop-shadow filter, to avoid a filter pass per frame */
  0%, 100% {
    box-shadow: 0 0 20px 4px rgba(255, 215, 0, 0.6),
                0 0 40px 8px rgba(255, 215, 0, 0.3);
  }
  50% {
    box-shadow: 0 0 40px 8px rgba(255, 215, 0, 1),
                0 0 80px 16px rgba(255, 215, 0, 0.5);
  }
}

.docs-hint-pill {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: rgba(246, 229, 199, 0.9);
  border: 3px solid #684D3A;
  color: #684D3A;
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  z-index: 9;
  transition: opacity 0.3s ease;
}

.farm-tile-iso.farm-tile-project {
  cursor: grab;
  /* otherwise native scrolling eats the pointermoves the long-press drag needs */
  touch-action: none;
}

.farm-tile-iso.farm-tile-project:active {
  cursor: grabbing;
}

.farm-tile-dragging-source {
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.4));
  transform: scale(1.05);
}

/* grows while the long-press timer runs, so the press reads as recognized */
.farm-tile-iso.farm-tile-press-pending {
  transition: transform 450ms ease-out;
  transform: scale(1.08);
  filter: brightness(1.1) drop-shadow(0 0 8px rgba(255, 230, 150, 0.6));
  z-index: 40;
}

/* override .farm-tile-dragging-source's 0.4 opacity so the dragged tile stays vivid */
.farm-tile-iso.farm-tile-press-armed {
  transform: scale(1.15);
  filter: brightness(1.2) drop-shadow(0 6px 12px rgba(0, 0, 0, 0.35));
  opacity: 1;
  z-index: 50;
}

.palma {
  position: absolute;
  pointer-events: none;
  /* above .ground (2) so tiles don't clip palms, behind the house (3, wins the tie by
     source order) and donkey (4); palma-2 and palma-3 override this */
  z-index: 3;
}

/* aspect pinned to the asset ratio (678x1200) so a stale-cached day palm with other
   proportions can't resize the box and push the night palm below the day art */
.palma-img {
  width: 100%;
  height: auto;
  aspect-ratio: 678 / 1200;
  object-fit: contain;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
}
.palma-night {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
  opacity: var(--night, 0);
  transition: opacity 0.6s ease;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
}
/* flip on the wrapper so the day and night layers flip together */
.palma-flip {
  transform: scaleX(-1);
}

.palma-1 {
  right: 2%;
  top: 5%;
  width: 220px;
}

.palma-2 {
  left: 0;
  bottom: 5%;
  width: 180px;
  z-index: 6;
}

.palma-3 {
  right: 15%;
  bottom: 0;
  width: 160px;
  z-index: 6;
}

.palma-4 {
  right: 0;
  top: 45%;
  width: 200px;
}

.palma-5 {
  left: 35%;
  top: 2%;
  width: 120px;
}

.palma-6 {
  right: 35%;
  top: 0;
  width: 100px;
}

.palma-7 {
  left: 55%;
  top: 5%;
  width: 140px;
}

.farm-tile-iso {
  /* no transition so tiles follow cursor instantly */
}

.farm-tile-dragging-source {
  opacity: 0.4;
  transform: scale(0.95);
}

.drag-ghost {
  position: fixed;
  width: 120px;
  height: 90px;
  z-index: 100;
  pointer-events: none;
  opacity: 0.8;
  transform: scale(1.1);
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.4));
}

/* drag is disabled on mobile, so transforming the farm container for layout is safe */
@media (max-width: 767px) {
  .farm-area {
    top: 56px;
    left: 0;
    right: 0;
    bottom: auto;
    width: 100%;
    height: 34vh;
    transform: scale(0.55);
    transform-origin: top left;
    overflow: visible;
  }

  .house-area {
    top: 42%;
    left: 50%;
    transform: translate(-50%, 0);
    padding-right: 0;
  }

  .house-stack {
    transform: none;
  }

  .house-img {
    width: 260px;
  }

  .donkey-area {
    top: 64%;
    left: 50%;
    transform: translate(-50%, 0);
  }

  .donkey-img {
    width: 190px;
  }

  .explore-area {
    top: auto;
    bottom: 8%;
    left: 38%;
    transform: translate(-50%, 0);
  }

  .explore-img {
    width: 110px;
  }

  .store-area {
    transform: translate(-50%, 0) scale(0.7);
  }

  .project-panel {
    font-size: 0.85rem;
  }

  .palma-1 { width: 140px; }
  .palma-2 { width: 115px; }
  .palma-3 { width: 105px; }
  .palma-4 { width: 130px; }
  .palma-5 { width: 80px; }
  .palma-6 { width: 65px; }
  .palma-7 { width: 90px; }
}
</style>
