<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { highlightHtml, highlightCss } from '~/utils/formatting';

const props = defineProps<{
  modelValue: string;
  language: "html" | "css";
  errorLines?: Set<number>;
  teachingError?: { line: number; message: string } | null;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const localValue = ref(props.modelValue);
const showTooltip = ref(false);
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

const undoStack = ref<string[]>([props.modelValue]);
const redoStack = ref<string[]>([]);
let historyTimer: ReturnType<typeof setTimeout> | null = null;

function pushHistory(val: string) {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    if (val !== undoStack.value[undoStack.value.length - 1]) {
      undoStack.value.push(val);
      redoStack.value = [];
      if (undoStack.value.length > 100) undoStack.value.shift();
    }
  }, 500);
}

function undo() {
  if (undoStack.value.length <= 1) return;
  redoStack.value.push(undoStack.value.pop()!);
  const prev = undoStack.value[undoStack.value.length - 1]!;
  localValue.value = prev;
  emit('update:modelValue', prev);
}

function redo() {
  if (redoStack.value.length === 0) return;
  const next = redoStack.value.pop()!;
  undoStack.value.push(next);
  localValue.value = next;
  emit('update:modelValue', next);
}

const canUndo = computed(() => undoStack.value.length > 1);
const canRedo = computed(() => redoStack.value.length > 0);

defineExpose({ highlightLine, undo, redo, canUndo, canRedo });

watch(() => props.modelValue, (v) => {
  if (v !== localValue.value) localValue.value = v;
});

watch(localValue, (v) => {
  pushHistory(v);
});

