import type { ChunkRecord } from "@crawler/shared";
import { newChunkId } from "../ids";

const CHUNK_TARGET_WORDS = 350;
const CHUNK_MAX_WORDS = 500;
const CHUNK_OVERLAP_WORDS = 50;

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function countWords(text: string): number {
  return tokenize(text).length;
}

export function chunkMarkdown(
  markdown: string,
  meta: {
    siteId: string;
    pageId: string;
    url: string;
    title?: string;
  }
): ChunkRecord[] {
  // Split on headings to preserve heading context
  const sections = splitBySections(markdown);
  const chunks: ChunkRecord[] = [];
  let index = 0;

  for (const section of sections) {
    const words = tokenize(section.text);

    if (words.length === 0) continue;

    // If section fits within max, emit as one chunk
    if (words.length <= CHUNK_MAX_WORDS) {
      chunks.push(makeChunk(meta, section, section.text, index++));
      continue;
    }

    // Otherwise split with overlap
    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + CHUNK_TARGET_WORDS, words.length);
      const chunkWords = words.slice(start, end);
      chunks.push(
        makeChunk(meta, section, chunkWords.join(" "), index++)
      );
      if (end >= words.length) break;
      start = end - CHUNK_OVERLAP_WORDS;
    }
  }

  return chunks;
}

interface Section {
  heading: string;
  headingPath: string[];
  text: string;
}

function splitBySections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: "", headingPath: [], text: "" };
  const headingStack: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (current.text.trim()) {
        sections.push({ ...current });
      }
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      headingStack.splice(level - 1, headingStack.length, title);
      current = {
        heading: title,
        headingPath: [...headingStack.slice(0, level)],
        text: line + "\n",
      };
    } else {
      current.text += line + "\n";
    }
  }

  if (current.text.trim()) {
    sections.push(current);
  }

  return sections;
}

function makeChunk(
  meta: { siteId: string; pageId: string; url: string; title?: string },
  section: Section,
  text: string,
  index: number
): ChunkRecord {
  return {
    chunkId: newChunkId(meta.pageId, index),
    siteId: meta.siteId,
    pageId: meta.pageId,
    url: meta.url,
    title: meta.title,
    headingPath: section.headingPath.length ? section.headingPath : undefined,
    text: text.trim(),
    wordCount: countWords(text),
  };
}
