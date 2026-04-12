<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";

const props = defineProps<{
	content: string;
}>();

// Configure marked once
marked.setOptions({
	gfm: true,
	breaks: true,
});

const renderedHtml = computed(() => {
	const raw = props.content;
	if (!raw) return "";
	const html = marked.parse(raw) as string;
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: [
			"h1", "h2", "h3", "h4", "h5", "h6",
			"p", "br", "hr",
			"ul", "ol", "li",
			"blockquote",
			"pre", "code",
			"em", "strong", "del", "ins",
			"a",
			"table", "thead", "tbody", "tr", "th", "td",
			"img",
			"details", "summary",
			"sup", "sub",
		],
		ALLOWED_ATTR: ["href", "target", "rel", "alt", "src", "title", "class"],
	});
});
</script>

<template>
	<!-- eslint-disable-next-line vue/no-v-html -->
	<div class="markdown-body" v-html="renderedHtml"></div>
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

.markdown-body h1 { font-size: 1.4em; }
.markdown-body h2 { font-size: 1.25em; }
.markdown-body h3 { font-size: 1.1em; }
.markdown-body h4 { font-size: 1em; }

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
	font-family: "SF Mono", "Monaco", "Menlo", "Consolas", monospace;
	font-size: 0.85em;
	padding: 0.15em 0.4em;
	border-radius: 4px;
	background: var(--panel-2);
	color: var(--text);
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
