/**
 * Minimal Markdown renderer covering only what lore pages need (see wiki/SCHEMA.md): headings,
 * paragraphs, bold/italic, inline code, fenced code, lists, blockquotes, hr, links and wikilinks.
 * Not CommonMark — no new dependency (markdown-it etc.) per CONTEXT.md's no-new-deps rule.
 */

export type LinkResolver = (target: string) => { slug: string } | undefined;

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikilinks(body: string): string[] {
  const targets: string[] = [];
  for (const match of body.matchAll(WIKILINK)) targets.push(match[1].trim());
  return targets;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(raw: string, resolveLink: LinkResolver): string {
  let text = escapeHtml(raw);

  text = text.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

  text = text.replace(WIKILINK, (_m, target: string, display?: string) => {
    const trimmedTarget = target.trim();
    const label = (display ?? trimmedTarget).trim();
    const resolved = resolveLink(trimmedTarget);
    if (resolved) return `<a class="wiki-link" href="#/entity/${encodeURIComponent(resolved.slug)}">${label}</a>`;
    return `<a class="wiki-link wiki-link-broken" href="#/new?title=${encodeURIComponent(trimmedTarget)}" title="No page yet — click to create">${label}</a>`;
  });

  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`
  );
  text = text.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`);
  text = text.replace(/\*([^*]+)\*|_([^_]+)_/g, (_m, a, b) => `<em>${a ?? b}</em>`);

  return text;
}

export function renderMarkdown(body: string, resolveLink: LinkResolver): string {
  const lines = body.split("\n");
  const html: string[] = [];
  let i = 0;

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(" "), resolveLink)}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      html.push(`<${tag}>${list.items.map(item => `<li>${renderInline(item, resolveLink)}</li>`).join("")}</${tag}>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote) {
      html.push(`<blockquote><p>${renderInline(quote.join(" "), resolveLink)}</p></blockquote>`);
      quote = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushAll();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2], resolveLink)}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll();
      html.push("<hr>");
      i++;
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = Boolean(ordered);
      const item = (unordered ?? ordered)![1];
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(item);
      i++;
      continue;
    }

    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote = quote ?? [];
      quote.push(quoteLine[1]);
      i++;
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      i++;
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
    i++;
  }

  flushAll();
  return html.join("\n");
}
