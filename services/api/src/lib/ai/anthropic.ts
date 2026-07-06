import Anthropic from "@anthropic-ai/sdk";
import { AiProvider, AiAnswerInput, AiAnswerOutput, buildPrompt } from "./types";

export class AnthropicAnswerProvider implements AiProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async answerWithContext(input: AiAnswerInput): Promise<AiAnswerOutput> {
    const prompt = buildPrompt(input.question, input.contexts);

    const message = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: input.maxTokens ?? 700,
      messages: [{ role: "user", content: prompt }],
    });

    const answer =
      message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("") ?? "";

    return { answer, usage: message.usage };
  }
}
