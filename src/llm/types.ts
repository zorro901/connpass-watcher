/**
 * LLMプロバイダの共通インターフェース
 */
export interface LLMProvider {
  /**
   * プロバイダ名
   */
  readonly name: string;

  /**
   * テキスト生成リクエスト
   */
  generateText(prompt: string): Promise<string>;
}

/**
 * LLMプロバイダの設定
 */
export interface LLMProviderConfig {
  provider: "anthropic" | "openai" | "google" | "ollama";
  model: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}
