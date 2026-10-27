<script setup lang="ts">
const { blend } = useNightMode();

const COUNT = 5;
const FRAME_COUNT = 5;
const FRAME_MS = 110; // wing-flap cadence

// Boids tuning, in px and px/second.
const MAX_SPEED = 235;
const MAX_FORCE = 520;
const W_SEP = 1.8;
const W_ALI = 0.7;
const W_COH = 0.6;
const W_SEEK = 1.5;
const W_WANDER = 0.6;
const W_BOUNDS = 2.4;

const BASE_R = [72, 92, 80, 96, 84];

type Boid = {
  x: number; y: number; vx: number; vy: number;
  frame: number; frameAcc: number; angle: number; wander: number;
  r: number; rBase: number; rVel: number; flickPhase: number; flickSpeed: number;
};

const root = ref<HTMLElement | null>(null);
const boids = ref<Boid[]>([]);
const cursor = { x: 0, y: 0, inside: false };
// performance.now clock, to match the rAF step timestamp
let lastMoveTs = 0;
let raf = 0;
let last = 0;

function reduced(): boolean {
  return import.meta.client && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scene(): { el: HTMLElement; w: number; h: number } | null {
  const el = root.value?.parentElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { el, w: r.width, h: r.height };
}

// CSS vars drive GameWorld's .day-disc layers via transform (GPU-composited).
function publishVars() {
  const s = scene();
  if (!s) return;
  const arr = boids.value;
  for (let i = 0; i < COUNT; i++) {
    const b = arr[i];
    s.el.style.setProperty(`--b${i}x`, b ? `${b.x.toFixed(1)}px` : "-9999px");
    s.el.style.setProperty(`--b${i}y`, b ? `${b.y.toFixed(1)}px` : "-9999px");
    s.el.style.setProperty(`--b${i}r`, b ? `${b.r.toFixed(1)}px` : "84px");
  }
}

// keeps each disc's day-background layer aligned with the real one; not per frame
function publishSceneSize() {
  const s = scene();
  if (!s) return;
  s.el.style.setProperty("--gw-w", `${Math.round(s.w)}px`);
  s.el.style.setProperty("--gw-h", `${Math.round(s.h)}px`);
}

function limit(x: number, y: number, max: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m > max && m > 0) return [(x / m) * max, (y / m) * max];
  return [x, y];
}

function steer(dx: number, dy: number, vx: number, vy: number): [number, number] {
  return limit(dx - vx, dy - vy, MAX_FORCE);
}

function seed() {
  const s = scene();
  const cx = (s?.w ?? 1200) * 0.2; // 1200 = fallback scene width
  const cy = (s?.h ?? 700) * 0.5; // 700 = fallback scene height
  boids.value = Array.from({ length: COUNT }, (_, i) => ({
    x: cx + (Math.random() - 0.5) * 180,
    y: cy + (Math.random() - 0.5) * 180,
    vx: (Math.random() - 0.5) * 80,
    vy: (Math.random() - 0.5) * 80,
    frame: i % FRAME_COUNT,
    frameAcc: Math.random() * FRAME_MS,
    angle: Math.random() * 360,
    wander: Math.random() * Math.PI * 2,
    rBase: BASE_R[i % BASE_R.length],
    r: BASE_R[i % BASE_R.length],
    rVel: 0,
    flickPhase: Math.random() * Math.PI * 2,
    flickSpeed: 0.5 + Math.random() * 0.7, // rad/s, each butterfly breathes at its own pace
  }));
  publishSceneSize();
  publishVars();
}

