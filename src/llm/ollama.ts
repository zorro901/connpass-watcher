import { createChildLogger } from "../utils/logger.js";
import type { LLMProvider, LLMProviderConfig } from "./types.js";

const logger = createChildLogger("llm:ollama");

interface OllamaResponse {
  response: string;
  done: boolean;
}

/**
 * Ollama プロバイダ (ローカルLLM)
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
    logger.debug({ model: this.model, baseUrl: this.baseUrl }, "Ollama provider initialized");
  }

  async generateText(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaResponse;

    if (!data.response) {
      throw new Error("Empty response from Ollama");
    }

    return data.response;
  }
}
