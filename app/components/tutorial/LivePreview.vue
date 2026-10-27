<script setup lang="ts">
import { inlineMarkdown, esc } from '~/utils/formatting';

const props = defineProps<{
  html: string;
  css: string;
  mode: "html" | "readme";
  readmeContent?: string;
  linkingEnabled?: boolean;
  requireCssLink?: boolean;
}>();
const emit = defineEmits<{ "element-click": [line: number] }>();

const iframeRef = ref<HTMLIFrameElement | null>(null);

const debouncedHtml = ref(props.html);
const debouncedCss = ref(props.css);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watchEffect(() => {
  const html = props.html;
  const css = props.css;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedHtml.value = html;
    debouncedCss.value = css;
  }, 300); // debounce preview updates while typing
});

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});

function injectSourceLines(html: string): string {
  const blockTags = /^(\s*<)(h[1-6]|p|div|img|ul|ol|li|body)(\s|>)/gmi;
  return html.split("\n").map((line, i) => {
    return line.replace(blockTags, `$1$2 data-source-line="${i}"$3`);
  }).join("\n");
}

// Embedded in srcdoc because injecting via contentDocument needs allow-same-origin, which with
// allow-scripts would run learner HTML in this app's origin; this keeps the frame opaque.
const LINKING_SCRIPT = `
    let lastHighlighted = null;
    document.addEventListener('click', function(e) {
      let el = e.target;
      while (el && !el.dataset.sourceLine) el = el.parentElement;
      if (el && el.dataset.sourceLine) {
        if (lastHighlighted) {
          lastHighlighted.style.outline = '';
          var label = lastHighlighted.querySelector('.source-label');
          if (label) label.remove();
        }
        el.style.outline = '2px solid #3b82f6';
        var label = document.createElement('span');
        label.className = 'source-label';
        label.style.cssText = 'position:absolute;top:-10px;right:4px;background:#3b82f6;color:#fff;font-size:9px;padding:1px 6px;border-radius:3px;font-family:monospace;z-index:9999;';
        label.textContent = '<' + el.tagName.toLowerCase() + '> line ' + (parseInt(el.dataset.sourceLine)+1);
        el.style.position = el.style.position || 'relative';
        el.appendChild(label);
        lastHighlighted = el;
        parent.postMessage({ type: 'element-click', line: parseInt(el.dataset.sourceLine) }, '*');
      }
    });
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'code-click') {
        var el = document.querySelector('[data-source-line="' + e.data.line + '"]');
        if (el) {
          if (lastHighlighted) {
            lastHighlighted.style.outline = '';
            var label = lastHighlighted.querySelector('.source-label');
            if (label) label.remove();
          }
          el.style.outline = '2px solid #3b82f6';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          lastHighlighted = el;
        }
      }
    });
`;

// Goes before the learner's markup so an unclosed comment or <textarea> can't swallow it,
// but after any doctype so the preview doesn't render in quirks mode.
function withLinkingScript(html: string): string {
  // Escaped so the literal closing tag doesn't end this SFC's own script block
  // eslint-disable-next-line no-useless-escape
  const tag = `<script>${LINKING_SCRIPT}<\/script>`;
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  return doctype
    ? html.slice(0, doctype[0].length) + tag + html.slice(doctype[0].length)
    : tag + html;
}

const previewHtml = computed(() => {
  const sourceHtml = props.linkingEnabled ? debouncedHtml.value : props.html;
  const sourceCss = props.linkingEnabled ? debouncedCss.value : props.css;

  let html = props.linkingEnabled ? injectSourceLines(sourceHtml) : sourceHtml;

  if (sourceCss) {
    // Simulates real file linking: CSS applies only with a <link> to style.css
    if (/<link[^>]+href\s*=\s*["']style\.css["']/i.test(html) || !props.requireCssLink) {
      const styleTag = `<style>${sourceCss}</style>`;
      if (html.includes("</head>")) {
        html = html.replace("</head>", `${styleTag}</head>`);
      } else {
        html = styleTag + html;
      }
    }
  }

  return props.linkingEnabled ? withLinkingScript(html) : html;
});

const previewReadmeHtml = computed(() => {
  if (!props.readmeContent) return "";
  const htmlLines: string[] = [];
  let inList = false;

  for (const line of esc(props.readmeContent).split("\n")) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      const level = headingMatch[1]!.length;
      const sizes: Record<number, string> = { 1: "2em", 2: "1.5em", 3: "1.25em", 4: "1em", 5: "0.875em", 6: "0.85em" };
      const borderBottom = level <= 2 ? "border-bottom:1px solid #d0d0d0;padding-bottom:0.3em;" : "";
      htmlLines.push(`<h${level} style="font-size:${sizes[level]};font-weight:bold;margin:0.8em 0 0.4em;${borderBottom}">${inlineMarkdown(headingMatch[2]!)}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { htmlLines.push('<ul style="padding-left:1.5em;margin:0.5em 0">'); inList = true; }
      htmlLines.push(`<li style="margin:0.2em 0">${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (inList) { htmlLines.push("</ul>"); inList = false; }
    if (!line.trim()) {
      htmlLines.push('<div style="height:0.5em"></div>');
      continue;
    }
    htmlLines.push(`<p style="margin:0.3em 0;line-height:1.6">${inlineMarkdown(line)}</p>`);
  }
  if (inList) htmlLines.push("</ul>");
  return htmlLines.join("\n");
});

function onMessage(event: MessageEvent) {
  // The sandboxed frame's origin reads "null", so match on its window identity instead
  if (event.source !== iframeRef.value?.contentWindow) return;
  if (event.data?.type === 'element-click' && typeof event.data.line === 'number') {
    emit('element-click', event.data.line);
  }
}

onMounted(() => window.addEventListener('message', onMessage));
onBeforeUnmount(() => window.removeEventListener('message', onMessage));

function highlightElement(line: number) {
  const iframe = iframeRef.value;
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'code-click', line }, '*');
  }
}

defineExpose({ highlightElement });
</script>

<template>
  <div class="flex flex-col h-full bg-neutral-50">
    <div class="px-4 py-2 border-b border-black/10 text-xs font-bold uppercase tracking-wider text-black/40">
      {{ mode === 'readme' ? 'README Preview' : 'Preview' }}
    </div>

    <iframe
      v-if="mode === 'html'"
      ref="iframeRef"
      class="flex-1 preview-iframe"
      :srcdoc="previewHtml"
      sandbox="allow-scripts"
    />

    <div
      v-else
      class="flex-1 overflow-y-auto p-6 prose prose-sm max-w-none"
      v-html="previewReadmeHtml"
    />
  </div>
</template>
