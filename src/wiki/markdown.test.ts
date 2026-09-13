import { describe, expect, it } from "vitest";
import { extractWikilinks, renderMarkdown } from "./markdown";

const noResolve = () => undefined;
const resolveAll = (target: string) => ({ slug: target.toLowerCase().replace(/\s+/g, "-") });

describe("extractWikilinks", () => {
  it("extracts plain and aliased targets, ignoring the display text", () => {
    expect(extractWikilinks("See [[Old Port]] and [[old-port|the harbor]].")).toEqual(["Old Port", "old-port"]);
  });

  it("returns nothing when there are no wikilinks", () => {
    expect(extractWikilinks("No links here.")).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  it("renders headings and paragraphs", () => {
    expect(renderMarkdown("# Title\n\nA paragraph.", noResolve)).toBe("<h1>Title</h1>\n<p>A paragraph.</p>");
  });

  it("renders bold, italic and inline code", () => {
    expect(renderMarkdown("**bold** and *italic* and `code`", noResolve)).toBe(
      "<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>"
    );
  });

  it("renders a resolved wikilink as a normal link", () => {
    expect(renderMarkdown("[[Old Port]]", resolveAll)).toBe(
      '<p><a class="wiki-link" href="#/entity/old-port">Old Port</a></p>'
    );
  });

  it("renders an aliased wikilink with the display text", () => {
    expect(renderMarkdown("[[old-port|the harbor]]", resolveAll)).toBe(
      '<p><a class="wiki-link" href="#/entity/old-port">the harbor</a></p>'
    );
  });

  it("renders an unresolved wikilink as a broken link", () => {
    const html = renderMarkdown("[[Nowhere]]", noResolve);
    expect(html.includes("wiki-link-broken")).toBe(true);
    expect(html.includes("Nowhere")).toBe(true);
  });

  it("escapes raw HTML in the body", () => {
    expect(renderMarkdown("<script>alert(1)</script>", noResolve)).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("renders an unordered list", () => {
    expect(renderMarkdown("- one\n- two", noResolve)).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders a fenced code block without inline parsing", () => {
    expect(renderMarkdown("```\n**not bold**\n```", noResolve)).toBe("<pre><code>**not bold**</code></pre>");
  });
});
