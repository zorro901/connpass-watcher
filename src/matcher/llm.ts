import type { Config } from "../config/schema.js";
import type { ConnpassEvent, InterestMatch } from "../connpass/types.js";
import { createLLMProvider, getDefaultModel } from "../llm/factory.js";
import type { LLMProvider } from "../llm/types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("matcher:llm");

/**
 * HTMLタグを除去
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * LLMベースの興味マッチング
 */
export class LLMMatcher {
  private provider: LLMProvider;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // プロバイダを作成
    const llmConfig = config.llm;
    this.provider = createLLMProvider({
      provider: llmConfig.provider,
      model: llmConfig.model ?? getDefaultModel(llmConfig.provider),
      apiKey: llmConfig.api_key,
      baseUrl: llmConfig.base_url,
    });
  }

  /**
   * イベントが興味にマッチするかをLLMで判定
   */
  async matchInterest(event: ConnpassEvent, keywordResult: InterestMatch): Promise<InterestMatch> {
    const profile = this.config.interests.profile;

    if (!profile) {
      logger.debug({ eventId: event.id }, "No profile configured, using keyword result only");
      return keywordResult;
    }

    if (!this.config.llm.enabled) {
      logger.debug({ eventId: event.id }, "LLM disabled, using keyword result only");
      return keywordResult;
    }

    const description = stripHtml(event.description).slice(0, 2000); // 長すぎる場合は切り詰め

    const prompt = `あなたはイベント推薦システムです。以下のイベントがユーザーの興味にマッチするかを判定してください。

## ユーザープロファイル
${profile}

## イベント情報
タイトル: ${event.title}
キャッチ: ${event.catch}
概要: ${description}
開催場所: ${event.place ?? "未定"}
開催日時: ${event.started_at}

## キーワードマッチ結果
マッチしたキーワード: ${keywordResult.keyword_matches.join(", ") || "なし"}
キーワードスコア: ${keywordResult.score}/100

## 判定基準
1. ユーザーの興味分野とイベント内容の関連性
2. ユーザーのスキルレベルとイベントの対象レベル
3. 登壇機会があればボーナス

## 出力形式
以下のJSON形式で回答してください:
{
  "is_match": true または false,
  "score": 0-100の整数,
  "reason": "判定理由を1-2文で"
}`;

    try {
      const responseText = await this.provider.generateText(prompt);

      // JSONを抽出
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const result = JSON.parse(jsonMatch[0]) as {
        is_match: boolean;
        score: number;
        reason: string;
      };

      logger.debug(
        {
          eventId: event.id,
          provider: this.provider.name,
          isMatch: result.is_match,
          score: result.score,
        },
        "LLM matching completed",
      );

      return {
        is_match: result.is_match,
        score: result.score,
        keyword_matches: keywordResult.keyword_matches,
        llm_reason: result.reason,
      };
    } catch (error) {
      logger.error(
        { error, eventId: event.id, provider: this.provider.name },
        "LLM matching failed, falling back to keyword result",
      );
      return keywordResult;
    }
  }
}