function describeHtmlErrors(code: string): Map<number, string> {
  const msgs = new Map<number, string>();
  const lines = code.split("\n");
  const tagStack: { tag: string; line: number }[] = [];
  const selfClosing = new Set(["img", "br", "hr", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);

  lines.forEach((line, i) => {
    const spaceBeforeTag = line.match(/<\s+(\/?\w+)/);
    if (spaceBeforeTag) {
      msgs.set(i, `Remove the space after <. Write <${spaceBeforeTag[1]}> not < ${spaceBeforeTag[1]}>`);
      return;
    }
    const spaceBeforeClose = line.match(/<(\/?\w+)\s+>/);
    if (spaceBeforeClose) {
      msgs.set(i, `Remove the space before >. Write <${spaceBeforeClose[1]}> not <${spaceBeforeClose[1]} >`);
      return;
    }

    const backslashTag = line.match(/<\\(\w+)>/);
    if (backslashTag) {
      msgs.set(i, `Use a forward slash for closing tags: </${backslashTag[1]}> not <\\${backslashTag[1]}>`);
      return;
    }

    const curlyTag = line.match(/\{\/?(html|head|body|title|p|h[1-6]|div|img|a|ul|ol|li|span|link|meta)\}/i);
    if (curlyTag) {
      msgs.set(i, `HTML uses angle brackets < >, not curly braces { }. Write <${curlyTag[1]}> instead of {${curlyTag[1]}}`);
      return;
    }

    const squareTag = line.match(/\[\/?(html|head|body|title|p|h[1-6]|div|img|a|ul|ol|li|span|link|meta)\]/i);
    if (squareTag) {
      msgs.set(i, `HTML uses angle brackets < >, not square brackets [ ]. Write <${squareTag[1]}> instead of [${squareTag[1]}]`);
      return;
    }

    let inTag = false;
    for (const ch of line) {
      if (ch === '<') {
        if (inTag) { msgs.set(i, 'Unclosed <. You have a < without a matching >'); break; }
        inTag = true;
      } else if (ch === '>') {
        inTag = false;
      }
    }
    if (inTag && !msgs.has(i)) {
      let contentInsideTag = false;
      let wrappedTag = false;
      let foundClosingAngle = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]!.trim();
        if (!nextLine) continue;
        if (nextLine === '>') {
          // Lone > on next line right after the tag, just a split tag
          foundClosingAngle = true;
          break;
        }
        if (nextLine.includes('>') && !nextLine.startsWith('<')) {
          // A > on a line not starting with < means the tag wraps (e.g. a long attribute value)
          wrappedTag = true;
          break;
        }
        if (nextLine.startsWith('<') && !nextLine.startsWith('</')) {
          // An opening tag means content went inside < >; a closing tag just means a missing >
          contentInsideTag = true;
          break;
        }
        break;
      }
      if (wrappedTag) {
        // Tag wraps across lines (e.g. long img src), not an error
      } else if (contentInsideTag) {
        msgs.set(i, "Content goes between opening and closing tags, like <body> content </body>, not inside the < and >");
      } else if (foundClosingAngle) {
        msgs.set(i, "The > should be on the same line as the tag name. Write <body> on one line, not split across lines");
      } else {
        msgs.set(i, 'This tag is missing its closing >. Make sure every < has a matching >');
      }
    }

    // Stray slash before an attribute (e.g. <img /alt="...">), left from half-deleting a self-closing slash
    if (!msgs.has(i)) {
      const slashAttr = line.match(/<\w+[^>]*\s\/([a-zA-Z][\w-]*)\s*=/);
      if (slashAttr) {
        msgs.set(i, `Attribute names don't start with /. Write ${slashAttr[1]}="..." instead of /${slashAttr[1]}="..."`);
      }
    }

    // Unclosed attribute quote before > (e.g. <h1 class="attt>); the unclosed-angle check misses it since > is present
    if (!msgs.has(i)) {
      const openTag = line.match(/<(\w+)([^>]*)>/);
      if (openTag) {
        const q = (openTag[2] || '').match(/\s([a-zA-Z][\w-]*)\s*=\s*(["'])([^"']*)$/);
        if (q) {
          msgs.set(i, `The ${q[1]} attribute's ${q[2]} is never closed before the >. Add a matching ${q[2]} after the value.`);
        }
      }
    }

    // Duplicate attributes: the browser silently keeps only the first one
    if (!msgs.has(i)) {
      const tagAttrs = line.match(/<\w+([^>]*)>/);
      if (tagAttrs) {
        const stripped = (tagAttrs[1] || '').replace(/(["'])(?:(?!\1).)*\1/g, '""');
        const names = [...stripped.matchAll(/\s([a-zA-Z][\w-]*)\s*=/g)].map(m => m[1]!.toLowerCase());
        const dup = names.find((n, idx) => names.indexOf(n) !== idx);
        if (dup) {
          msgs.set(i, `You have two "${dup}" attributes on this tag. Only one is allowed. Put every value inside a single ${dup}="..." (separated by spaces if it's class).`);
        }
      }
    }

    const validAttrs = new Set(["id", "class", "style", "src", "alt", "href", "rel", "type", "width", "height", "title", "target", "name", "value", "placeholder", "action", "method", "charset", "content", "lang", "data-source-line"]);
    const tagWithAttrs = line.match(/<(\w+)\s+([^>]*?)>/);
    if (tagWithAttrs && !msgs.has(i)) {
      const tagName = tagWithAttrs[1]!.toLowerCase();
      if (tagName !== '!doctype' && tagName !== 'link' && tagName !== 'meta') {
        const attrStr = tagWithAttrs[2]!.replace(/(["'])(?:(?!\1).)*\1/g, '');
        const bareWord = attrStr.match(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)(?:\s|$)/);
        if (bareWord && !validAttrs.has(bareWord[1]!.toLowerCase()) && !attrStr.includes(bareWord[1]! + '=')) {
          msgs.set(i, `"${bareWord[1]}" is inside the <${tagName}> tag itself. If this is content, move it between <${tagName}> and </${tagName}> instead`);
        }
      }
    }

    if (!msgs.has(i)) {
      const mismatch1 = line.match(/(\w+)\s*=\s*"([^"]*?)'/);
      const mismatch2 = line.match(/(\w+)\s*=\s*'([^']*?)"/);
      const mismatchedQuote = mismatch1 || mismatch2;
      if (mismatchedQuote) {
        msgs.set(i, `Mismatched quotes on ${mismatchedQuote[1]}. You opened with ${mismatch1 ? '"' : "'"} but closed with ${mismatch1 ? "'" : '"'}. Use the same quote on both sides.`);
      }
    }

    const unquotedAttr = line.match(/<\w+[^>]*\s(\w+)=([^\s"'>][^\s>]*)/);
    if (unquotedAttr && !msgs.has(i)) {
      const attrName = unquotedAttr[1];
      msgs.set(i, `Put quotes around the ${attrName} value: ${attrName}="${unquotedAttr[2]}". Attribute values need to be wrapped in quotes`);
    }

    for (const m of [...line.matchAll(/<(\/?)(\w+)[^>]*>/g)]) {
      const tag = m[2]!.toLowerCase();
      if (tag === "!doctype") continue;
      if (selfClosing.has(tag)) continue;
      if (/\/\s*>$/.test(m[0]!)) continue;
      if (m[1] !== "/") {
        tagStack.push({ tag, line: i });
      } else {
        let found = false;
        for (let j = tagStack.length - 1; j >= 0; j--) {
          if (tagStack[j]!.tag === tag) {
            for (let k = tagStack.length - 1; k > j; k--) {
              msgs.set(tagStack[k]!.line, `Unclosed <${tagStack[k]!.tag}> tag. Add </${tagStack[k]!.tag}> to close it`);
            }
            tagStack.splice(j);
            found = true;
            break;
          }
        }
        if (!found) {
          const lastOpen = tagStack[tagStack.length - 1];
          if (lastOpen) {
            msgs.set(i, `Mismatched tags: <${lastOpen.tag}> and </${tag}>. Either change this to </${lastOpen.tag}> or change the opening <${lastOpen.tag}> to <${tag}>`);
            tagStack.pop();
          } else {
            msgs.set(i, `Closing </${tag}> has no matching opening <${tag}> tag`);
          }
        }
      }
    }
  });
  for (const t of tagStack) {
    msgs.set(t.line, `Unclosed <${t.tag}> tag. Add </${t.tag}> to close it`);
  }
  return msgs;
}

const commonCssProperties = [
  "color", "background", "background-color", "background-image", "background-size",
  "background-position", "background-repeat", "font-family", "font-size", "font-weight",
  "font-style", "text-align", "text-decoration", "text-transform", "line-height",
  "letter-spacing", "word-spacing", "width", "height", "max-width", "max-height",
  "min-width", "min-height", "margin", "margin-top", "margin-right", "margin-bottom",
  "margin-left", "padding", "padding-top", "padding-right", "padding-bottom",
  "padding-left", "border", "border-radius", "border-color", "border-width",
  "border-style", "border-top", "border-bottom", "border-left", "border-right",
  "display", "position", "top", "right", "bottom", "left", "float", "clear",
  "overflow", "overflow-x", "overflow-y", "z-index", "opacity", "visibility",
  "cursor", "box-shadow", "text-shadow", "transition", "transform", "animation",
  "flex", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-self",
  "gap", "grid", "grid-template-columns", "grid-template-rows", "list-style",
  "list-style-type", "vertical-align", "white-space", "object-fit", "outline",
  "box-sizing", "content",
];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m]![n]!;
}

function suggestCssProperty(input: string): string | null {
  const lower = input.toLowerCase();
  if (commonCssProperties.includes(lower)) return null;
  let best = '';
  let bestDist = Infinity;
  for (const prop of commonCssProperties) {
    const dist = levenshtein(lower, prop);
    if (dist < bestDist) {
      bestDist = dist;
      best = prop;
    }
  }
  if (bestDist <= 3 && best) return best;
  return '';
}

const cssPropertyValues: Record<string, string[]> = {
  "text-align": ["left", "center", "right", "justify", "start", "end"],
  "text-decoration": ["none", "underline", "overline", "line-through"],
  "text-transform": ["none", "uppercase", "lowercase", "capitalize"],
  "font-style": ["normal", "italic", "oblique"],
  "font-weight": ["normal", "bold", "bolder", "lighter"],
  "display": ["block", "inline", "inline-block", "flex", "grid", "none", "inline-flex", "inline-grid"],
  "position": ["static", "relative", "absolute", "fixed", "sticky"],
  "float": ["left", "right", "none"],
  "clear": ["left", "right", "both", "none"],
  "overflow": ["visible", "hidden", "scroll", "auto"],
  "overflow-x": ["visible", "hidden", "scroll", "auto"],
  "overflow-y": ["visible", "hidden", "scroll", "auto"],
  "visibility": ["visible", "hidden", "collapse"],
  "cursor": ["pointer", "default", "text", "move", "not-allowed", "grab", "grabbing", "crosshair", "help", "wait"],
  "flex-direction": ["row", "row-reverse", "column", "column-reverse"],
  "flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
  "justify-content": ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"],
  "align-items": ["flex-start", "flex-end", "center", "stretch", "baseline"],
  "align-self": ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
  "background-repeat": ["repeat", "no-repeat", "repeat-x", "repeat-y"],
  "background-size": ["auto", "cover", "contain"],
  "background-position": ["top", "bottom", "left", "right", "center"],
  "border-style": ["none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"],
  "list-style-type": ["none", "disc", "circle", "square", "decimal"],
  "white-space": ["normal", "nowrap", "pre", "pre-wrap", "pre-line"],
  "vertical-align": ["baseline", "top", "middle", "bottom", "text-top", "text-bottom"],
  "object-fit": ["fill", "contain", "cover", "none", "scale-down"],
  "box-sizing": ["content-box", "border-box"],
  "font-family": ["Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "monospace", "sans-serif", "serif", "cursive"],
};

function suggestCssValue(prop: string, value: string): string | null {
  const validValues = cssPropertyValues[prop.toLowerCase()];
  if (!validValues) return null;

  for (const part of value.split(',')) {
    const trimmedVal = part.trim();
    if (!trimmedVal) continue;
    if (trimmedVal.startsWith('"') || trimmedVal.startsWith("'")) continue;
    const val = trimmedVal.toLowerCase();
    if (/^[\d.]+/.test(val) || val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl") || val.startsWith("url(") || val.startsWith("var(") || val === "inherit" || val === "initial" || val === "unset") continue;
    if (validValues.some(v => v.toLowerCase() === val)) continue;
    let best = '';
    let bestDist = Infinity;
    for (const v of validValues) {
      const dist = levenshtein(val, v);
      if (dist < bestDist) {
        bestDist = dist;
        best = v;
      }
    }
    if (bestDist <= 3 && best) return best;
  }
  return null;
}

function describeCssErrors(code: string): Map<number, string> {
  const msgs = new Map<number, string>();
  const lines = code.split("\n");
  let braceDepth = 0;
  lines.forEach((line, i) => {
    const opens = (line.match(/\{/g) || []).length;
    const braceDepthBefore = braceDepth;
    braceDepth += opens - (line.match(/\}/g) || []).length;
    if (braceDepth < 0) {
      msgs.set(i, "Extra closing } without a matching opening {");
      braceDepth = 0;
    }
    if (opens >= 2 && !msgs.has(i)) {
      msgs.set(i, "Curly braces { } are only used to wrap a group of properties. A CSS rule looks like: img { width: 300px; }");
    }
    const lineTrim = line.trim();
    if (!msgs.has(i) && /\{\s*[\d]+/.test(lineTrim) && !lineTrim.match(/^\w+\s*\{/)) {
      msgs.set(i, "Values don't go in curly braces. Write the value directly, like: width: 300px;");
    }
    if (braceDepth > 0 && line.trim() && !line.includes(":") && !line.includes("{") && !line.includes("}")) {
      msgs.set(i, "CSS properties need a colon between name and value, like color: red;");
    }
    const trimmed = line.trim();
    if ((braceDepth > 0 || braceDepthBefore > 0) && !msgs.has(i)) {
      const doubleColonMatch = trimmed.match(/^([\w-]+)\s*:.*:/);
      if (doubleColonMatch && !trimmed.startsWith("@") && !/::/.test(trimmed)) {
        msgs.set(i, `Extra colon in "${trimmed.replace(";", "")}". A CSS property should have only one colon, like ${doubleColonMatch[1]}: value;`);
      }
    }
    if (braceDepth > 0 && trimmed.includes(":") && !trimmed.endsWith(";") && !trimmed.endsWith("{") && !trimmed.endsWith("}") && !msgs.has(i)) {
      msgs.set(i, "Missing semicolon. Every CSS property needs to end with a semicolon, like color: red;");
    }
    if (braceDepth === 0 && braceDepthBefore === 0 && trimmed.includes(":") && trimmed.includes(";") && !trimmed.includes("{") && !msgs.has(i)) {
      const propMatch = trimmed.match(/^([\w-]+)\s*:/);
      if (propMatch) {
        msgs.set(i, `${propMatch[1]} needs to be inside a selector. First pick what to style (like img or body), then put properties inside curly braces: img { ${trimmed} }`);
      }
    }
    if (braceDepth > 0 && trimmed.includes(";") && !msgs.has(i)) {
      const afterSemicolon = trimmed.slice(trimmed.lastIndexOf(";") + 1).trim();
      if (afterSemicolon && afterSemicolon !== "}" && !afterSemicolon.includes(":")) {
        msgs.set(i, `Extra text "${afterSemicolon}" after the semicolon. Each property should be on its own line`);
      }
    }
    const unitlessProps = new Set([
      'font-weight', 'opacity', 'z-index', 'line-height', 'flex', 'flex-grow',
      'flex-shrink', 'order', 'columns', 'column-count', 'counter-reset',
      'counter-increment', 'zoom', 'tab-size', 'orphans', 'widows', 'scale',
    ]);
    const unitMatch = line.match(/:\s*(\d+)\s*;/);
    if (unitMatch && !msgs.has(i)) {
      const prop = line.match(/([\w-]+)\s*:/);
      const propName = prop ? prop[1] : 'this property';
      if (unitMatch[1] !== '0' && !unitlessProps.has(propName.toLowerCase())) {
        msgs.set(i, `${propName}: ${unitMatch[1]} needs a unit like px, %, em, or rem. For example, ${propName}: ${unitMatch[1]}px;`);
      }
    }
    if (braceDepthBefore === 0 && trimmed.includes(":") && trimmed.includes("{") && !msgs.has(i)) {
      const hasPseudo = /:[a-z][\w-]*(\([^)]*\))?\s*\{/.test(trimmed);
      const isAtRule = trimmed.startsWith("@");
      if (!hasPseudo && !isAtRule) {
        const selectorColon = trimmed.match(/^([\w-]+)\s*:/);
        if (selectorColon) {
          msgs.set(i, `"${selectorColon[1]}" looks like a CSS property, not a selector. Properties go inside curly braces, like: img { ${selectorColon[1]}: 300px; }`);
        }
      }
    }
    // Lines with { are selectors (e.g. "body: {"), not properties
    if (trimmed.includes(":") && !trimmed.includes("{") && !msgs.has(i)) {
      const cssPropMatch = trimmed.match(/^([\w-]+)\s*:\s*([^;{]+)/);
      const effectivelyInsideRule = braceDepth > 0 || braceDepthBefore > 0;
      if (cssPropMatch && effectivelyInsideRule) {
        const propName = cssPropMatch[1]!;
        const propValue = cssPropMatch[2]!.trim();
        const propSuggestion = suggestCssProperty(propName);
        if (propSuggestion === '') {
          msgs.set(i, `"${propName}" is not a recognized CSS property`);
        } else if (propSuggestion !== null) {
          msgs.set(i, `"${propName}" is not a valid CSS property. Did you mean ${propSuggestion}?`);
        } else if (propValue) {
          const valSuggestion = suggestCssValue(propName, propValue);
          if (valSuggestion === '') {
            msgs.set(i, `"${propValue}" is not a valid value for ${propName}`);
          } else if (valSuggestion !== null) {
            msgs.set(i, `"${propValue}" is not a valid value for ${propName}. Did you mean ${valSuggestion}?`);
          }
        }
      }
    }
    if (braceDepth === 0 && trimmed && !trimmed.includes(":") && !trimmed.includes("{") && !trimmed.includes("}") && !trimmed.includes(";") && !trimmed.startsWith("/*") && !trimmed.startsWith("//") && !msgs.has(i)) {
      let hasOpenBrace = false;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!.trim();
        if (!next) continue;
        if (next.startsWith("{")) { hasOpenBrace = true; }
        break;
      }
      if (!hasOpenBrace && /^[a-zA-Z][\w-]*$/.test(trimmed)) {
        msgs.set(i, `${trimmed} looks like a selector but is missing { }. Write it like ${trimmed} { property: value; }`);
      }
    }
  });
  if (braceDepth > 0) {
    msgs.set(lines.length - 1, "Missing closing }. Every { needs a matching }");
  }
  return msgs;
}

function addLineNumbers(highlighted: string, errorMessages: Map<number, string>, activeHighlight: number | null, cursorLine: number | null): string {
  return highlighted.split("\n").map((line, i) => {
    let content = line || " ";
    if (errorMessages.get(i)) {
      content = `<span class="error-line">${content}</span>`;
    }
    if (activeHighlight === i) {
      content = `<span class="highlighted-line">${content}</span>`;
    }
    const classes = ['code-line'];
    if (cursorLine === i) classes.push('cursor-line');
    return `<div class="${classes.join(' ')}"><span class="line-num">${i + 1}</span><span class="code-line-content">${content}</span></div>`;
  }).join("");
}

const cursorLine = ref<number | null>(null);

function updateCursorLine(textarea: HTMLTextAreaElement) {
  cursorLine.value = textarea.value.slice(0, textarea.selectionStart).split("\n").length - 1;
}

const highlightedCode = computed(() => {
  const code = localValue.value;

  return addLineNumbers(props.language === "html" ? highlightHtml(code) : highlightCss(code), errorMap.value, highlightedLine.value, cursorLine.value) + "\n";
});

function syncScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement;
  const pre = textarea.parentElement?.querySelector(".code-highlight") as HTMLPreElement;
  if (pre) {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }
}

watch(() => props.teachingError, (val) => {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  if (val) {
    showTooltip.value = true;
    tooltipTimer = setTimeout(() => {
      showTooltip.value = false;
    }, 5000);
  } else {
    showTooltip.value = false;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  if (tooltipTimer) clearTimeout(tooltipTimer);
  if (historyTimer) clearTimeout(historyTimer);
  if (highlightTimer) clearTimeout(highlightTimer);
});

const hoverError = ref<{ message: string; x: number; y: number } | null>(null);

const errorMap = computed(() => {
  const code = localValue.value;
  let map: Map<number, string>;
  if (props.errorLines) {
    map = new Map([...props.errorLines].map(line => [line, "Error on this line"]));
  } else {
    map = props.language === "html"
      ? describeHtmlErrors(code)
      : describeCssErrors(code);
  }
  // Include teaching errors so the line gets the red underline
  if (props.teachingError && !map.has(props.teachingError.line)) {
    map.set(props.teachingError.line, props.teachingError.message);
  }
  return map;
});

function onMouseMove(e: MouseEvent) {
  const textarea = e.currentTarget as HTMLTextAreaElement;
  const pre = textarea.parentElement?.querySelector('.code-highlight') as HTMLPreElement | null;
  if (!pre) { hoverError.value = null; return; }

  // Temporarily hide textarea so elementFromPoint hits the pre overlay
  textarea.style.pointerEvents = 'none';
  pre.style.pointerEvents = 'auto';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  pre.style.pointerEvents = '';
  textarea.style.pointerEvents = '';

  const codeLine = el?.closest?.('.code-line') as HTMLElement | null;
  if (!codeLine) { hoverError.value = null; return; }

  const parent = codeLine.parentElement;
  if (!parent) { hoverError.value = null; return; }
  const msg = errorMap.value.get(Array.from(parent.children).indexOf(codeLine));
  if (msg) {
    const lineRect = codeLine.getBoundingClientRect();
    hoverError.value = { message: msg, x: lineRect.left, y: lineRect.top };
  } else {
    hoverError.value = null;
  }
}

function onMouseLeave() {
  hoverError.value = null;
}

const highlightedLine = ref<number | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

function highlightLine(line: number) {
  highlightedLine.value = line;
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightedLine.value = null;
  }, 3000);

  const textarea = document.querySelector('.code-editor .code-input') as HTMLTextAreaElement;
  if (textarea) {
    textarea.scrollTop = Math.max(0, line * 21 - textarea.clientHeight / 2); // 21px line height (1.5 * 14)
    const pre = textarea.parentElement?.querySelector('.code-highlight') as HTMLPreElement;
    if (pre) pre.scrollTop = textarea.scrollTop;
  }
}

const acSuggestions = ref<string[]>([]);
const acSelected = ref(0);
const acPos = ref({ top: 0, left: 0 });
const acType = ref<'property' | 'value' | 'tailwind'>('property');
const acPrefix = ref('');

// Deliberately narrow (colors and text styles) to keep learners on what the tutorial teaches
const tailwindClassSuggestions = [
  'bg-pink-100', 'bg-blue-100', 'bg-green-100', 'bg-yellow-100',
  'bg-gray-100', 'bg-gray-900', 'bg-white', 'bg-black',
  'text-blue-500', 'text-red-500', 'text-green-600', 'text-pink-600',
  'text-gray-800', 'text-gray-600', 'text-white',
  'text-sm', 'text-lg', 'text-xl', 'text-2xl', 'text-4xl', 'text-6xl',
  'font-light', 'font-normal', 'font-semibold', 'font-bold',
  'text-left', 'text-center', 'text-right',
  'italic', 'underline', 'uppercase', 'lowercase',
];

type AutocompleteContext =
  | { type: 'property' | 'value'; prefix: string; propName?: string }
  | { type: 'tailwind'; prefix: string };

function getAutocompleteContext(value: string, cursor: number): AutocompleteContext | null {
  const before = value.slice(0, cursor);

  // HTML: suggest Tailwind classes only while the cursor is inside an unclosed class="..."
  if (props.language === 'html') {
    const classMatch = before.match(/\bclass\s*=\s*(["'])([^"'<>]*)$/);
    if (!classMatch) return null;
    const currentBody = classMatch[2] ?? '';
    const lastSpace = currentBody.lastIndexOf(' ');
    return { type: 'tailwind', prefix: lastSpace === -1 ? currentBody : currentBody.slice(lastSpace + 1) };
  }

  if (props.language !== 'css') return null;

  const currentLine = before.split('\n').pop() || '';

  if (before.lastIndexOf('{') <= before.lastIndexOf('}')) return null; // not inside a rule

  const colonIdx = currentLine.lastIndexOf(':');
  if (colonIdx !== -1) {
    const afterColon = currentLine.slice(colonIdx + 1).trimStart();
    if (currentLine.includes(';')) return null;
    if (afterColon.startsWith('"') || afterColon.startsWith("'")) return null;
    return { type: 'value', prefix: afterColon, propName: currentLine.slice(0, colonIdx).trim() };
  }

  const trimmed = currentLine.trimStart();
  if (trimmed.includes(':') || trimmed.includes('{') || trimmed.includes('}')) return null;
  return { type: 'property', prefix: trimmed };
}

function updateAutocomplete(textarea: HTMLTextAreaElement) {
  const ctx = getAutocompleteContext(textarea.value, textarea.selectionStart);

  if (!ctx) {
    acSuggestions.value = [];
    return;
  }

  let suggestions: string[];
  const prefix = ctx.prefix.toLowerCase();

  if (ctx.type === 'property') {
    suggestions = commonCssProperties.filter(p => p.startsWith(prefix) && p !== prefix);
  } else if (ctx.type === 'tailwind') {
    // Exact matches are excluded so the dropdown hides once a class is fully typed
    suggestions = prefix.length === 0
      ? tailwindClassSuggestions
      : tailwindClassSuggestions.filter((c) => c.toLowerCase().startsWith(prefix) && c.toLowerCase() !== prefix);
  } else {
    const vals = cssPropertyValues[ctx.propName || ''];
    if (!vals) { acSuggestions.value = []; return; }
    suggestions = prefix.length === 0
      ? vals
      : vals.filter(v => v.startsWith(prefix) && v !== prefix);
  }

  if (suggestions.length === 0) {
    acSuggestions.value = [];
    return;
  }

  acSuggestions.value = suggestions.slice(0, 15);
  acSelected.value = 0;
  acType.value = ctx.type;
  acPrefix.value = ctx.prefix;

  // Flip the dropdown above the cursor if it would overflow the bottom of the editor
  const lineHeight = 1.5 * 14;
  const lines = textarea.value.slice(0, textarea.selectionStart).split('\n');
  const lineNum = lines.length - 1;

  const baseTop = 12 + (lineNum + 1) * lineHeight - textarea.scrollTop;
  const editorHeight = editorEl.value?.getBoundingClientRect().height ?? 0;
  const estimatedDropdownHeight = Math.min(acSuggestions.value.length * 24, 192);
  const wouldOverflow = baseTop + estimatedDropdownHeight > editorHeight - 8;
  const flippedTop = baseTop - lineHeight - estimatedDropdownHeight;

  acPos.value = {
    top: wouldOverflow && flippedTop >= 0 ? flippedTop : baseTop,
    left: 40 + (lines[lineNum]?.length || 0) * 8.4, // approximate monospace char width
  };
}

function acceptSuggestion(textarea: HTMLTextAreaElement) {
  const suggestion = acSuggestions.value[acSelected.value];
  if (!suggestion) return;

  const cursor = textarea.selectionStart;
  const value = textarea.value;

  if (acType.value === 'property') {
    const before = value.slice(0, cursor - acPrefix.value.length);
    const insert = suggestion + ': ';
    localValue.value = before + insert + value.slice(cursor);
    const newPos = before.length + insert.length;
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = newPos;
      updateAutocomplete(textarea);
    });
  } else if (acType.value === 'tailwind') {
    // No trailing space: the learner types it, which also triggers a fresh suggestion list
    const before = value.slice(0, cursor - acPrefix.value.length);
    localValue.value = before + suggestion + value.slice(cursor);
    const newPos = before.length + suggestion.length;
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = newPos;
      updateAutocomplete(textarea);
    });
  } else {
    // For values: replace everything after the colon on this line
    const lineStart = value.slice(0, cursor).lastIndexOf('\n') + 1;
    const colonOffset = value.slice(lineStart).indexOf(':');
    if (colonOffset === -1) return;

    let lineEnd = value.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = value.length;

    const before = value.slice(0, lineStart + colonOffset + 1);
    const insert = ` ${suggestion}`;
    localValue.value = before + insert + value.slice(lineEnd);
    const newPos = before.length + insert.length;
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = newPos;
      updateAutocomplete(textarea);
    });
  }

  emit('update:modelValue', localValue.value);
  acSuggestions.value = [];
}

const editorEl = ref<HTMLElement | null>(null);

function onInput() {
  emit('update:modelValue', localValue.value);
  nextTick(() => {
    const textarea = editorEl.value?.querySelector('textarea') as HTMLTextAreaElement;
    if (textarea) {
      updateAutocomplete(textarea);
      updateCursorLine(textarea);
    }
  });
}

// selectionchange is the only cross-browser way to catch caret moves without an input event
function onSelectionChange() {
  const textarea = editorEl.value?.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea || document.activeElement !== textarea) return;
  updateCursorLine(textarea);
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange);
});

function onKeydown(e: KeyboardEvent) {
  const textarea = e.target as HTMLTextAreaElement;
  const { selectionStart, selectionEnd, value } = textarea;

  if (acSuggestions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acSelected.value = (acSelected.value + 1) % acSuggestions.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      acSelected.value = (acSelected.value - 1 + acSuggestions.value.length) % acSuggestions.value.length;
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      acceptSuggestion(textarea);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      acceptSuggestion(textarea);
      return;
    }
    if (e.key === 'Escape') {
      acSuggestions.value = [];
      return;
    }
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    localValue.value = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd);
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
    });
    emit('update:modelValue', localValue.value);
    return;
  }

  // Backspace in leading whitespace at a 2-space boundary removes a whole Tab indent at once
  if (e.key === 'Backspace' && selectionStart === selectionEnd && selectionStart >= 2) {
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const col = selectionStart - lineStart;
    const isLeadingWhitespace = /^\s*$/.test(value.slice(lineStart, selectionStart));
    const twoBefore = value.slice(selectionStart - 2, selectionStart);
    if (isLeadingWhitespace && twoBefore === '  ' && col % 2 === 0) {
      e.preventDefault();
      localValue.value = value.slice(0, selectionStart - 2) + value.slice(selectionEnd);
      nextTick(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart - 2;
        updateAutocomplete(textarea);
      });
      emit('update:modelValue', localValue.value);
      return;
    }
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const before = value.slice(0, selectionStart);
    const currentLine = before.split('\n').pop() || '';
    const indent = currentLine.match(/^(\s*)/)?.[1] || '';
    const trimmed = currentLine.trimEnd();
    const extraIndent = (trimmed.endsWith('{') || (trimmed.endsWith('>') && !trimmed.endsWith('/>'))) ? '  ' : '';
    localValue.value = before + '\n' + indent + extraIndent + value.slice(selectionEnd);
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 1 + indent.length + extraIndent.length;
      updateAutocomplete(textarea);
    });
    emit('update:modelValue', localValue.value);
    return;
  }
}

