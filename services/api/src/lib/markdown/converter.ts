import TurndownService from "turndown";
import { contentHash } from "../ids";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

export interface MarkdownPage {
  markdown: string;
  hash: string;
}

export function toMarkdown(
  extractedHtml: string,
  meta: {
    siteId: string;
    pageId: string;
    url: string;
    title: string;
    fetchedAt: string;
  }
): MarkdownPage {
  let body = turndown.turndown(extractedHtml);

  // Clean excessive blank lines
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const frontmatter = [
    "---",
    `site_id: ${meta.siteId}`,
    `page_id: ${meta.pageId}`,
    `url: ${meta.url}`,
    `title: "${meta.title.replace(/"/g, '\\"')}"`,
    `fetched_at: ${meta.fetchedAt}`,
    "---",
    "",
  ].join("\n");

  const markdown = frontmatter + body;
  const hash = contentHash(markdown);

  return { markdown, hash };
}
