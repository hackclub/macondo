// Lets non-code challenges (like opening the Notebook) check the learner did the action.
export interface ChallengeContext {
  hasOpenedNotebook: boolean;
}

export interface TinkerChallenge {
  id: string;
  prompt: string;
  check: (
    code: { html: string; css: string; readme: string },
    ctx?: ChallengeContext,
  ) => boolean;
}

export interface TinkerError {
  detect: (
    current: { html: string; css: string; readme: string },
    original: { html: string; css: string; readme: string },
  ) => number | false;
  message: string;
  file: "html" | "css" | "readme";
}

export interface CopyableSnippet {
  label: string;
  code: string;
  language: "html" | "css" | "markdown";
}

export interface TutorialSubStepData {
  id: string;
  title: string;
  goal: {
    description: string;
    previewCode: { html: string; css?: string; readme?: string };
  };
  tinker: {
    starterCode: { html: string; css?: string; readme?: string };
    showCssEditor: boolean;
    challenges: TinkerChallenge[];
    errors: TinkerError[];
    freeFormPrompt?: string;
    freeFormCheck?: (code: { html: string; css: string; readme: string }) => boolean;
    requirePreviewClick?: boolean;
  };
  explain: {
    content: string;
    snippets: CopyableSnippet[];
    learnMoreLinks: { label: string; url: string }[];
  };
  apply: {
    validationStepId: string;
    starterCode?: { html?: string; css?: string; readme?: string };
    instructions?: string;
  };
}

function lineIndexOf(text: string, pattern: RegExp | string): number | false {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (typeof pattern === "string" ? lines[i].includes(pattern) : pattern.test(lines[i])) {
      return i;
    }
  }
  return false;
}

// Returns 0 instead of false to avoid falsy-zero bugs with ||
function lineIndexOrZero(text: string, pattern: RegExp | string): number {
  const idx = lineIndexOf(text, pattern);
  return idx !== false ? idx : 0;
}

// Only spellings that can't collide with real attributes or English words (no "al"/"lt"/"sr").
const ATTR_MISSPELLINGS: Record<string, readonly string[]> = {
  src: ["scr", "str", "rsc", "ssrc", "scrr"],
  alt: ["atl", "aly", "aat", "altt"],
  href: ["hre", "hef", "hrf", "herf", "hrfe"],
  class: ["calss", "clss", "clas", "clsas", "caass"],
  style: ["stlye", "stlyle", "styel", "sytle"],
  width: ["widht", "wdith", "wdth", "witdh"],
  height: ["hieght", "heigth", "hegiht", "heigt"],
  title: ["ttile", "titel", "tilte"],
  type: ["tpye", "tyep", "typpe"],
};

// Steps opt in per attribute so learners aren't nagged about attributes they haven't seen yet.
function attrMisspellingError(attr: keyof typeof ATTR_MISSPELLINGS): TinkerError {
  // Leading whitespace and trailing `=` match only attribute names, not words inside values.
  const misspellingRe = new RegExp(`\\s(?:${ATTR_MISSPELLINGS[attr]!.join("|")})\\s*=`, "i");
  return {
    detect: (current) => {
      if (!misspellingRe.test(current.html)) return false;
      return lineIndexOrZero(current.html, misspellingRe);
    },
    message: `Looks like '${attr}' is misspelled. The attribute name has to be exactly '${attr}'; double-check the letters.`,
    file: "html",
  };
}

