<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { highlightCodeHtml, readThemeMode } from "../utils/codeHighlight";
import { parseInlineFileReference } from "../utils/fileReferences";

const props = defineProps<{
  content: string;
  deferMermaidErrors?: boolean;
}>();

const emit = defineEmits<{
  openFileReference: [payload: { path: string; lineNumber: number }];
}>();

type MermaidModule = typeof import("mermaid").default;

type CodeBlockSource = {
  text: string;
  lang: string;
};

type RenderedMarkdown = {
  html: string;
  mermaidSources: string[];
  codeBlocks: CodeBlockSource[];
};

const MERMAID_SELECTOR = "[data-mermaid-index]";
const CODE_BLOCK_SELECTOR = "[data-code-index]";
const MERMAID_MIN_WIDTH = 420;
const MERMAID_MAX_WIDTH = 900;
const MERMAID_MIN_ZOOM = 0.5;
const MERMAID_MAX_ZOOM = 2.5;
const MERMAID_ZOOM_STEP = 0.25;
const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

let mermaidPromise: Promise<MermaidModule> | null = null;
let renderVersion = 0;
let codeRenderVersion = 0;
let themeObserver: MutationObserver | undefined;
const rendererId = Math.random().toString(36).slice(2);
const markdownBody = ref<HTMLDivElement | null>(null);

// Configure marked once
marked.setOptions({
  gfm: true,
  breaks: true,
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPE[char] ?? char);
}

