export interface AiContext {
  id: string;
  title?: string;
  url: string;
  text: string;
}

export interface AiAnswerInput {
  question: string;
  contexts: AiContext[];
  maxTokens?: number;
}

export interface AiAnswerOutput {
  answer: string;
  usage?: unknown;
}

export interface AiProvider {
  answerWithContext(input: AiAnswerInput): Promise<AiAnswerOutput>;
}

export function buildPrompt(question: string, contexts: AiContext[]): string {
  const contextBlocks = contexts
    .map(
      (c, i) =>
        `[${i + 1}]\nTitle: ${c.title ?? "Untitled"}\nURL: ${c.url}\nContent:\n${c.text}`
    )
    .join("\n\n");

  return [
    "You are answering questions about a crawled website.",
    "Use only the provided context.",
    "If the answer is not in the context, say that the crawled pages do not contain enough information.",
    "Do not invent facts.",
    "Cite sources using [1], [2], etc.",
    "",
    "Context:",
    contextBlocks,
    "",
    `Question:\n${question}`,
    "",
    "Answer:",
  ].join("\n");
}