const htmlStructure: TutorialSubStepData = {
  id: "html_structure",
  title: "HTML Structure",
  goal: {
    description:
      "By the end of this tutorial you'll have built your own site like this: a personal page you can actually share with your friends and family. Every webpage is made of HTML and CSS, and you'll shape each piece of yours yourself as we go.",
    previewCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Portfolio</title>
  </head>
  <body>
    <h1>My Portfolio</h1>
    <p>This is a website I can show off to friends and family. It has info about me, my projects, and how to get in touch.</p>
    <img src="https://placecats.com/300/200" alt="A cute cat" width="300">
  </body>
</html>`,
      css: `body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; text-align: center; } img { border-radius: 8px; margin-top: 16px; }`,
    },
  },
  tinker: {
    starterCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Portfolio</title>
  </head>
  <body>
    <h1>My Portfolio</h1>
    <p>This is a website I can show off to friends and family. It has info about me, my projects, and how to get in touch.</p>
    <img src="https://placecats.com/300/200" alt="A cute cat" width="300">
  </body>
</html>`,
    },
    showCssEditor: false,
    requirePreviewClick: true,
    challenges: [
      {
        id: "delete_paragraph",
        prompt:
          "Try deleting the &lt;p&gt;...&lt;/p&gt; line. What disappears from the preview?",
        check: (code) => !/<p>/i.test(code.html),
      },
      {
        id: "add_paragraph_back",
        prompt:
          "Now add a &lt;p&gt; tag back between &lt;body&gt; and &lt;/body&gt; with some text. For example: <code>&lt;p&gt;Hello, I like building things!&lt;/p&gt;</code>",
        check: (code) => /<p>[^<]+<\/p>/i.test(code.html),
      },
      {
        id: "open_notebook",
        prompt:
          "Last thing, click the <strong>Notebook</strong> button in the bottom-right corner. That's your cheat sheet. It only has <code>&lt;p&gt;</code> in it right now, but new HTML tags and Tailwind classes will show up in there as you learn them throughout the tutorial, so you always have a reference while you're building.",
        check: (_code, ctx) => !!ctx?.hasOpenedNotebook,
      },
    ],
    errors: [
      {
        detect: (current) => {
          const match = current.html.match(/<(body|head|html)([^>]*)</i);
          if (match) {
            const insideTag = match[2] || '';
            if (/</.test(insideTag) || (!/>/.test(insideTag) && /\S/.test(insideTag) && insideTag.length > 1)) {
              const afterTag = current.html.slice(current.html.indexOf(match[0]) + match[0].length);
              if (/^[^>]*</.test(afterTag) || /^[^>]*\n/.test(afterTag)) {
                return lineIndexOrZero(current.html, new RegExp(`<${match[1]}`, 'i'));
              }
            }
          }
          return false;
        },
        message:
          "It looks like you're putting content inside the tag itself. Content goes between the opening and closing tags, like <body> content here </body>, not inside the angle brackets.",
        file: "html",
      },
      {
        detect: (current) => {
          if (/<body[\s>]/i.test(current.html) && !/<\/body>/i.test(current.html)) {
            const idx = lineIndexOf(current.html, /<body[\s>]/i);
            return idx !== false ? idx : 0;
          }
          return false;
        },
        message:
          "You have an opening <body> but no closing </body>. Every opening tag needs a matching closing tag.",
        file: "html",
      },
      {
        detect: (current) => {
          if (!/<html[\s>]/i.test(current.html)) {
            return 0;
          }
          return false;
        },
        message:
          "The <html> tag is missing. This is the root element that wraps everything on the page.",
        file: "html",
      },
      {
        detect: (current) => {
          const bodyClose = current.html.indexOf('</body>');
          const htmlClose = current.html.indexOf('</html>');
          if (bodyClose !== -1 && htmlClose !== -1 && bodyClose < htmlClose) {
            const between = current.html.slice(bodyClose + 7, htmlClose); // 7 = length of "</body>"
            if (/<(p|h[1-6]|img|div|ul|ol|li|a)\b/i.test(between)) {
              const contentMatch = between.match(/<(p|h[1-6]|img|div|ul|ol|li|a)\b/i);
              if (contentMatch) {
                const idx = lineIndexOf(current.html.slice(bodyClose), new RegExp(`<${contentMatch[1]}`, 'i'));
                const bodyCloseLine = lineIndexOrZero(current.html, /<\/body>/i);
                return idx !== false ? bodyCloseLine + idx : bodyCloseLine + 1;
              }
            }
          }
          const headClose = current.html.indexOf('</head>');
          const bodyOpen = current.html.indexOf('<body');
          if (headClose !== -1 && bodyOpen !== -1 && headClose < bodyOpen) {
            if (/<(p|h[1-6]|img|div|ul|ol|li|a)\b/i.test(current.html.slice(headClose + 7, bodyOpen))) { // 7 = length of "</head>"
              return lineIndexOrZero(current.html, /<\/head>/i) + 1;
            }
          }
          return false;
        },
        message:
          "This content is outside the <body> tags. Move it between <body> and </body> so it shows up on the page.",
        file: "html",
      },
    ],
    freeFormPrompt: "free_form_change_text",
  },
  explain: {
    content: `<p>When you deleted the <code>&lt;p&gt;</code> line, the text vanished from the preview. Everything inside <code>&lt;body&gt;</code> is what the visitor sees. Remove the content, and there's nothing to show.</p>
<p>When you typed it back with different text, the preview updated instantly. The browser reads your HTML and displays whatever it finds inside the <code>&lt;body&gt;</code>.</p>
<h4>HTML pages are made up of tags like these:</h4>
<ul>
  <li><code>&lt;!DOCTYPE html&gt;</code>: tells the browser "this is an HTML5 document"</li>
  <li><code>&lt;html&gt;</code>: the root element that wraps everything</li>
  <li><code>&lt;head&gt;</code>: the part of the page that holds info ABOUT the site, not stuff people see. The page title, the language, and links to stylesheets all go here. Think of it as the settings area the browser reads before drawing anything.</li>
  <li><code>&lt;body&gt;</code>: everything the visitor actually sees on the page</li>
  <li><code>&lt;h1&gt;</code>: a heading, the biggest, boldest text on the page</li>
  <li><code>&lt;p&gt;</code>: a paragraph of regular text</li>
  <li><code>&lt;img&gt;</code>: an image that uses a <code>src</code> attribute to point to a picture</li>
</ul>`,
    snippets: [],
    learnMoreLinks: [
      {
        label: "MDN: HTML basics",
        url: "https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/HTML_basics",
      },
    ],
  },
  apply: {
    validationStepId: "html_structure",
    instructions: "On the empty line after <code>&lt;/head&gt;</code>, add <code>&lt;body&gt;</code> and <code>&lt;/body&gt;</code>. Then <strong>inside</strong> the body (between <code>&lt;body&gt;</code> and <code>&lt;/body&gt;</code>), add a paragraph like: <code>&lt;p&gt;Hello world!&lt;/p&gt;</code>",
    starterCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>

</html>`,
    },
  },
};

const addContent: TutorialSubStepData = {
  id: "add_content",
  title: "Add Content",
  goal: {
    description:
      "Headings make text bigger and bolder. Here's a page showing different heading sizes alongside regular paragraph text.",
    previewCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Cat Cattington</h1>
    <p>Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
  </body>
</html>`,
    },
  },
  tinker: {
    starterCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Biggest heading</h1>
    <h2>Second biggest</h2>
    <h3>Medium heading</h3>
    <h4>Smaller heading</h4>
    <p>This is a paragraph. It's the basic way to add text to a page.</p>
    <p>You can have as many paragraphs as you want!</p>
  </body>
</html>`,
    },
    showCssEditor: false,
    challenges: [
      {
        id: "change_h1_to_h5",
        prompt:
          "Change the &lt;h1&gt; tag to &lt;h5&gt;. Compare how the sizes change.",
        check: (code) =>
          /<h5[^>]*>.+<\/h5>/is.test(code.html) && !/<h1[^>]*>/i.test(code.html),
      },
      {
        id: "change_p_to_heading",
        prompt: "Change one of the &lt;p&gt; tags into any heading size (&lt;h1&gt; through &lt;h6&gt;).",
        check: (code) => {
          const pTags = code.html.match(/<p[^>]*>[^<]*<\/p>/gi) || [];
          const hTags = code.html.match(/<h[1-6][^>]*>[^<]*<\/h[1-6]>/gi) || [];
          // The starter has 2 <p> and 4 headings, so a 5th heading means a p was converted.
          return pTags.length < 2 && hTags.length >= 5;
        },
      },
    ],
    errors: [
      {
        detect: (current) => {
          const openMatch = current.html.match(/<(h[1-6])[^>]*>/i);
          if (openMatch) {
            const tag = openMatch[1];
            if (!new RegExp(`</${tag}>`, "i").test(current.html)) {
              return lineIndexOrZero(current.html, new RegExp(`<${tag}[\\s>]`, "i"));
            }
          }
          return false;
        },
        message:
          "Your heading tag is missing its closing tag. For example, <h1> needs a matching </h1>.",
        file: "html",
      },
      {
        detect: (current) => {
          if (/<p[^>]*>/i.test(current.html) && !/<\/p>/i.test(current.html)) {
            return lineIndexOrZero(current.html, /<p[^>]*>/i);
          }
          return false;
        },
        message:
          "Your <p> tag is missing its closing </p>. Every paragraph needs both an opening and closing tag.",
        file: "html",
      },
      {
        detect: (current) => {
          const emptyHeading = /<(h[1-6])[^>]*>\s*<\/\1>/i;
          if (emptyHeading.test(current.html)) {
            return lineIndexOrZero(current.html, emptyHeading);
          }
          return false;
        },
        message:
          "Your heading is empty! Put some text between the opening and closing tags, like <h1>Your Name</h1>.",
        file: "html",
      },
    ],
  },
  explain: {
    content: `<p>When you changed <code>&lt;h1&gt;</code> to <code>&lt;h5&gt;</code>, the heading got much smaller. HTML has six heading levels; the number tells the browser how important the heading is:</p>
<div style="background:rgba(0,0,0,0.04);padding:12px 14px;border-radius:6px;font-family:monospace;font-size:0.8rem;line-height:2;border:1px solid rgba(0,0,0,0.08);margin:8px 0;">
<div style="font-size:2em;font-weight:bold;font-family:sans-serif;">&lt;h1&gt;: Biggest</div>
<div style="font-size:1.5em;font-weight:bold;font-family:sans-serif;">&lt;h2&gt;: Second</div>
<div style="font-size:1.17em;font-weight:bold;font-family:sans-serif;">&lt;h3&gt;: Medium</div>
<div style="font-size:1em;font-weight:bold;font-family:sans-serif;">&lt;h4&gt;: Smaller</div>
<div style="font-size:0.83em;font-weight:bold;font-family:sans-serif;">&lt;h5&gt;: Even smaller</div>
<div style="font-size:0.67em;font-weight:bold;font-family:sans-serif;">&lt;h6&gt;: Smallest</div>
</div>
<p>The <code>&lt;p&gt;</code> tag creates paragraphs of text. You can have as many as you want, and each one starts on a new line.</p>
<p>Every tag that wraps text needs both an opening tag (like <code>&lt;h1&gt;</code>) and a closing tag (like <code>&lt;/h1&gt;</code>).</p>`,
    snippets: [],
    learnMoreLinks: [
      {
        label: "MDN: HTML text fundamentals",
        url: "https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/HTML_text_fundamentals",
      },
    ],
  },
  apply: {
    validationStepId: "add_content",
    instructions: "Add an <code>&lt;h1&gt;</code> with your name <strong>inside</strong> <code>&lt;body&gt;</code>, like: <code>&lt;h1&gt;Your Name&lt;/h1&gt;</code>. Then add a <code>&lt;p&gt;</code> about yourself below it.",
  },
};

const addImage: TutorialSubStepData = {
  id: "add_image",
  title: "Add an Image",
  goal: {
    description:
      "Images live in an <code>&lt;img&gt;</code> tag. It's self-closing (no <code>&lt;/img&gt;</code>) and needs two things: <code>src</code> (the URL) and <code>alt</code> (a short description).",
    previewCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Cat Cattington</h1>
    <p>Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
    <img src="https://placecats.com/600/400" alt="A cute cat" width="600" />
  </body>
</html>`,
    },
  },
  tinker: {
    starterCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Cat Cattington</h1>
    <p>Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
    <img src="https://placecats.com/600/400" width="600" />
  </body>
</html>`,
    },
    showCssEditor: false,
    challenges: [
      {
        id: "delete_src",
        prompt:
          'Delete the src="..." part from the &lt;img&gt; tag. What happens to the image?',
        check: (code) => {
          const hasSrcWithValue = /<img[^>]+src\s*=\s*["'][^"']+["']/i.test(code.html);
          return /<img/i.test(code.html) && !hasSrcWithValue;
        },
      },
      {
        id: "add_alt",
        prompt:
          'The image is broken! Add alt to the &lt;img&gt; tag, like: <code>&lt;img alt="A cute cat" /&gt;</code>. This text shows when the image can\'t load.',
        check: (code) => {
          const match = code.html.match(/<img[^>]+alt\s*=\s*["']([^"']+)["']/i);
          if (!match) return false;
          const altText = match[1] || '';
          // = in alt likely means broken attribute quoting
          if (altText.includes('=')) return false;
          if (/^https?:\/\//i.test(altText.trim())) return false;
          return true;
        },
      },
    ],
    errors: [
      attrMisspellingError("src"),
      attrMisspellingError("alt"),
      attrMisspellingError("width"),
      {
        detect: (current) => {
          if (/<\/img>/i.test(current.html)) {
            return lineIndexOrZero(current.html, /<\/img>/i);
          }
          return false;
        },
        message:
          "The <img> tag is self-closing; it doesn't need a </img>. Just use <img src=\"...\" /> with a slash before the >.",
        file: "html",
      },
      {
        detect: (current) => {
          const srcMatch = current.html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
          if (!srcMatch) return false;
          const src = srcMatch[1] || "";
          if (["your-image-url-here", "example.com", "your-image-url", "placeholder", "image-url-here", "your-url-here"].some((p) => src.toLowerCase().includes(p))) {
            return lineIndexOrZero(current.html, /src\s*=\s*["']/i);
          }
          if (src.length > 0 && !src.startsWith("http://") && !src.startsWith("https://")) {
            return lineIndexOrZero(current.html, /src\s*=\s*["']/i);
          }
          const nonImagePatterns = [/google\.com\/?$/, /youtube\.com/, /wikipedia\.org\/?$/, /github\.com\/?$/];
          if (nonImagePatterns.some((p) => p.test(src))) {
            return lineIndexOrZero(current.html, /src\s*=\s*["']/i);
          }
          return false;
        },
        message:
          "That doesn't look like a valid image URL. Right-click an image online, select \"Copy image address\", and paste it as the src value. It should start with https:// and point directly to an image file.",
        file: "html",
      },
      {
        detect: (current) => {
          // "" not preceded by = means broken attribute quoting
          const imgMatch = current.html.match(/<img([^>]*)>/i);
          if (!imgMatch) return false;
          if (/(?<!=)""/.test(imgMatch[1] || "")) {
            return lineIndexOrZero(current.html, /<img/i);
          }
          return false;
        },
        message:
          'Your quotes are mismatched. Each attribute needs its own pair of quotes: alt="description" src="url". Make sure you close one attribute\'s quotes before starting another.',
        file: "html",
      },
    ],
    freeFormPrompt: "free_form_image",
    freeFormCheck: (code) => {
      const srcMatch = code.html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (!srcMatch) return false;
      const src = srcMatch[1] || '';
      // Must be a real URL, not a placeholder
      return src.startsWith('http') && src.length > 15;
    },
  },
  explain: {
    content: `<p>When you deleted the <code>src</code> attribute, the image disappeared; the browser had no address to fetch. But the <code>alt</code> text showed up in its place, letting visitors know what was supposed to be there.</p>
<p>When you added a new URL, the image came back. The <code>src</code> is the address of the image file, and <code>alt</code> is the backup description.</p>
<h4>How the &lt;img&gt; tag works</h4>
<ul>
  <li><code>src</code>: the URL (address) of the image file</li>
  <li><code>alt</code>: text shown if the image can't load, and read by screen readers for accessibility</li>
  <li><code>&lt;img&gt;</code> is <strong>self-closing</strong>: it doesn't wrap around content like <code>&lt;p&gt;...&lt;/p&gt;</code></li>
</ul>`,
    snippets: [],
    learnMoreLinks: [
      {
        label: "MDN: Images in HTML",
        url: "https://developer.mozilla.org/en-US/docs/Learn/HTML/Multimedia_and_embedding/Images_in_HTML",
      },
    ],
  },
  apply: {
    validationStepId: "add_image",
    instructions: "Add an <code>&lt;img src=\"...\" /&gt;</code> tag between <code>&lt;body&gt;</code> and <code>&lt;/body&gt;</code>. Use a real image URL. Right-click any image online and copy its address.",
  },
};

const _explore: TutorialSubStepData = {
  id: "explore",
  title: "Explore & Experiment",
  goal: {
    description:
      "You've learned the basics of HTML: headings, paragraphs, and images. Now take 5 minutes to play around! Try adding new elements, changing text, or breaking things on purpose. There's no wrong answer here. Below are some resources to inspire you.",
    previewCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Portfolio</title>
  </head>
  <body>
    <h1>My Portfolio</h1>
    <p>Welcome to my site! Here are some things I've been working on.</p>
    <h2>About Me</h2>
    <p>I'm learning to code and building cool stuff.</p>
    <a href="https://hackclub.com">Check out Hack Club</a>
    <h2>My Favorite Things</h2>
    <ul>
      <li>Building websites</li>
      <li>Playing games</li>
      <li>Learning new things</li>
    </ul>
    <img src="https://placecats.com/300/200" alt="A cute cat" width="300">
  </body>
</html>`,
    },
  },
  tinker: {
    starterCode: { html: "", css: "" },
    showCssEditor: false,
    challenges: [],
    errors: [],
  },
  explain: {
    content: "",
    snippets: [],
    learnMoreLinks: [],
  },
  apply: {
    validationStepId: "explore",
    instructions: "",
  },
};

