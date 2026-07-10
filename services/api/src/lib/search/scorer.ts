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

/**
 * Cross-site search with a per-company quota so one large corpus can't crowd
 * out every other company on broad questions. Each site gets at most
 * ceil(topK / matchingSites) slots first; leftover slots are filled by global
 * score regardless of company.
 */
export function searchChunksAcrossSites(
  question: string,
  chunks: ChunkRecord[],
  topK = 8
): ScoredChunk[] {
  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(question, chunk) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const matchingSites = new Set(scored.map((s) => s.chunk.siteId)).size;
  if (matchingSites <= 1) return scored.slice(0, topK);

  const quota = Math.max(1, Math.ceil(topK / matchingSites));
  const taken: ScoredChunk[] = [];
  const skipped: ScoredChunk[] = [];
  const perSite = new Map<string, number>();

  for (const item of scored) {
    const count = perSite.get(item.chunk.siteId) ?? 0;
    if (taken.length < topK && count < quota) {
      taken.push(item);
      perSite.set(item.chunk.siteId, count + 1);
    } else {
      skipped.push(item);
    }
  }

  for (const item of skipped) {
    if (taken.length >= topK) break;
    taken.push(item);
  }

  return taken.sort((a, b) => b.score - a.score);
}
