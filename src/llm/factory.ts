import { createChildLogger } from "../utils/logger.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import type { LLMProvider, LLMProviderConfig } from "./types.js";

const logger = createChildLogger("llm:factory");

/**
 * LLMプロバイダを作成
 */
export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  logger.debug({ provider: config.provider, model: config.model }, "Creating LLM provider");

  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "google":
      return new GoogleProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    case "openrouter":
      return new OpenRouterProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * デフォルトのモデル名を取得
 */
export function getDefaultModel(provider: LLMProviderConfig["provider"]): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "openai":
      return "gpt-4o";
    case "google":
      return "gemini-1.5-flash";
    case "ollama":
      return "llama3.2";
    case "openrouter":
      // 無料モデル: xiaomi/mimo-v2-flash:free
      return "xiaomi/mimo-v2-flash:free";
    default:
      return "gpt-4o";
  }
}