const addTailwind: TutorialSubStepData = {
  id: "add_tailwind",
  title: "Add Tailwind",
  goal: {
    description:
      "HTML sets what's on the page. CSS sets how it looks, but it's a whole separate language. Normally you'd write rules in their own file, like <code>h1 { color: blue; }</code>, then link that file to your HTML so the browser knows which rules go with which tags. That's a lot more moving parts than we can fit here, so we're going to skip CSS for now (<a href=\"https://developer.mozilla.org/en-US/docs/Web/CSS\" target=\"_blank\" rel=\"noopener noreferrer\">MDN's CSS guide</a> is a great place to learn it properly later). Instead we'll use Tailwind: a one-line script that lets you style elements by dropping ready-made labels like <code>class=\"text-blue-500\"</code> straight on the tag, no separate rules needed.",
    previewCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <h1 class="text-blue-500">Cat Cattington</h1>
    <p>Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
    <img src="https://placecats.com/600/400" alt="A cute cat" />
  </body>
</html>`,
    },
  },
  tinker: {
    starterCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
  </head>
  <body>
    <h1>Cat Cattington</h1>
    <p>Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
    <img src="https://placecats.com/600/400" alt="A cute cat" />
  </body>
</html>`,
    },
    showCssEditor: false,
    challenges: [
      {
        id: "add_tailwind_script",
        prompt:
          "Add the Tailwind loader inside the &lt;head&gt;: <code>&lt;script src=\"https://cdn.tailwindcss.com\"&gt;&lt;/script&gt;</code>",
        check: (code) =>
          /<script[^>]+src\s*=\s*["']https:\/\/cdn\.tailwindcss\.com\/?["'][^>]*>\s*<\/script>/i.test(code.html),
      },
      {
        id: "color_the_heading",
        prompt:
          "Tailwind is loaded. Now add <code>class=\"text-blue-500\"</code> to the &lt;h1&gt; and watch the heading turn blue.",
        check: (code) =>
          /<h1[^>]*class\s*=\s*["'][^"']*\btext-blue-500\b/i.test(code.html),
      },
    ],
    errors: [
      attrMisspellingError("src"),
      attrMisspellingError("class"),
      attrMisspellingError("type"),
      {
        detect: (current) => {
          if (/<link[^>]+rel\s*=\s*["']stylesheet["']/i.test(current.html)) {
            return lineIndexOrZero(current.html, /<link[^>]+rel\s*=\s*["']stylesheet["']/i);
          }
          return false;
        },
        message:
          "You don't need a <link rel=\"stylesheet\"> for Tailwind. Just the <script src=\"https://cdn.tailwindcss.com\"> tag in <head> is enough.",
        file: "html",
      },
      {
        detect: (current) => {
          const wrongCdn = current.html.match(
            /<script[^>]+src\s*=\s*["'](https:\/\/[^"']*tailwind[^"']*)["']/i,
          );
          if (
            wrongCdn &&
            !/^https:\/\/cdn\.tailwindcss\.com\/?$/i.test(wrongCdn[1] || "")
          ) {
            return lineIndexOrZero(current.html, /<script[^>]+src/i);
          }
          return false;
        },
        message:
          "The Tailwind CDN URL should be exactly https://cdn.tailwindcss.com. Double check for typos.",
        file: "html",
      },
      {
        detect: (current) => {
          const code = current.html;
          const scriptMatch = code.match(
            /<script[^>]+src\s*=\s*["']https:\/\/cdn\.tailwindcss\.com\/?["'][^>]*>/i,
          );
          if (!scriptMatch) return false;
          const scriptIdx = code.indexOf(scriptMatch[0]);
          const headOpenMatch = code.match(/<head[\s>]/i);
          const headClose = code.toLowerCase().indexOf("</head>");
          if (!headOpenMatch || headClose === -1) return false;
          if (scriptIdx >= code.indexOf(headOpenMatch[0]) && scriptIdx <= headClose) return false;
          return lineIndexOrZero(code, /<script[^>]+tailwindcss/i);
        },
        message:
          "The Tailwind <script> needs to live INSIDE <head>...</head>. Move the tag up so it sits between <head> and </head>.",
        file: "html",
      },
    ],
    freeFormPrompt: "free_form_tailwind_color",
    freeFormCheck: (code) => /<h1[^>]*class\s*=\s*["'][^"']*text-(red|green|yellow|purple|pink|orange)-\d+/i.test(code.html),
  },
  explain: {
    content: `<h4>The &lt;script&gt; tag</h4>
<p>The <code>&lt;script src="https://cdn.tailwindcss.com"&gt;</code> line loads the Tailwind Play CDN, a small JavaScript library. Once loaded, it watches your HTML for class names and generates the matching CSS on the fly, so styles show up instantly without you writing a stylesheet.</p>
<h4>What Tailwind replaces</h4>
<p>Normally, to style an element you'd create a <code>style.css</code> file, link it with <code>&lt;link&gt;</code>, and write rules like <code>h1 { color: blue; }</code>. Tailwind replaces all of that. Each class is a pre-made rule, and you apply it directly on the element with <code>class="..."</code>. No separate file, no &lt;link&gt;, no selectors.</p>
<h4>The class you just used</h4>
<ul>
  <li><code>text-blue-500</code> is <code>color: #3b82f6;</code>: that's the blue you see on the heading.</li>
</ul>
<p>You'll stack a few more of these in the next step.</p>`,
    snippets: [],
    learnMoreLinks: [
      {
        label: "Tailwind utility classes cheat sheet",
        url: "https://tailwindcss.com/docs/styling-with-utility-classes",
      },
    ],
  },
  apply: {
    validationStepId: "add_tailwind",
    instructions:
      "Inside <code>&lt;head&gt;</code>, add <code>&lt;script src=\"https://cdn.tailwindcss.com\"&gt;&lt;/script&gt;</code>. Then give one of your elements a Tailwind class, like <code>class=\"text-blue-500\"</code> on the <code>&lt;h1&gt;</code>.",
  },
};

const styleWithTailwind: TutorialSubStepData = {
  id: "style_with_tailwind",
  title: "Style with Tailwind",
  goal: {
    description:
      "Stack multiple Tailwind labels in one <code>class=\"...\"</code>, separated by spaces, to style an element several ways at once. Here's what a styled version looks like.",
    previewCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="text-center p-10 bg-pink-100 font-sans">
    <h1 class="text-4xl font-bold text-gray-800 tracking-wide">Cat Cattington</h1>
    <p class="text-gray-700 mt-4">Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
    <img src="https://placecats.com/600/400" alt="A cute cat" width="600" class="mx-auto mt-6 rounded-lg shadow-lg w-64">
  </body>
</html>`,
    },
  },
  tinker: {
    starterCode: {
      html: `<!DOCTYPE html>
<html>
  <head>
    <title>My Page</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <h1 class="text-blue-500">Cat Cattington</h1>
    <p>Welcome to my website! I love catnaps, cattitude, and catamarans.</p>
    <img src="https://placecats.com/600/400" alt="A cute cat" width="600">
  </body>
</html>`,
    },
    showCssEditor: false,
    challenges: [
      // Deliberately only two classes here so the learner isn't overwhelmed.
      {
        id: "center_text",
        prompt:
          "Start by adding <code>class=\"text-center\"</code> to the <code>&lt;body&gt;</code> tag. Watch the text jump to the center of the page.",
        check: (code) => {
          const bodyMatch = code.html.match(/<body[^>]*class\s*=\s*["']([^"']+)["']/i);
          if (!bodyMatch) return false;
          return (bodyMatch[1] || "").split(/\s+/).includes("text-center");
        },
      },
      {
        id: "pink_background",
        prompt:
          "Now add <code>bg-pink-100</code> to the same <code>class</code> on the <code>&lt;body&gt;</code>. Keep the existing <code>text-center</code>, just append the new class with a space: <code>class=\"text-center bg-pink-100\"</code>.",
        check: (code) => {
          const bodyMatch = code.html.match(/<body[^>]*class\s*=\s*["']([^"']+)["']/i);
          if (!bodyMatch) return false;
          const classes = (bodyMatch[1] || "").split(/\s+/);
          return classes.includes("text-center") && classes.includes("bg-pink-100");
        },
      },
      {
        id: "shrink_image",
        prompt:
          "That cat is huge. Add a <code>class=\"w-64\"</code> to the <code>&lt;img&gt;</code> so Tailwind shrinks it. The <code>width=\"600\"</code> attribute sets the default, and your Tailwind label overrides it.",
        check: (code) => {
          const imgMatch = code.html.match(/<img[^>]*class\s*=\s*["']([^"']+)["']/i);
          if (!imgMatch) return false;
          return /\bw-\d+\b/.test(imgMatch[1] || "");
        },
      },
    ],
    errors: [
      attrMisspellingError("class"),
      attrMisspellingError("src"),
      attrMisspellingError("alt"),
      {
        detect: (current) => {
          if (current.html.match(/<(h[1-6]|p|body|img|div)[^>]*\sstyle\s*=\s*["'][^"']*["']/i)) {
            return lineIndexOrZero(current.html, /\sstyle\s*=/i);
          }
          return false;
        },
        message:
          "You don't need style=\"...\" anymore. Use a Tailwind class on the element instead, like class=\"text-red-500\".",
        file: "html",
      },
      {
        detect: (current) => {
          if (
            !/<script[^>]+src\s*=\s*["']https:\/\/cdn\.tailwindcss\.com\/?["'][^>]*>/i.test(
              current.html,
            )
          ) {
            return lineIndexOrZero(current.html, /<head[\s>]/i);
          }
          return false;
        },
        message:
          "The Tailwind <script> tag is gone. Add it back inside <head> or your classes will not do anything.",
        file: "html",
      },
      {
        detect: (current) => {
          // Repeated here in case the student moves the script while restyling.
          const code = current.html;
          const scriptMatch = code.match(
            /<script[^>]+src\s*=\s*["']https:\/\/cdn\.tailwindcss\.com\/?["'][^>]*>/i,
          );
          if (!scriptMatch) return false;
          const scriptIdx = code.indexOf(scriptMatch[0]);
          const headOpenMatch = code.match(/<head[\s>]/i);
          const headClose = code.toLowerCase().indexOf("</head>");
          if (!headOpenMatch || headClose === -1) return false;
          if (scriptIdx >= code.indexOf(headOpenMatch[0]) && scriptIdx <= headClose) return false;
          return lineIndexOrZero(code, /<script[^>]+tailwindcss/i);
        },
        message:
          "The Tailwind <script> needs to live INSIDE <head>...</head>. Move the tag up so it sits between <head> and </head>.",
        file: "html",
      },
    ],
    freeFormPrompt: "free_form_tailwind_color_more",
    freeFormCheck: (code) => {
      return (code.html.match(/class\s*=\s*["'][^"']+["']/gi) || []).length >= 2;
    },
  },
  explain: {
    content: `<p>You stacked two Tailwind classes on the <code>&lt;body&gt;</code> at once. Each class is a standalone shortcut for a single CSS rule, and Tailwind merges them without conflict: <code>class="text-center bg-pink-100"</code> gives you centered text AND a pink background, with no stylesheet in sight.</p>
<h4>The classes you just used</h4>
<ul>
  <li><code>text-center</code> is <code>text-align: center;</code></li>
  <li><code>bg-pink-100</code> is <code>background-color: #fce7f3;</code></li>
</ul>
<h4>A few more to try</h4>
<p>A short reference of classes in the same three families (background, text color, text style). The size ramp goes <code>sm</code> &rarr; <code>base</code> &rarr; <code>lg</code> and keeps going up through <code>xl</code>, <code>2xl</code>, all the way to <code>9xl</code>.</p>
<ul>
  <li><code>text-sm</code> / <code>text-base</code> / <code>text-lg</code>: small, default, large text</li>
  <li><code>text-left</code> / <code>text-center</code> / <code>text-right</code>: text alignment</li>
  <li><code>font-bold</code>: bold text</li>
  <li><code>italic</code>: italic text</li>
  <li><code>underline</code>: underlined text</li>
  <li><code>uppercase</code>: ALL CAPS text</li>
  <li><code>text-blue-500</code> / <code>text-gray-800</code>: text color (pick any color + shade)</li>
  <li><code>bg-pink-100</code> / <code>bg-gray-900</code>: background color (same idea)</li>
</ul>
<p>When you want more classes, add them to the same <code>class=""</code> with spaces in between. Try a few of these on your own site in the next phase.</p>`,
    snippets: [],
    learnMoreLinks: [
      {
        label: "Tailwind colors",
        url: "https://tailwindcss.com/docs/colors",
      },
      {
        label: "Tailwind font size",
        url: "https://tailwindcss.com/docs/font-size",
      },
      {
        label: "Tailwind font weight",
        url: "https://tailwindcss.com/docs/font-weight",
      },
    ],
  },
  apply: {
    validationStepId: "style_with_tailwind",
    instructions:
      "This is your site. Add Tailwind classes to at least two different elements. Mix and match anything from the reference: text sizes, alignment, text colors, background colors, font weights. The goal is to make the page look the way you want. Full reference: <a href=\"https://tailwindcss.com/docs/styling-with-utility-classes\" target=\"_blank\" rel=\"noopener\" class=\"underline\">tailwindcss.com docs</a>.",
  },
};

const readme: TutorialSubStepData = {
  id: "readme",
  title: "Write a README",
  goal: {
    description:
      "A README is a short file that tells people what your project is. It's written in Markdown, a plain-text format with a couple of simple symbols for formatting.",
    previewCode: {
      html: "",
      readme: "# My Portfolio\n\nA personal website I built during the Hack Club tutorial.\n\n- Learned **HTML** and **CSS**\n- Added my own photo and bio",
    },
  },
  tinker: {
    starterCode: {
      html: "",
      readme: "",
    },
    showCssEditor: false,
    // Empty, so TutorialStep's onGoalReady jumps straight to explain.
    challenges: [],
    errors: [],
  },
  explain: {
    content: `<p>Markdown is just plain text with a few symbols that the renderer turns into formatting. Here are the ones you need:</p>
<ul>
  <li><code>#</code> at the start of a line makes a big heading. <code>##</code> is smaller, <code>###</code> smaller still.</li>
  <li><code>**bold**</code> wraps text in asterisks to make it <strong>bold</strong>.</li>
  <li><code>- item</code> at the start of a line makes a bullet point.</li>
  <li>Blank lines separate paragraphs.</li>
</ul>
<p>That's the whole syntax you need for a first README. Next up, write one for your site.</p>`,
    snippets: [],
    learnMoreLinks: [
      {
        label: "Markdown Guide: Basic Syntax",
        url: "https://www.markdownguide.org/basic-syntax/",
      },
      {
        label: "GitHub: About READMEs",
        url: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes",
      },
    ],
  },
  apply: {
    validationStepId: "readme",
    instructions: "Write a short README for your site. Include a <code>#</code> heading on the first line, then a sentence or two below it. A bullet list with <code>-</code> is optional. Click Next when you're done.",
  },
};

export const tutorialSteps: TutorialSubStepData[] = [
  htmlStructure,
  addContent,
  addImage,
  addTailwind,
  styleWithTailwind,
  readme,
];

export default tutorialSteps;
