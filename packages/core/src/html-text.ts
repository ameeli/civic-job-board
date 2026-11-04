import { load } from "cheerio";

/** The readable text of a board's HTML: tags dropped, entities decoded, one line per block. */
export function htmlText(html: string): string {
  const $ = load(html);
  $("script, style").remove();
  $("p, br, li, h1, h2, h3, h4, div").append("\n");
  // Any whitespace but a line break, non-breaking spaces included, is one space.
  return $.root().text().replace(/[^\S\n]+/g, " ").replace(/ *\n\s*/g, "\n").trim();
}
