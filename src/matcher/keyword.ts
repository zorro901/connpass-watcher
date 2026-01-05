import type { Config } from "../config/schema.js";
import type { ConnpassEvent, InterestMatch } from "../connpass/types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("matcher:keyword");

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
 * キーワードベースの興味マッチング
 */
export function matchKeywords(event: ConnpassEvent, config: Config): InterestMatch {
  const keywords = config.interests.keywords;

  if (keywords.length === 0) {
    logger.debug({ eventId: event.id }, "No keywords configured, skipping");
    return {
      is_match: false,
      score: 0,
      keyword_matches: [],
    };
  }

  const title = event.title.toLowerCase();
  const catchText = event.catch.toLowerCase();
  const description = stripHtml(event.description).toLowerCase();

  const matchedKeywords: string[] = [];

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();

    // タイトルでのマッチは重み2倍
    const titleMatch = title.includes(kw);
    const catchMatch = catchText.includes(kw);
    const descMatch = description.includes(kw);

    if (titleMatch || catchMatch || descMatch) {
      matchedKeywords.push(keyword);
    }
  }

  // スコア計算: マッチしたキーワード数 / 全キーワード数 * 100
  const score = Math.round((matchedKeywords.length / keywords.length) * 100);

  // 1つ以上マッチしたらtrue
  const isMatch = matchedKeywords.length > 0;

  logger.debug(
    {
      eventId: event.id,
      matches: matchedKeywords,
      score,
    },
    "Keyword matching completed",
  );

  return {
    is_match: isMatch,
    score,
    keyword_matches: matchedKeywords,
  };
}