// Pasted/dropped images upload to the CDN and insert only the URL, not an <img> tag:
// learners are meant to write that tag themselves.

let uploadCounter = 0;
async function uploadPastedImage(file: File, insertAt: number) {
  const token = `uploading-image-${++uploadCounter}...`;
  localValue.value = localValue.value.slice(0, insertAt) + token + localValue.value.slice(insertAt);
  emit('update:modelValue', localValue.value);

  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await $fetch<{ url?: string; file?: string }>('/api/upload-image', {
      method: 'POST',
      body: formData,
    });
    const url = res.url || res.file || '';
    if (!url) throw new Error('upload response missing url');
    localValue.value = localValue.value.replace(token, url);
  } catch (err) {
    console.warn('[CodeEditor] image upload failed', err);
    localValue.value = localValue.value.replace(token, '');
  } finally {
    emit('update:modelValue', localValue.value);
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      uploadPastedImage(file, (e.target as HTMLTextAreaElement).selectionStart);
      return;
    }
  }
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      uploadPastedImage(file, (e.currentTarget as HTMLTextAreaElement).selectionStart);
      return;
    }
  }
}
</script>

<template>
  <div ref="editorEl" class="code-editor flex-1 relative rounded border border-black/15 overflow-hidden">
    <pre
      class="code-highlight absolute inset-0 font-mono text-sm py-3 pr-3 m-0 pointer-events-none overflow-auto"
      aria-hidden="true"
      v-html="highlightedCode"
    />
    <textarea
      v-model="localValue"
      class="code-input absolute inset-0 w-full h-full font-mono text-sm py-3 pl-10 pr-3 resize-none bg-transparent text-transparent caret-black focus:outline-none overflow-auto"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      @scroll="syncScroll"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @drop="onDrop"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    />
    <!-- Docked at the bottom so it can't cover the code -->
    <Transition name="tooltip-slide">
      <div
        v-if="teachingError && showTooltip"
        class="teaching-tooltip absolute bottom-0 left-0 right-0 z-40 flex items-start gap-2 px-3 py-2 text-xs border-t pointer-events-auto"
      >
        <div class="flex-1 min-w-0">
          <span class="font-semibold text-[#892808]">Line {{ teachingError.line + 1 }}:</span>
          <span class="text-[#892808]/80 ml-1">{{ teachingError.message }}</span>
        </div>
        <button
          type="button"
          class="text-[#892808]/60 hover:text-[#892808] shrink-0 transition-colors"
          :title="$t('tutorial_ui.dismiss_error')"
          @click="showTooltip = false"
        >
          <X :size="14" />
        </button>
      </div>
    </Transition>
    <div
      v-if="hoverError && !showTooltip"
      class="error-hover-tooltip fixed z-50 max-w-[300px] px-2.5 py-1.5 text-xs rounded shadow-md border pointer-events-none"
      :style="{ top: (hoverError.y - 8) + 'px', left: (hoverError.x + 40) + 'px', transform: 'translateY(-100%)' }"
    >
      {{ hoverError.message }}
    </div>
    <div
      v-if="acSuggestions.length > 0"
      class="ac-dropdown absolute z-20 bg-white border border-black/15 rounded shadow-lg max-h-48 overflow-y-auto"
      :style="{ top: acPos.top + 'px', left: Math.min(acPos.left, 280) + 'px' }"
    >
      <div
        v-for="(item, i) in acSuggestions"
        :key="item"
        class="ac-item px-3 py-1 text-xs font-mono cursor-pointer whitespace-nowrap"
        :class="i === acSelected ? 'bg-blue-500 text-white' : 'text-black/80 hover:bg-black/5'"
        @mousedown.prevent="acSelected = i; acceptSuggestion(editorEl?.querySelector('textarea')!)"
      >
        {{ item }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-editor {
  background: rgba(0, 0, 0, 0.02);
}
.code-highlight {
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  tab-size: 2;
  counter-reset: none;
  padding-left: 2.5rem !important;
  scrollbar-gutter: stable;
}
.code-input {
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  tab-size: 2;
  -webkit-text-fill-color: transparent;
  scrollbar-gutter: stable;
}

/* Coarse pointers use overlay scrollbars (no wrap mismatch), so skip the gutter to keep code width on phones. */
@media (pointer: coarse) {
  .code-highlight,
  .code-input {
    scrollbar-gutter: auto;
  }
}
.code-input::selection {
  -webkit-text-fill-color: transparent;
  background: rgba(0, 0, 0, 0.15);
}

:deep(.code-line) {
  position: relative;
  min-height: 1.5em;
}

/* Shadows extend the current-line highlight full width so blank lines still show it. */
:deep(.code-line.cursor-line) {
  background: rgba(0, 0, 0, 0.04);
  box-shadow: -10rem 0 0 rgba(0, 0, 0, 0.04), 10rem 0 0 rgba(0, 0, 0, 0.04);
}

:deep(.line-num) {
  position: absolute;
  left: -2.2rem;
  width: 1.5rem;
  text-align: right;
  color: rgba(0, 0, 0, 0.2);
  user-select: none;
  font-size: 0.7rem;
  line-height: 1.5;
}

:deep(.code-line-content) {
  display: inline;
}

:deep(.error-line) {
  text-decoration: wavy underline;
  text-decoration-color: #ef4444;
  text-underline-offset: 2px;
  background: rgba(239, 68, 68, 0.06);
  border-radius: 2px;
}

.teaching-tooltip {
  background: #fdf3ef;
  border-color: #892808;
}

.tooltip-slide-enter-active,
.tooltip-slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.tooltip-slide-enter-from,
.tooltip-slide-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

:deep(.highlighted-line) {
  background: rgba(59, 130, 246, 0.12);
  border-radius: 2px;
  display: inline;
  padding: 1px 2px;
  transition: background 0.2s ease;
}

.error-hover-tooltip {
  background: #fdf3ef;
  border-color: #892808;
  color: #892808;
}
</style>
