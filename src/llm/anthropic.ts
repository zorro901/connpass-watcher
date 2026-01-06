import Anthropic from "@anthropic-ai/sdk";
import { createChildLogger } from "../utils/logger.js";
import { claudeRateLimiter } from "../utils/rate-limiter.js";
import type { LLMProvider, LLMProviderConfig } from "./types.js";

const logger = createChildLogger("llm:anthropic");

/**
 * Anthropic (Claude) プロバイダ
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    logger.debug({ model: this.model }, "Anthropic provider initialized");
  }

  async generateText(prompt: string): Promise<string> {
    const response = await claudeRateLimiter.schedule(async () => {
      return this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });
    });

    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }

    return content.text;
  }
}
