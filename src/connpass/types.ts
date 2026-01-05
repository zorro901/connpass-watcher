/**
 * connpass API v2 event response type
 * @see https://connpass.com/about/api/
 */
export interface ConnpassEvent {
  /** イベントID */
  id: number;
  /** タイトル */
  title: string;
  /** キャッチ */
  catch: string;
  /** 概要(HTML形式) */
  description: string;
  /** connpass.com上のURL */
  url: string;
  /** Twitterのハッシュタグ */
  hash_tag: string;
  /** イベント開催日時 (ISO 8601形式) */
  started_at: string;
  /** イベント終了日時 (ISO 8601形式) */
  ended_at: string;
  /** 定員 */
  limit: number | null;
  /** イベント参加タイプ */
  event_type: "participation" | "advertisement";
  /** 参加者数 */
  accepted: number;
  /** 補欠者数 */
  waiting: number;
  /** 更新日時 (ISO 8601形式) */
  updated_at: string;
  /** 管理者のID */
  owner_id: number;
  /** 管理者のニックネーム */
  owner_nickname: string;
  /** 管理者の表示名 */
  owner_display_name: string;
  /** 開催場所 */
  place: string | null;
  /** 開催会場の住所 */
  address: string | null;
  /** 開催会場の緯度 */
  lat: string | null;
  /** 開催会場の経度 */
  lon: string | null;
  /** グループ (v2で series から変更) */
  group: {
    id: number;
    title: string;
    url: string;
  } | null;
}

export interface ConnpassApiResponse {
  /** 含まれる検索結果の件数 */
  results_returned: number;
  /** 検索結果の総件数 */
  results_available: number;
  /** 検索の開始位置 */
  results_start: number;
  /** イベントリスト */
  events: ConnpassEvent[];
}

/** 都道府県コード */
export type Prefecture =
  | "online"
  | "hokkaido"
  | "aomori"
  | "iwate"
  | "miyagi"
  | "akita"
  | "yamagata"
  | "fukushima"
  | "ibaraki"
  | "tochigi"
  | "gunma"
  | "saitama"
  | "chiba"
  | "tokyo"
  | "kanagawa"
  | "yamanashi"
  | "nagano"
  | "niigata"
  | "toyama"
  | "ishikawa"
  | "fukui"
  | "gifu"
  | "shizuoka"
  | "aichi"
  | "mie"
  | "shiga"
  | "kyoto"
  | "osaka"
  | "hyogo"
  | "nara"
  | "wakayama"
  | "tottori"
  | "shimane"
  | "okayama"
  | "hiroshima"
  | "yamaguchi"
  | "tokushima"
  | "kagawa"
  | "ehime"
  | "kochi"
  | "fukuoka"
  | "saga"
  | "nagasaki"
  | "kumamoto"
  | "oita"
  | "miyazaki"
  | "kagoshima"
  | "okinawa";

export interface ConnpassSearchParams {
  /** イベントID */
  event_id?: number | number[];
  /** キーワード (AND) */
  keyword?: string | string[];
  /** キーワード (OR) */
  keyword_or?: string | string[];
  /** イベント開催年月 (yyyymm形式) */
  ym?: string | string[];
  /** イベント開催年月日 (yyyymmdd形式) */
  ymd?: string | string[];
  /** 参加者のニックネーム */
  nickname?: string | string[];
  /** 管理者のニックネーム */
  owner_nickname?: string | string[];
  /** グループID (v2で series_id から変更) */
  group_id?: number | number[];
  /** サブドメイン */
  subdomain?: string | string[];
  /** 都道府県 (v2で追加) */
  prefecture?: Prefecture | Prefecture[];
  /** 検索結果の表示順 (1: 更新日時順、2: 開催日時順、3: 新着順) */
  order?: 1 | 2 | 3;
  /** 検索の開始位置 (デフォルト: 1) */
  start?: number;
  /** 取得件数 (デフォルト: 10、最大: 100) */
  count?: number;
}

/** 処理済みイベントの追加情報 */
export interface EnrichedEvent extends ConnpassEvent {
  /** オンライン開催かどうか */
  is_online: boolean;
  /** 東京開催かどうか */
  is_tokyo: boolean;
  /** 登壇可能性判定結果 */
  speaker_opportunity?: SpeakerOpportunity;
  /** 興味マッチング結果 */
  interest_match?: InterestMatch;
}

export interface SpeakerOpportunity {
  /** 登壇可能性があるかどうか */
  has_opportunity: boolean;
  /** LT枠があるか */
  has_lt_slot: boolean;
  /** CFP (Call for Proposals) があるか */
  has_cfp: boolean;
  /** 検出された関連キーワード */
  detected_keywords: string[];
}

export interface InterestMatch {
  /** 興味にマッチするかどうか */
  is_match: boolean;
  /** マッチスコア (0-100) */
  score: number;
  /** キーワードマッチ結果 */
  keyword_matches: string[];
  /** LLM判定理由 (LLM使用時) */
  llm_reason?: string;
}
