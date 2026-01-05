import type { ConnpassEvent, SpeakerOpportunity } from "./types.js";

/**
 * 登壇・LT関連のキーワード
 */
const SPEAKER_KEYWORDS = [
  // 日本語
  "LT",
  "ライトニングトーク",
  "登壇",
  "発表",
  "スピーカー",
  "登壇者",
  "発表者",
  "CFP",
  "プロポーザル",
  "募集",
  // 英語
  "lightning talk",
  "speaker",
  "presenter",
  "call for proposals",
  "call for papers",
  "proposal",
];

/**
 * 登壇枠を示すキーワード (参加枠名に含まれる)
 */
const SLOT_KEYWORDS = ["LT", "登壇", "発表", "スピーカー", "speaker", "presenter", "lightning"];

/**
 * CFP (Call for Proposals) を示すキーワード
 */
const CFP_KEYWORDS = [
  "CFP",
  "Call for Proposals",
  "Call for Papers",
  "発表者募集",
  "登壇者募集",
  "スピーカー募集",
  "LT募集",
  "LT枠募集",
  "発表枠募集",
  "募集中",
  "応募",
  "エントリー",
];

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
 * イベントの登壇可能性を解析
 */
export function analyzeSpeakerOpportunity(event: ConnpassEvent): SpeakerOpportunity {
  const title = event.title.toLowerCase();
  const catchText = event.catch.toLowerCase();
  const description = stripHtml(event.description).toLowerCase();
  const combinedText = `${title} ${catchText} ${description}`;

  const detectedKeywords: string[] = [];

  // LT枠の検出 (タイトルやキャッチで判定)
  const hasLtSlot = SLOT_KEYWORDS.some((keyword) => {
    const kw = keyword.toLowerCase();
    if (title.includes(kw) || catchText.includes(kw)) {
      detectedKeywords.push(keyword);
      return true;
    }
    return false;
  });

  // CFPの検出 (説明文から)
  const hasCfp = CFP_KEYWORDS.some((keyword) => {
    const kw = keyword.toLowerCase();
    if (combinedText.includes(kw)) {
      if (!detectedKeywords.includes(keyword)) {
        detectedKeywords.push(keyword);
      }
      return true;
    }
    return false;
  });

  // 一般的な登壇関連キーワードの検出
  for (const keyword of SPEAKER_KEYWORDS) {
    const kw = keyword.toLowerCase();
    if (combinedText.includes(kw) && !detectedKeywords.includes(keyword)) {
      detectedKeywords.push(keyword);
    }
  }

  return {
    has_opportunity: hasLtSlot || hasCfp,
    has_lt_slot: hasLtSlot,
    has_cfp: hasCfp,
    detected_keywords: detectedKeywords,
  };
}
