export type TailwindCheckResult = {
  passed: boolean;
  feedback: string;
};

type Locale = "en" | "es";

type Category = "color" | "size" | "spacing" | "other";

const COLOR_RE = /^(text|bg|border|from|to|via|fill|stroke|placeholder|decoration|outline|ring|accent|caret)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-\d{2,3})?$/;
const SIZE_RE = /^(w|h|min-w|min-h|max-w|max-h|text)-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\d+|px|full|screen|auto)$/;
const SPACING_RE = /^[pm][tblrxy]?-(\d+(\.\d+)?|px|auto)$/;

// an explicit list so random words a student pastes as a class don't count
const OTHER_SINGLE_WORDS = new Set([
  "rounded", "shadow", "border", "flex", "grid", "block", "inline",
  "hidden", "table", "contents", "flow-root", "static", "fixed",
  "absolute", "relative", "sticky", "italic", "antialiased", "underline",
  "overline", "uppercase", "lowercase", "capitalize", "truncate",
  "invisible", "visible", "isolate", "container", "group", "peer",
]);

function categorize(cls: string): Category | null {
  if (COLOR_RE.test(cls)) return "color";
  if (SIZE_RE.test(cls)) return "size";
  if (SPACING_RE.test(cls)) return "spacing";
  if (cls.includes("-") && /^[a-z][a-z0-9:/[\]#.-]*$/i.test(cls)) return "other";
  if (OTHER_SINGLE_WORDS.has(cls.toLowerCase())) return "other";
  return null;
}

function extractClassAttrValues(html: string): string[] {
  const out: string[] = [];
  const re = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[2] ?? m[3] ?? "");
  }
  return out;
}

function hasTailwindScript(html: string): boolean {
  return /<script[^>]+src\s*=\s*["']https:\/\/cdn\.tailwindcss\.com[^"']*["']/i.test(html);
}

function hasRawStyles(html: string): boolean {
  if (/<style\b[^>]*>/i.test(html)) return true;
  if (/\bstyle\s*=\s*("[^"]+"|'[^']+')/i.test(html)) return true;
  return false;
}

const COPY: Record<Locale, {
  missingScript: string;
  noClasses: string;
  rawStyles: string;
  onlyOneElement: string;
  missingColor: string;
  missingSizeOrSpacing: string;
  missingOther: string;
}> = {
  en: {
    missingScript: "Add the Tailwind script tag inside your <head>: <script src=\"https://cdn.tailwindcss.com\"></script>.",
    noClasses: "Add at least one Tailwind class to one of your elements (your heading, paragraph, or image). Open the Notebook for a list of classes to choose from.",
    rawStyles: "Remove the <style> block or style=\"...\" attribute. Use only Tailwind classes on this step.",
    onlyOneElement: "Put Tailwind classes on at least two different elements, not just one. Try your heading, paragraph, or image. The Notebook has the full list of classes.",
    missingColor: "Add a color class to one of your elements (your heading, paragraph, or image), like text-blue-500 or bg-pink-100. Open the Notebook for more color options.",
    missingSizeOrSpacing: "Add a size or spacing class to one of your elements (your heading, paragraph, or image), like text-2xl, w-64, p-4, or m-2. Open the Notebook for more size and spacing classes.",
    missingOther: "Add one more Tailwind class to one of your elements (your heading, paragraph, or image), like rounded, shadow, or flex, to round things out. Open the Notebook for more options.",
  },
  es: {
    missingScript: "Agrega la etiqueta script de Tailwind dentro de tu <head>: <script src=\"https://cdn.tailwindcss.com\"></script>.",
    noClasses: "Agrega al menos una clase de Tailwind a uno de tus elementos (tu título, párrafo o imagen). Abre el Cuaderno para ver la lista de clases que puedes usar.",
    rawStyles: "Quita el bloque <style> o el atributo style=\"...\". Usa solo clases de Tailwind en este paso.",
    onlyOneElement: "Pon clases de Tailwind en al menos dos elementos distintos, no solo uno. Prueba con tu título, párrafo o imagen. El Cuaderno tiene la lista completa de clases.",
    missingColor: "Agrega una clase de color a uno de tus elementos (tu título, párrafo o imagen), como text-blue-500 o bg-pink-100. Abre el Cuaderno para ver más opciones de color.",
    missingSizeOrSpacing: "Agrega una clase de tamaño o espaciado a uno de tus elementos (tu título, párrafo o imagen), como text-2xl, w-64, p-4 o m-2. Abre el Cuaderno para ver más clases de tamaño y espaciado.",
    missingOther: "Agrega una clase de Tailwind más a uno de tus elementos (tu título, párrafo o imagen), como rounded, shadow o flex, para rematar. Abre el Cuaderno para ver más opciones.",
  },
};

export function checkAddTailwind(html: string, locale: Locale): TailwindCheckResult {
  const copy = COPY[locale];
  if (!hasTailwindScript(html)) {
    return { passed: false, feedback: copy.missingScript };
  }
  if (
    !extractClassAttrValues(html).some((attr) =>
      attr.split(/\s+/).some((c) => c && categorize(c) !== null),
    )
  ) {
    return { passed: false, feedback: copy.noClasses };
  }
  return { passed: true, feedback: "" };
}

export function checkStyleWithTailwind(html: string, locale: Locale): TailwindCheckResult {
  const copy = COPY[locale];
  if (hasRawStyles(html)) {
    return { passed: false, feedback: copy.rawStyles };
  }
  const elementsWithTw = extractClassAttrValues(html)
    .map((attr) => attr.split(/\s+/).filter((c) => c && categorize(c) !== null))
    .filter((cats) => cats.length > 0);

  if (elementsWithTw.length < 2) {
    return { passed: false, feedback: copy.onlyOneElement };
  }

  const seen = new Set<Category>();
  for (const classes of elementsWithTw) {
    for (const c of classes) {
      const cat = categorize(c);
      if (cat) seen.add(cat);
    }
  }

  if (!seen.has("color")) {
    return { passed: false, feedback: copy.missingColor };
  }
  if (!seen.has("size") && !seen.has("spacing")) {
    return { passed: false, feedback: copy.missingSizeOrSpacing };
  }
  if (!seen.has("other")) {
    return { passed: false, feedback: copy.missingOther };
  }
  return { passed: true, feedback: "" };
}
