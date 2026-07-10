export interface AiContext {
  id: string;
  title?: string;
  url: string;
  text: string;
  /** Company/domain label — set when contexts span multiple crawled sites. */
  company?: string;
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
  const multiCompany = contexts.some((c) => c.company);

  const contextBlocks = contexts
    .map((c, i) => {
      const lines = [`[${i + 1}]`];
      if (c.company) lines.push(`Company: ${c.company}`);
      lines.push(
        `Title: ${c.title ?? "Untitled"}`,
        `URL: ${c.url}`,
        `Content:\n${c.text}`
      );
      return lines.join("\n");
    })
    .join("\n\n");

  const intro = multiCompany
    ? [
        "You are answering questions about a knowledge base of crawled company websites.",
        "Use only the provided context.",
        "Always attribute facts to the company they come from.",
        "When the question involves comparison (benchmarking, competition, partnerships), contrast the companies explicitly.",
        "If the answer is not in the context, say that the crawled pages do not contain enough information.",
        "Do not invent facts.",
        "Cite sources using [1], [2], etc.",
      ]
    : [
        "You are answering questions about a crawled website.",
        "Use only the provided context.",
        "If the answer is not in the context, say that the crawled pages do not contain enough information.",
        "Do not invent facts.",
        "Cite sources using [1], [2], etc.",
      ];

  return [
    ...intro,
    "",
    "Context:",
    contextBlocks,
    "",
    `Question:\n${question}`,
    "",
    "Answer:",
  ].join("\n");
}
