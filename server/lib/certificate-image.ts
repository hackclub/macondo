// Single visual source of truth: the PNG download, PDF and OG image all render through here.

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { SPONSORS } from "./certificates";
import type { PublicCertificate } from "./certificates";

const WIDTH = 1200;
const HEIGHT = 675;

const BROWN = "#684D3A";

// Intrinsic logo sizes so satori can lay each out at a fixed display height.
const LOGO_DISPLAY_HEIGHT = 38;
const SPONSOR_LOGOS = [
  { key: "mit", w: 1024, h: 242 },
  { key: "github", w: 1024, h: 293 },
  { key: "amd", w: 1024, h: 245 },
  { key: "gwc", w: 1024, h: 431 },
  { key: "cac", w: 1024, h: 204 },
];

const MACONDO_LOGO = { w: 1441, h: 451 };
const MACONDO_LOGO_HEIGHT = 132;

const FLAG = { w: 600, h: 210 };
const FLAG_DISPLAY_WIDTH = 140;

type SatoriFont = {
  name: string;
  data: Buffer;
  weight: 400 | 600;
  style: "normal";
};

let fontCache: SatoriFont[] | null = null;

async function loadFonts(): Promise<SatoriFont[]> {
  if (fontCache) return fontCache;
  const storage = useStorage("assets:server");
  const read = async (path: string): Promise<Buffer> => {
    const v = await storage.getItemRaw(path);
    if (!v) throw new Error(`Missing certificate font asset: ${path}`);
    return Buffer.isBuffer(v) ? v : Buffer.from(v as ArrayBuffer);
  };
  const [inter400, inter600, ays] = await Promise.all([
    read("fonts/Inter-400.ttf"),
    read("fonts/Inter-600.ttf"),
    read("fonts/AreYouSerious-400.ttf"),
  ]);
  fontCache = [
    { name: "Inter", data: inter400, weight: 400, style: "normal" },
    { name: "Inter", data: inter600, weight: 600, style: "normal" },
    { name: "Are You Serious", data: ays, weight: 400, style: "normal" },
  ];
  return fontCache;
}

let logoCache: Record<string, string> | null = null;

// PNG copies because satori is unreliable with webp.
async function loadSponsorLogos(): Promise<Record<string, string>> {
  if (logoCache) return logoCache;
  const storage = useStorage("assets:server");
  const out: Record<string, string> = {};
  for (const l of SPONSOR_LOGOS) {
    const v = await storage.getItemRaw(`sponsors/${l.key}.png`);
    if (!v) continue;
    out[l.key] = `data:image/png;base64,${(Buffer.isBuffer(v) ? v : Buffer.from(v as ArrayBuffer)).toString("base64")}`;
  }
  logoCache = out;
  return out;
}

let macondoLogoCache: string | null = null;

async function loadMacondoLogo(): Promise<string | null> {
  if (macondoLogoCache) return macondoLogoCache;
  const storage = useStorage("assets:server");
  const v = await storage.getItemRaw("logo-macondo.png");
  if (!v) return null;
  macondoLogoCache = `data:image/png;base64,${(Buffer.isBuffer(v) ? v : Buffer.from(v as ArrayBuffer)).toString("base64")}`;
  return macondoLogoCache;
}

let flagCache: string | null = null;

async function loadFlag(): Promise<string | null> {
  if (flagCache) return flagCache;
  const storage = useStorage("assets:server");
  const v = await storage.getItemRaw("flag-hackclub.png");
  if (!v) return null;
  flagCache = `data:image/png;base64,${(Buffer.isBuffer(v) ? v : Buffer.from(v as ArrayBuffer)).toString("base64")}`;
  return flagCache;
}

type VNode = {
  type: string;
  props: { style: Record<string, unknown>; children?: unknown };
};

function h(
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
): VNode {
  return { type, props: { style, children } };
}

function formatIssuedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function buildTree(
  cert: PublicCertificate,
  logos: Record<string, string>,
  macondoLogo: string | null,
  flag: string | null,
): VNode {
  const hours = Number(cert.hours ?? 0);
  const hoursLabel = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  // Zero hours only happens on staff issues (attendance, not logged time).
  const completedLine =
    hours > 0
      ? `has completed ${hoursLabel} of building personal projects through the Hack Club Macondo program.`
      : "has completed the Hack Club Macondo program.";

  const available = SPONSOR_LOGOS.filter((l) => logos[l.key]);
  const sponsorRow: VNode =
    available.length > 0
      ? ({
          type: "div",
          props: {
            style: {
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: "26px",
              maxWidth: 940,
            },
            children: available.map((l) => ({
              type: "img",
              props: {
                src: logos[l.key],
                width: Math.round(LOGO_DISPLAY_HEIGHT * (l.w / l.h)),
                height: LOGO_DISPLAY_HEIGHT,
                style: { objectFit: "contain" },
              },
            })),
          },
        } as unknown as VNode)
      : h(
          "div",
          { display: "flex", fontSize: 17, fontWeight: 600, color: BROWN },
          SPONSORS.map((s) => s.name).join("   ·   "),
        );

  const panelChildren: VNode[] = [
    macondoLogo
      ? ({
          type: "img",
          props: {
            src: macondoLogo,
            width: Math.round(
              MACONDO_LOGO_HEIGHT * (MACONDO_LOGO.w / MACONDO_LOGO.h),
            ),
            height: MACONDO_LOGO_HEIGHT,
            style: { marginTop: -34 },
          },
        } as unknown as VNode)
      : h(
          "div",
          { display: "flex", fontSize: 56, fontWeight: 600, color: BROWN },
          "Macondo",
        ),
    h(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      },
      [
        h(
          "div",
          {
            display: "flex",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: 6,
            color: cert.valid ? "#91A160" : "#892808", // success green / danger red
          },
          cert.valid ? "CERTIFICATE OF COMPLETION" : "CERTIFICATE REVOKED",
        ),
        h(
          "div",
          { display: "flex", fontSize: 24, color: "rgba(104,77,58,0.7)" },
          "This certifies that",
        ),
        h(
          "div",
          {
            display: "flex",
            fontSize: 60,
            fontWeight: 600,
            lineHeight: 1.1,
            color: BROWN,
          },
          cert.recipient_name,
        ),
        h(
          "div",
          {
            display: "flex",
            fontSize: 26,
            color: "rgba(104,77,58,0.85)",
            maxWidth: 840,
            lineHeight: 1.4,
            textAlign: "center",
          },
          completedLine,
        ),
      ],
    ),
    h(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        width: "100%",
      },
      [
        h(
          "div",
          {
            display: "flex",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 4,
            color: "rgba(104,77,58,0.55)",
          },
          "RECOGNIZED BY",
        ),
        sponsorRow,
        h(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            gap: 28,
            marginTop: 8,
            fontSize: 16,
            color: "rgba(104,77,58,0.7)",
          },
          [
            h("div", { display: "flex" }, `Issued ${formatIssuedDate(cert.issued_at)}`),
            h("div", { display: "flex", fontWeight: 600 }, cert.code),
            h("div", { display: "flex" }, "macondo.hackclub.com/certificate"),
          ],
        ),
      ],
    ),
  ];

  if (flag) {
    panelChildren.push({
      type: "img",
      props: {
        src: flag,
        width: FLAG_DISPLAY_WIDTH,
        height: Math.round(FLAG_DISPLAY_WIDTH * (FLAG.h / FLAG.w)),
        style: { position: "absolute", top: 30, left: 40 },
      },
    } as unknown as VNode);
  }

  if (!cert.valid) {
    panelChildren.push(
      h(
        "div",
        {
          position: "absolute",
          top: 320,
          display: "flex",
          fontSize: 150,
          fontWeight: 600,
          letterSpacing: 12,
          color: "rgba(137,40,8,0.18)",
          transform: "rotate(-18deg)",
        },
        "REVOKED",
      ),
    );
  }

  return h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      display: "flex",
      padding: 36,
      background: "#EACFB3", // parchment
      fontFamily: "Inter",
      color: BROWN,
    },
    [
      h(
        "div",
        {
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "center",
          background: "#F6E5C7", // cream
          border: `8px solid ${BROWN}`,
          padding: "52px 64px",
        },
        panelChildren,
      ),
    ],
  );
}

// Rendering is expensive, so cache PNGs to blunt endpoint spam; bounded against floods of distinct codes.
const renderCache = new Map<string, Buffer>();

export async function renderCertificatePng(
  cert: PublicCertificate,
): Promise<Buffer> {
  const cacheKey = `${cert.code}:${cert.valid ? "v" : "r"}`;
  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  const [fonts, logos, macondoLogo, flag] = await Promise.all([
    loadFonts(),
    loadSponsorLogos(),
    loadMacondoLogo(),
    loadFlag(),
  ]);
  const svg = await satori(
    buildTree(cert, logos, macondoLogo, flag) as unknown as Parameters<
      typeof satori
    >[0],
    { width: WIDTH, height: HEIGHT, fonts },
  );
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH * 1.6 }, // render scale for 1920x1080 output
  })
    .render()
    .asPng();
  const png = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered);

  if (renderCache.size >= 256) { // max cached certificate renders
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
  renderCache.set(cacheKey, png);
  return png;
}
