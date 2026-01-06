import type { Config } from "../config/schema.js";
import type { ConnpassEvent, InterestMatch, SpeakerOpportunity } from "../connpass/types.js";
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
 * LLM分析結果
 */
export interface LLMAnalysisResult {
  interest: InterestMatch;
  speaker: SpeakerOpportunity;
}

/**
 * LLMベースのイベント分析
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
   * イベントを分析（興味マッチング + 登壇機会検出）
   */
  async analyzeEvent(event: ConnpassEvent): Promise<LLMAnalysisResult> {
    const defaultResult: LLMAnalysisResult = {
      interest: {
        is_match: false,
        score: 0,
        keyword_matches: [],
      },
      speaker: {
        has_opportunity: false,
        has_lt_slot: false,
        has_cfp: false,
        detected_keywords: [],
      },
    };

    if (!this.config.llm.enabled) {
      logger.debug({ eventId: event.id }, "LLM disabled");
      return defaultResult;
    }

    const profile = this.config.interests.profile ?? "技術イベントに興味があるエンジニア";
    const description = stripHtml(event.description).slice(0, 3000);

    const prompt = `あなたはイベント分析システムです。以下のイベントを分析してください。

## ユーザープロファイル
${profile}

## イベント情報
タイトル: ${event.title}
キャッチ: ${event.catch}
概要: ${description}
開催場所: ${event.place ?? "未定"}
開催日時: ${event.started_at}
参加者数: ${event.accepted}人

## 分析タスク
1. **興味マッチング**: このイベントがユーザーの興味に合うか判定
2. **登壇機会検出**: このイベントで発表・LT・登壇する機会があるか判定

## 登壇機会の判定基準
- LT（ライトニングトーク）枠の募集があるか
- スピーカー・発表者の公募があるか
- CFP（Call for Proposals）があるか
- 注意: 「参加者募集」「イベント参加応募」は登壇機会ではない

## 出力形式（JSON）
{
  "interest": {
    "is_match": true/false,
    "score": 0-100,
    "reason": "判定理由"
  },
  "speaker": {
    "has_opportunity": true/false,
    "has_lt_slot": true/false,
    "has_cfp": true/false,
    "reason": "判定理由（登壇機会がある場合のみ）"
  }
}`;

    try {
      const responseText = await this.provider.generateText(prompt);

      // JSONを抽出（マークダウンコードブロック対応）
      let jsonText: string | null = null;

      // まずマークダウンのコードブロックを探す
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch?.[1]) {
        jsonText = codeBlockMatch[1].trim();
      } else {
        // コードブロックがなければ最初の { から最後の } までを抽出
        const startIdx = responseText.indexOf("{");
        const endIdx = responseText.lastIndexOf("}");
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonText = responseText.slice(startIdx, endIdx + 1);
        }
      }

      if (!jsonText) {
        logger.warn({ responseText: responseText.slice(0, 500) }, "No JSON found in LLM response");
        throw new Error("No JSON found in response");
      }

      // 不正なJSONを修正（末尾カンマ、改行内のエスケープ漏れなど）
      const cleanedJson = jsonText
        // 文字列内の改行をエスケープ
        .replace(/:\s*"([^"]*)\n([^"]*)"/g, ': "$1\\n$2"')
        // 末尾カンマを削除
        .replace(/,(\s*[}\]])/g, "$1");

      let result: {
        interest: {
          is_match: boolean;
          score: number;
          reason: string;
        };
        speaker: {
          has_opportunity: boolean;
          has_lt_slot: boolean;
          has_cfp: boolean;
          reason?: string;
        };
      };

      try {
        result = JSON.parse(cleanedJson);
      } catch (parseError) {
        // JSONパースに失敗した場合、生のJSONをログに出力
        const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.error(
          `Failed to parse JSON: ${errMsg}\n--- Raw JSON ---\n${jsonText}\n--- Cleaned JSON ---\n${cleanedJson}`,
        );
        throw parseError;
      }

      logger.debug(
        {
          eventId: event.id,
          provider: this.provider.name,
          interest: result.interest,
          speaker: result.speaker,
        },
        "LLM analysis completed",
      );

      return {
        interest: {
          is_match: result.interest.is_match,
          score: result.interest.score,
          keyword_matches: [],
          llm_reason: result.interest.reason,
        },
        speaker: {
          has_opportunity: result.speaker.has_opportunity,
          has_lt_slot: result.speaker.has_lt_slot,
          has_cfp: result.speaker.has_cfp,
          detected_keywords: result.speaker.reason ? [result.speaker.reason] : [],
        },
      };
    } catch (error) {
      // エラー詳細を抽出
      const errorDetails =
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              // OpenAI SDK エラーの追加プロパティ
              ...(("status" in error && { status: error.status }) || {}),
              ...(("code" in error && { code: error.code }) || {}),
            }
          : error;
      logger.error(
        { error: errorDetails, eventId: event.id, provider: this.provider.name },
        "LLM analysis failed",
      );
      return defaultResult;
    }
  }
}
