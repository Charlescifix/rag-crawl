import * as cheerio from "cheerio";
import { validateAndNormalizeUrl } from "../security/validate";

export function extractInternalLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(pageUrl).hostname;
  const seen = new Set<string>();
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Skip non-navigable hrefs
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:") ||
      href.startsWith("#")
    ) {
      return;
    }

    let normalized: string;
    try {
      normalized = validateAndNormalizeUrl(new URL(href, pageUrl).toString());
    } catch {
      return;
    }

    if (new URL(normalized).hostname !== origin) return;
    if (seen.has(normalized)) return;

    seen.add(normalized);
    links.push(normalized);
  });

  return links;
}
