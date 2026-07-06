import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ExtractedContent {
  title: string;
  html: string;
  textContent: string;
}

export function extractReadableContent(
  rawHtml: string,
  pageUrl: string
): ExtractedContent {
  const dom = new JSDOM(rawHtml, { url: pageUrl });
  const document = dom.window.document;

  // Remove elements that add noise
  for (const selector of [
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    "aside",
    "[role='banner']",
    "[role='navigation']",
    "[role='complementary']",
    ".cookie-banner",
    "#cookie-notice",
  ]) {
    document.querySelectorAll(selector).forEach((el) => el.remove());
  }

  const reader = new Readability(document);
  const article = reader.parse();

  if (!article) {
    // Fall back to body text when Readability can't parse
    return {
      title: document.title ?? "",
      html: document.body?.innerHTML ?? rawHtml,
      textContent: document.body?.textContent ?? "",
    };
  }

  return {
    title: article.title ?? "",
    html: article.content,
    textContent: article.textContent ?? "",
  };
}
