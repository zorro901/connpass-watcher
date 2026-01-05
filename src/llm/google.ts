import { GoogleGenerativeAI } from "@google/generative-ai";
import { createChildLogger } from "../utils/logger.js";
import type { LLMProvider, LLMProviderConfig } from "./types.js";

const logger = createChildLogger("llm:google");

/**
 * Google Generative AI (Gemini) プロバイダ
 */
export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error("Google API key is required");
    }
    this.model = config.model;
    this.client = new GoogleGenerativeAI(config.apiKey);
    logger.debug({ model: this.model }, "Google provider initialized");
  }

  async generateText(prompt: string): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.model });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    if (!text) {
      throw new Error("Empty response from Google");
    }

    return text;
  }
}
