import type { ChunkRecord } from "@crawler/shared";

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreChunk(question: string, chunk: ChunkRecord): number {
  const queryTerms = tokenize(question);
  const titleTerms = tokenize(chunk.title ?? "");
  const headingTerms = tokenize((chunk.headingPath ?? []).join(" "));
  const bodyTerms = tokenize(chunk.text);

  const bodyCounts = new Map<string, number>();
  for (const term of bodyTerms) {
    bodyCounts.set(term, (bodyCounts.get(term) ?? 0) + 1);
  }

  let score = 0;

  for (const term of queryTerms) {
    score += bodyCounts.get(term) ?? 0;
    if (titleTerms.includes(term)) score += 5;
    if (headingTerms.includes(term)) score += 3;
  }

  // Bonus for exact phrase match
  if (chunk.text.toLowerCase().includes(question.toLowerCase())) {
    score += 20;
  }

  return score;
}

export interface ScoredChunk {
  chunk: ChunkRecord;
  score: number;
}

export function searchChunks(
  question: string,
  chunks: ChunkRecord[],
  topK = 6
): ScoredChunk[] {
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(question, chunk) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