function languageName(lang?: string): string {
  return (lang ?? "").trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

function mermaidPlaceholder(index: number, source: string): string {
  return `<div class="mermaid-block" data-mermaid-index="${index}"><div class="mermaid-block-status" aria-live="polite">Rendering diagram...</div><pre class="mermaid-source"><code>${escapeHtml(source)}</code></pre></div>`;
}

function codeBlockPlaceholder(
  index: number,
  source: string,
  lang: string,
): string {
  const className = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<div class="markdown-code-block" data-code-index="${index}" aria-live="polite"><pre><code${className}>${escapeHtml(source)}</code></pre></div>`;
}

function fileReferenceLink(label: string, path: string, lineNumber: number): string {
  return `<a class="markdown-file-ref" href="#" data-file-path="${escapeHtml(path)}" data-file-line="${lineNumber}" title="Open ${escapeHtml(path)} at line ${lineNumber}"><code>${escapeHtml(label)}</code></a>`;
}

function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "em",
      "strong",
      "del",
      "ins",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
      "details",
      "summary",
      "sup",
      "sub",
      "div",
      "span",
    ],
    ALLOWED_ATTR: [
      "href",
      "target",
      "rel",
      "alt",
      "src",
      "title",
      "class",
      "data-mermaid-index",
      "data-code-index",
      "data-file-path",
      "data-file-line",
      "aria-live",
    ],
  });
}

function renderMarkdown(raw: string): RenderedMarkdown {
  if (!raw) return { html: "", mermaidSources: [], codeBlocks: [] };

  const mermaidSources: string[] = [];
  const codeBlocks: CodeBlockSource[] = [];
  const renderer = new marked.Renderer();

  renderer.code = token => {
    const lang = languageName(token.lang);
    if (lang === "mermaid") {
      const index = mermaidSources.push(token.text) - 1;
      return mermaidPlaceholder(index, token.text);
    }

    const index = codeBlocks.push({ text: token.text, lang }) - 1;
    return codeBlockPlaceholder(index, token.text, lang);
  };

  renderer.codespan = token => {
    const fileReference = parseInlineFileReference(token.text);
    if (!fileReference) {
      return `<code>${escapeHtml(token.text)}</code>`;
    }

    return fileReferenceLink(
      token.text,
      fileReference.path,
      fileReference.lineNumber,
    );
  };

  const html = marked.parse(raw, {
    renderer,
    gfm: true,
    breaks: true,
  }) as string;
  return {
    html: sanitizeMarkdownHtml(html),
    mermaidSources,
    codeBlocks,
  };
}

function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import("mermaid").then(module => module.default);
  return mermaidPromise;
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback;
}

function configureMermaid(mermaid: MermaidModule) {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const styles = getComputedStyle(shell ?? document.documentElement);
  const isDark = shell?.dataset.theme !== "light";

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
    },
    themeVariables: {
      darkMode: isDark,
      background: cssVar(styles, "--panel", isDark ? "#161b22" : "#ffffff"),
      mainBkg: cssVar(styles, "--panel-2", isDark ? "#21262d" : "#f6f8fa"),
      primaryColor: cssVar(styles, "--panel-2", isDark ? "#21262d" : "#f6f8fa"),
      primaryTextColor: cssVar(
        styles,
        "--text",
        isDark ? "#e6edf3" : "#1f2328",
      ),
      primaryBorderColor: cssVar(
        styles,
        "--border-strong",
        isDark ? "#484f58" : "#afb8c1",
      ),
      lineColor: cssVar(
        styles,
        "--text-subtle",
        isDark ? "#7d8590" : "#6e7781",
      ),
      textColor: cssVar(styles, "--text", isDark ? "#e6edf3" : "#1f2328"),
      fontFamily: cssVar(styles, "--pi-font-sans", "system-ui, sans-serif"),
    },
  });
}

function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    ADD_ATTR: ["class", "style"],
  });
}

function numericSvgLength(value: string | null): number | null {
  const match = value?.trim().match(/^[0-9.]+/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function svgViewBoxWidth(svg: SVGSVGElement): number | null {
  const values = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = values?.[2];
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? width
    : null;
}

function clampMermaidZoom(value: number): number {
  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, value));
}

function readMermaidZoom(block: HTMLElement): number {
  const zoom = Number(block.dataset.mermaidZoom);
  return Number.isFinite(zoom) ? clampMermaidZoom(zoom) : 1;
}

function mermaidZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

function updateMermaidZoom(block: HTMLElement, zoom: number) {
  const nextZoom = clampMermaidZoom(zoom);
  const baseWidth = Number(block.dataset.mermaidBaseWidth);
  const svg = block.querySelector<SVGSVGElement>("svg");

  block.dataset.mermaidZoom = String(nextZoom);
  if (svg && Number.isFinite(baseWidth) && baseWidth > 0) {
    svg.style.width = `${Math.round(baseWidth * nextZoom)}px`;
    svg.style.maxWidth = nextZoom > 1 ? "none" : "100%";
  }

  const label = block.querySelector<HTMLElement>("[data-mermaid-zoom-label]");
  if (label) label.textContent = mermaidZoomLabel(nextZoom);

  const zoomOut = block.querySelector<HTMLButtonElement>(
    '[data-mermaid-zoom-action="out"]',
  );
  const zoomIn = block.querySelector<HTMLButtonElement>(
    '[data-mermaid-zoom-action="in"]',
  );
  const reset = block.querySelector<HTMLButtonElement>(
    '[data-mermaid-zoom-action="reset"]',
  );
  if (zoomOut) zoomOut.disabled = nextZoom <= MERMAID_MIN_ZOOM;
  if (zoomIn) zoomIn.disabled = nextZoom >= MERMAID_MAX_ZOOM;
  if (reset) reset.disabled = nextZoom === 1;
}

function mermaidZoomButton(action: string, label: string, title: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-zoom-button";
  button.dataset.mermaidZoomAction = action;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = label;
  return button;
}

function addMermaidZoomControls(block: HTMLElement) {
  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-block-toolbar";

  const label = document.createElement("span");
  label.className = "mermaid-zoom-label";
  label.dataset.mermaidZoomLabel = "true";

  toolbar.append(
    mermaidZoomButton("out", "-", "Zoom out"),
    label,
    mermaidZoomButton("in", "+", "Zoom in"),
    mermaidZoomButton("reset", "Reset zoom", "Reset zoom"),
  );
  toolbar.addEventListener("click", event => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>(
            "button[data-mermaid-zoom-action]",
          )
        : null;
    if (!target) return;

    const currentZoom = readMermaidZoom(block);
    if (target.dataset.mermaidZoomAction === "out") {
      updateMermaidZoom(block, currentZoom - MERMAID_ZOOM_STEP);
    } else if (target.dataset.mermaidZoomAction === "in") {
      updateMermaidZoom(block, currentZoom + MERMAID_ZOOM_STEP);
    } else {
      updateMermaidZoom(block, 1);
    }
  });

  block.prepend(toolbar);
  updateMermaidZoom(block, readMermaidZoom(block));
}

function wrapMermaidDiagram(block: HTMLElement) {
  const scrollContainer = document.createElement("div");
  scrollContainer.className = "mermaid-diagram-scroll";
  scrollContainer.append(...block.childNodes);
  block.replaceChildren(scrollContainer);
}

function fitMermaidSvg(block: HTMLElement) {
  const svg = block.querySelector<SVGSVGElement>("svg");
  const intrinsicWidth = svg
    ? (svgViewBoxWidth(svg) ?? numericSvgLength(svg.getAttribute("width")))
    : null;
  if (!intrinsicWidth) return;

  const displayWidth = Math.min(
    MERMAID_MAX_WIDTH,
    Math.max(MERMAID_MIN_WIDTH, intrinsicWidth),
  );
  block.dataset.mermaidBaseWidth = String(displayWidth);
  updateMermaidZoom(block, readMermaidZoom(block));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replaceWithMermaidSource(
  block: HTMLElement,
  source: string,
  statusText: string,
) {
  const status = document.createElement("div");
  status.className = "mermaid-block-status";
  status.textContent = statusText;

  const code = document.createElement("code");
  code.textContent = source;
  const pre = document.createElement("pre");
  pre.className = "mermaid-source";
  pre.append(code);

  delete block.dataset.mermaidBaseWidth;
  delete block.dataset.mermaidZoom;
  block.classList.remove("mermaid-block-rendered");
  block.replaceChildren(status, pre);
}

function showMermaidDeferred(block: HTMLElement) {
  const status = block.querySelector<HTMLElement>(".mermaid-block-status");
  if (status) status.textContent = "Waiting for complete Mermaid diagram...";
  block.classList.remove("mermaid-block-error", "mermaid-block-rendered");
}

function showMermaidError(block: HTMLElement, source: string, error: unknown) {
  block.classList.add("mermaid-block-error");
  replaceWithMermaidSource(
    block,
    source,
    `Could not render Mermaid diagram: ${errorText(error)}`,
  );
}

async function renderCodeBlocks() {
  const version = ++codeRenderVersion;
  const sources = renderedMarkdown.value.codeBlocks;
  if (sources.length === 0) return;

  ensureThemeObserver();
  await nextTick();

  const root = markdownBody.value;
  if (version !== codeRenderVersion || !root) return;

  const blocks = [...root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)];
  for (const block of blocks) {
    const index = Number(block.dataset.codeIndex);
    const source = Number.isInteger(index) ? sources[index] : undefined;
    if (!source) continue;

    try {
      const html = await highlightCodeHtml(
        source.text,
        source.lang,
        readThemeMode(),
      );
      if (version !== codeRenderVersion) return;
      block.innerHTML = html;
      block.classList.add("markdown-code-block-rendered");
    } catch {
      if (version !== codeRenderVersion) return;
      block.classList.add("markdown-code-block-error");
    }
  }
}

async function renderMermaidBlocks() {
  const version = ++renderVersion;
  const root = markdownBody.value;
  const sources = renderedMarkdown.value.mermaidSources;
  if (!root || sources.length === 0) return;

  if (props.deferMermaidErrors) {
    for (const block of root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)) {
      showMermaidDeferred(block);
    }
    return;
  }

  ensureThemeObserver();
  await nextTick();

  const mermaid = await loadMermaid();
  if (version !== renderVersion || !markdownBody.value) return;
  configureMermaid(mermaid);

  const blocks = [
    ...markdownBody.value.querySelectorAll<HTMLElement>(MERMAID_SELECTOR),
  ];
  for (const block of blocks) {
    const index = Number(block.dataset.mermaidIndex);
    const source = Number.isInteger(index) ? sources[index] : undefined;
    if (!source) continue;

    try {
      const result = await mermaid.render(
        `markdown-mermaid-${rendererId}-${version}-${index}`,
        source,
      );
      if (version !== renderVersion) return;

      block.innerHTML = sanitizeMermaidSvg(result.svg);
      wrapMermaidDiagram(block);
      fitMermaidSvg(block);
      addMermaidZoomControls(block);
      block.classList.add("mermaid-block-rendered");
      block.classList.remove("mermaid-block-error");
      result.bindFunctions?.(block);
    } catch (error) {
      if (version !== renderVersion) return;
      showMermaidError(block, source, error);
    }
  }
}

function ensureThemeObserver() {
  if (themeObserver) return;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  themeObserver = new MutationObserver(() => {
    const current = renderedMarkdown.value;
    if (current.mermaidSources.length > 0) void renderMermaidBlocks();
    if (current.codeBlocks.length > 0) void renderCodeBlocks();
  });
  themeObserver.observe(shell, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

function handleClick(event: MouseEvent) {
  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>(
          "a[data-file-path][data-file-line]",
        )
      : null;
  if (!target) {
    return;
  }

  event.preventDefault();
  const path = target.dataset.filePath?.trim();
  const lineNumber = Number.parseInt(target.dataset.fileLine ?? "", 10);
  if (!path || !Number.isInteger(lineNumber) || lineNumber < 1) {
    return;
  }

  emit("openFileReference", { path, lineNumber });
}

const renderedMarkdown = computed(() => renderMarkdown(props.content));

onMounted(() => {
  void renderMermaidBlocks();
  void renderCodeBlocks();
});

onBeforeUnmount(() => {
  renderVersion++;
  codeRenderVersion++;
  themeObserver?.disconnect();
});

watch(
  [renderedMarkdown, () => props.deferMermaidErrors],
  () => {
    void renderMermaidBlocks();
    void renderCodeBlocks();
  },
  { flush: "post" },
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div
    ref="markdownBody"
    class="markdown-body"
    v-html="renderedMarkdown.html"
    @click="handleClick"
  ></div>
</template>

<style>
.markdown-body {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}

.markdown-body > *:first-child {
  margin-top: 0;
}

.markdown-body > *:last-child {
  margin-bottom: 0;
}

.markdown-body p {
  margin: 0.4em 0;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 1.2em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
}

.markdown-body h1 {
  font-size: 1.4em;
}
.markdown-body h2 {
  font-size: 1.25em;
}
.markdown-body h3 {
  font-size: 1.1em;
}
.markdown-body h4 {
  font-size: 1em;
}

.markdown-body ul,
.markdown-body ol {
  margin: 0.5em 0;
  padding-left: 1.6em;
}

.markdown-body li {
  margin: 0.2em 0;
}

.markdown-body li > p {
  margin: 0.3em 0;
}

.markdown-body blockquote {
  margin: 0.6em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
  background: var(--panel);
  border-radius: 0 6px 6px 0;
}

.markdown-body blockquote p {
  margin: 0.2em 0;
}

.markdown-body code {
  font-family: var(--pi-font-mono);
  font-size: 0.85em;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background: var(--panel-2);
  color: var(--text);
}

.markdown-body a.markdown-file-ref {
  color: inherit;
  text-decoration: none;
}

.markdown-body a.markdown-file-ref code {
  color: color-mix(in srgb, var(--accent-hover) 80%, var(--text));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  background: color-mix(in srgb, var(--surface-active) 64%, var(--panel-2));
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    color 0.12s ease,
    background 0.12s ease;
}

.markdown-body a.markdown-file-ref:hover code,
.markdown-body a.markdown-file-ref:focus-visible code {
  color: var(--accent-hover);
  border-color: color-mix(in srgb, var(--accent) 52%, var(--border-strong));
  background: color-mix(in srgb, var(--surface-active) 88%, var(--panel-2));
}

.markdown-body a.markdown-file-ref:focus-visible {
  outline: none;
}

.markdown-body pre {
  margin: 0.6em 0;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  overflow-x: auto;
  line-height: 1.5;
}

.markdown-body pre code {
  display: block;
  padding: 0;
  border-radius: 0;
  background: none;
  font-size: 0.82rem;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}

.markdown-body .mermaid-block {
  margin: 0.7em 0;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  overflow: hidden;
}

.markdown-body .mermaid-block-rendered {
  text-align: center;
}

.markdown-body .mermaid-block-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin: 0 0 10px;
}

.markdown-body .mermaid-zoom-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel-2) 82%, transparent);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.68rem;
  line-height: 1;
  cursor: pointer;
}

.markdown-body .mermaid-zoom-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}

.markdown-body .mermaid-zoom-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.markdown-body .mermaid-zoom-label {
  min-width: 42px;
  color: var(--text-subtle);
  font-size: 0.68rem;
  line-height: 1;
  text-align: center;
}

.markdown-body .mermaid-diagram-scroll {
  overflow-x: auto;
  overflow-y: hidden;
}

.markdown-body .mermaid-block svg {
  display: block;
  width: min(100%, var(--mermaid-svg-width, 760px));
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

.markdown-body .mermaid-block-status {
  margin-bottom: 10px;
  color: var(--text-subtle);
  font-size: 0.76rem;
}

.markdown-body .mermaid-source {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.markdown-body .mermaid-block-rendered .mermaid-block-status,
.markdown-body .mermaid-block-rendered .mermaid-source {
  display: none;
}

.markdown-body .mermaid-block-error {
  border-color: color-mix(in srgb, var(--error-border) 72%, var(--border));
}

.markdown-body a {
  color: var(--text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body a:hover {
  color: var(--text);
}

.markdown-body hr {
  margin: 1.2em 0;
  border: none;
  border-top: 1px solid var(--border);
}

.markdown-body table {
  margin: 0.6em 0;
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85em;
}

.markdown-body th,
.markdown-body td {
  padding: 8px 12px;
  border: 1px solid var(--border);
  text-align: left;
}

.markdown-body th {
  background: var(--panel);
  font-weight: 600;
  color: var(--text);
}

.markdown-body img {
  max-width: 100%;
  border-radius: 6px;
}

.markdown-body strong {
  font-weight: 600;
  color: var(--text);
}

.markdown-body em {
  font-style: italic;
}

.markdown-body del {
  text-decoration: line-through;
  color: var(--text-subtle);
}

.markdown-body details {
  margin: 0.5em 0;
}

.markdown-body summary {
  cursor: pointer;
  font-size: 0.85em;
  color: var(--text-muted);
}
</style>
