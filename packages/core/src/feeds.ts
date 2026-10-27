import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string | null;
  link: string | null;
  guid: string | null;
  publishedAt: Date | null;
  /** The item's `<description>`, usually HTML. */
  description: string | null;
  /** The item's `<content:encoded>`, the full HTML body when a feed carries one. */
  content: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === "item" || name === "url" || name === "sitemap",
});

/** Reads the items of an RSS 2.0 feed. */
export function parseRss(xml: string): FeedItem[] {
  const document = parser.parse(xml) as { rss?: { channel?: { item?: unknown[] } } };
  const items = document.rss?.channel?.item ?? [];
  return items.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const published = text(record.pubDate) ?? text(record["atom:published"]);
    const date = published ? new Date(published) : null;
    return {
      title: text(record.title),
      link: text(record.link),
      guid: text(record.guid),
      publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      description: text(record.description),
      content: text(record["content:encoded"]),
    };
  });
}

export interface SitemapEntry {
  url: string;
  lastModified: string | null;
}

/** Reads a sitemap's `<url>` entries, or a sitemap index's `<sitemap>` entries. */
export function parseSitemap(xml: string): SitemapEntry[] {
  const document = parser.parse(xml) as {
    urlset?: { url?: unknown[] };
    sitemapindex?: { sitemap?: unknown[] };
  };
  const entries = document.urlset?.url ?? document.sitemapindex?.sitemap ?? [];
  return entries.flatMap((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const url = text(record.loc);
    return url ? [{ url, lastModified: text(record.lastmod) }] : [];
  });
}

// A text node is a string, or an object with `#text` when the element has attributes.
function text(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "#text" in value) {
    return text((value as Record<string, unknown>)["#text"]);
  }
  return null;
}
