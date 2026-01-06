import OpenAI from "openai";
import { createChildLogger } from "../utils/logger.js";
import type { LLMProvider, LLMProviderConfig } from "./types.js";

const logger = createChildLogger("llm:openrouter");

/**
 * OpenRouter プロバイダ
 * 複数のLLMプロバイダを統一APIで利用可能
 * https://openrouter.ai/
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  private client: OpenAI;
  private model: string;

  constructor(config: LLMProviderConfig) {
    const apiKey = config.apiKey || process.env["OPENROUTER_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or provide api_key in config.",
      );
    }

    this.model = config.model;
    const baseURL = config.baseUrl || "https://openrouter.ai/api/v1";

    logger.debug(
      {
        model: this.model,
        baseURL,
        apiKeyPrefix: apiKey.slice(0, 10) + "...",
        apiKeySource: config.apiKey ? "config" : "env",
      },
      "OpenRouter provider initializing",
    );

    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/connpass-watcher",
        "X-Title": "connpass-watcher",
      },
    });
    logger.debug("OpenRouter provider initialized");
  }

  async generateText(prompt: string): Promise<string> {
    logger.debug({ model: this.model, promptLength: prompt.length }, "Sending request to OpenRouter");

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    logger.debug({ model: this.model, choicesCount: response.choices.length }, "Received response from OpenRouter");

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenRouter");
    }

    return content;
  }
}