function step(ts: number) {
  raf = requestAnimationFrame(step);
  if (!last) last = ts;
  const dt = Math.min(0.05, (ts - last) / 1000); // cap the step at 50ms after tab stalls
  last = ts;
  const s = scene();
  if (!s) return;
  const { w, h } = s;
  const arr = boids.value;
  const cursorActive = cursor.inside && ts - lastMoveTs < 3000; // cursor idle ms before they wander

  for (const b of arr) {
    let ax = 0;
    let ay = 0;
    let sepX = 0;
    let sepY = 0;
    let aliX = 0;
    let aliY = 0;
    let cohX = 0;
    let cohY = 0;
    let n = 0;
    for (const o of arr) {
      if (o === b) continue;
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 150 && d > 0) { // radius for alignment + cohesion
        aliX += o.vx; aliY += o.vy;
        cohX += o.x; cohY += o.y;
        n++;
        if (d < 54) { sepX += dx / d; sepY += dy / d; }
      }
    }
    if (n > 0) {
      const al = Math.hypot(aliX, aliY);
      if (al > 0) {
        const [sx, sy] = steer((aliX / al) * MAX_SPEED, (aliY / al) * MAX_SPEED, b.vx, b.vy);
        ax += sx * W_ALI; ay += sy * W_ALI;
      }
      const tcx = cohX / n - b.x;
      const tcy = cohY / n - b.y;
      const cl = Math.hypot(tcx, tcy);
      if (cl > 0) {
        const [sx, sy] = steer((tcx / cl) * MAX_SPEED, (tcy / cl) * MAX_SPEED, b.vx, b.vy);
        ax += sx * W_COH; ay += sy * W_COH;
      }
    }
    const sl = Math.hypot(sepX, sepY);
    if (sl > 0) {
      const [sx, sy] = steer((sepX / sl) * MAX_SPEED, (sepY / sl) * MAX_SPEED, b.vx, b.vy);
      ax += sx * W_SEP; ay += sy * W_SEP;
    }
    if (cursorActive) {
      const dx = cursor.x - b.x;
      const dy = cursor.y - b.y;
      const dl = Math.hypot(dx, dy);
      if (dl > 0) {
        const [sx, sy] = steer((dx / dl) * MAX_SPEED, (dy / dl) * MAX_SPEED, b.vx, b.vy);
        ax += sx * W_SEEK; ay += sy * W_SEEK;
      }
    } else {
      b.wander += (Math.random() - 0.5) * 0.7;
      const [sx, sy] = steer(Math.cos(b.wander) * MAX_SPEED, Math.sin(b.wander) * MAX_SPEED, b.vx, b.vy);
      ax += sx * W_WANDER; ay += sy * W_WANDER;
    }
    const margin = 60;
    if (b.x < margin) ax += MAX_FORCE * W_BOUNDS;
    else if (b.x > w - margin) ax -= MAX_FORCE * W_BOUNDS;
    if (b.y < margin) ay += MAX_FORCE * W_BOUNDS;
    else if (b.y > h - margin) ay -= MAX_FORCE * W_BOUNDS;

    b.vx += ax * dt;
    b.vy += ay * dt;
    [b.vx, b.vy] = limit(b.vx, b.vy, MAX_SPEED);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.x = Math.max(8, Math.min(w - 8, b.x));
    b.y = Math.max(8, Math.min(h - 8, b.y));

    if (Math.hypot(b.vx, b.vy) > 6) {
      const target = Math.atan2(b.vy, b.vx) * 180 / Math.PI + 90;
      b.angle += (((target - b.angle + 540) % 360) - 180) * 0.2;
    }
    b.frameAcc += dt * 1000;
    if (b.frameAcc >= FRAME_MS) { b.frameAcc = 0; b.frame = (b.frame + 1) % FRAME_COUNT; }
    // time-scaled so the flicker is frame-rate independent; clamped to +/-28% of base
    b.flickPhase += dt * b.flickSpeed;
    b.rVel += (Math.random() - 0.5) * 200 * dt;
    b.rVel *= Math.pow(0.85, dt * 60);
    b.r += (b.rBase * (1 + Math.sin(b.flickPhase) * 0.1) - b.r) * Math.min(1, dt * 3) + b.rVel * dt;
    b.r = Math.max(b.rBase * 0.72, Math.min(b.rBase * 1.28, b.r));
  }

  publishVars();

  boids.value = [...arr];
}

function start() {
  if (raf || reduced()) return;
  last = 0;
  raf = requestAnimationFrame(step);
}
function stop() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

function onMouseMove(e: MouseEvent) {
  const s = scene();
  if (!s) return;
  const r = s.el.getBoundingClientRect();
  cursor.x = e.clientX - r.left;
  cursor.y = e.clientY - r.top;
  cursor.inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x <= r.width && cursor.y <= r.height;
  lastMoveTs = performance.now();
}

function onVisibility() {
  if (document.visibilityState === "visible" && blend.value > 0.01) start();
  else stop();
}

const active = computed(() => blend.value > 0.01);
watch(active, (on) => {
  if (on && document.visibilityState === "visible") start();
  else stop();
});

function onResize() {
  seed();
}
onMounted(() => {
  seed();
  window.addEventListener("mousemove", onMouseMove, { passive: true });
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  if (active.value) start();
});
onBeforeUnmount(() => {
  stop();
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
});

function frameSrc(f: number): string {
  return `/images/dashboard/butterfly/frame_${f}.webp`;
}
</script>

<template>
  <div ref="root" class="night-butterflies" :style="{ opacity: blend }" aria-hidden="true">
    <img
      v-for="(b, i) in boids"
      :key="i"
      :src="frameSrc(b.frame)"
      class="butterfly"
      :style="{ transform: `translate3d(${b.x}px, ${b.y}px, 0) rotate(${b.angle.toFixed(1)}deg)` }"
      alt=""
      draggable="false"
    >
  </div>
</template>

<style scoped>
.night-butterflies {
  position: absolute;
  inset: 0;
  z-index: 8;
  pointer-events: none;
  transition: opacity 0.6s ease;
}
.butterfly {
  position: absolute;
  top: 0;
  left: 0;
  width: 54px;
  height: 54px;
  margin: -27px 0 0 -27px; /* center the sprite on its (x,y) so rotation pivots true */
  object-fit: contain;
  will-change: transform;
  filter: drop-shadow(0 0 6px rgba(255, 240, 180, 0.5));
  pointer-events: none;
}
</style>
