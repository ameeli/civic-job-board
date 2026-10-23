import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head"]);

/**
 * Converts an HTML fragment to readable plain text: one line per block,
 * a blank line between paragraphs, and `• ` before list items.
 */
export function htmlToText(html: string): string {
  const root = parse(html, { comment: false });
  const lines: string[] = [];
  let current = "";
  let listItemDepth = 0;

  // `blankIfEmpty`: an empty line still counts, as in `<br><br>` between paragraphs.
  const flush = (blankIfEmpty = false) => {
    const line = current.replace(/[ \t\u00a0]+/g, " ").trim();
    if (line === "•") {
      // A list item whose text sits in a nested block: keep the bullet for it.
      return;
    }
    if (line) {
      lines.push(line);
    } else if (blankIfEmpty && lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    current = "";
  };

  const walk = (node: Node) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      current += node.text.replace(/\s+/g, " ");
      return;
    }
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const tag = node.rawTagName?.toLowerCase() ?? "";
    if (SKIPPED_TAGS.has(tag)) {
      return;
    }
    if (tag === "br") {
      flush(true);
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) {
      flush();
      if (tag === "li") {
        current = "• ";
      }
    }
    if (tag === "li") listItemDepth++;
    for (const child of node.childNodes) {
      walk(child);
    }
    if (tag === "li") listItemDepth--;
    if (isBlock) {
      flush();
      current = "";
      // A paragraph inside a list item does not get a blank line after it.
      if ((tag === "p" && listItemDepth === 0) || /^h[1-6]$/.test(tag)) {
        lines.push("");
      }
    }
  };

  walk(root);
  flush();
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decodes HTML entities in a short string, such as an RSS title. */
export function decodeEntities(text: string): string {
  return parse(text).text;
}

/** Collapses runs of whitespace and trims; returns null for empty input. */
export function cleanText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) {
    return null;
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned || null;
}
