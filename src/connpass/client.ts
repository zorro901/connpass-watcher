import { addMonths, addWeeks, format } from "date-fns";
import type { Config } from "../config/schema.js";
import { createChildLogger } from "../utils/logger.js";
import { connpassRateLimiter } from "../utils/rate-limiter.js";
import type {
  ConnpassApiResponse,
  ConnpassEvent,
  ConnpassSearchParams,
  EnrichedEvent,
  Prefecture,
} from "./types.js";

const logger = createChildLogger("connpass");

const CONNPASS_API_BASE = "https://connpass.com/api/v2/events/";

/**
 * connpass API クライアント
 */
export class ConnpassClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * APIリクエストを実行
   */
  private async fetchEvents(params: ConnpassSearchParams): Promise<ConnpassApiResponse> {
    const url = new URL(CONNPASS_API_BASE);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          // v2 API: 配列パラメータはカンマ区切り
          url.searchParams.set(key, value.join(","));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    logger.debug({ url: url.toString() }, "Fetching events");

    const response = await connpassRateLimiter.schedule(async () => {
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "connpass-watcher/0.1.0",
          "X-API-Key": this.config.connpass.api_key,
        },
      });

      if (!res.ok) {
        throw new Error(`connpass API error: ${res.status} ${res.statusText}`);
      }

      return res.json() as Promise<ConnpassApiResponse>;
    });

    logger.debug(
      {
        returned: response.results_returned,
        available: response.results_available,
      },
      "Fetched events",
    );

    return response;
  }

  /**
   * 今日から指定期間先までの日付リストを生成
   * weeks_ahead が指定されていればそちらを優先、なければ months_ahead を使用
   */
  private getTargetDates(): string[] {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { weeks_ahead, months_ahead } = this.config.connpass;
    let endDate: Date;
    if (weeks_ahead !== undefined) {
      endDate = addWeeks(today, weeks_ahead);
    } else {
      endDate = addMonths(today, months_ahead ?? 1);
    }

    let current = new Date(today);
    while (current < endDate) {
      dates.push(format(current, "yyyyMMdd"));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  /**
   * イベントがオンライン開催かどうかを判定
   */
  private isOnlineEvent(event: ConnpassEvent): boolean {
    const onlineKeywords = ["オンライン", "online", "リモート", "remote", "zoom", "teams", "meet"];
    const place = event.place?.toLowerCase() ?? "";
    const address = event.address?.toLowerCase() ?? "";
    const title = event.title.toLowerCase();

    return onlineKeywords.some(
      (keyword) =>
        place.includes(keyword) ||
        address.includes(keyword) ||
        title.includes(keyword.toLowerCase()),
    );
  }

  /**
   * イベントが東京開催かどうかを判定
   */
  private isTokyoEvent(event: ConnpassEvent): boolean {
    const tokyoKeywords = ["東京", "tokyo", "渋谷", "新宿", "池袋", "秋葉原", "品川", "六本木"];
    const place = event.place?.toLowerCase() ?? "";
    const address = event.address?.toLowerCase() ?? "";

    return tokyoKeywords.some(
      (keyword) => place.includes(keyword) || address.includes(keyword.toLowerCase()),
    );
  }

  /**
   * イベントを enriched 形式に変換
   */
  private enrichEvent(event: ConnpassEvent): EnrichedEvent {
    return {
      ...event,
      is_online: this.isOnlineEvent(event),
      is_tokyo: this.isTokyoEvent(event),
    };
  }

  /**
   * 設定に基づいてイベントをフィルタリング
   */
  private filterEvents(events: EnrichedEvent[]): EnrichedEvent[] {
    // 今日の0時0分を基準に過去イベントを判定
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.filter((event) => {
      const eventDate = new Date(event.started_at);
      // 今日より前のイベントを除外（今日のイベントは含む）
      if (eventDate < today) {
        return false;
      }

      // オンラインイベントは include_online が false の場合は除外
      if (event.is_online && !this.config.connpass.include_online) {
        return false;
      }

      // prefecture は API で指定済みなので追加フィルタ不要
      return true;
    });
  }

  /**
   * 設定から都道府県リストを取得
   */
  private getTargetPrefectures(): Prefecture[] {
    const prefectures: Prefecture[] = [];

    // 設定された都道府県を追加
    for (const pref of this.config.connpass.prefectures) {
      prefectures.push(pref as Prefecture);
    }

    // オンラインを含める場合
    if (this.config.connpass.include_online) {
      prefectures.push("online");
    }

    return prefectures;
  }

  /**
   * イベントを取得
   */
  async getEvents(): Promise<EnrichedEvent[]> {
    const targetDates = this.getTargetDates();
    const prefectures = this.getTargetPrefectures();
    const allEvents: ConnpassEvent[] = [];

    logger.info({ dateRange: `${targetDates[0]} - ${targetDates[targetDates.length - 1]}`, prefectures }, "Fetching events");

    // 日付ごとに個別リクエスト（複数日まとめると100件制限で取得漏れが発生するため）
    const count = 100;
    for (const date of targetDates) {
      let start = 1;

      while (true) {
        const response = await this.fetchEvents({
          ymd: [date],
          prefecture: prefectures,
          count,
          start,
          order: 2, // 開催日時順
        });

        allEvents.push(...response.events);

        // 全件取得できたか確認
        if (response.results_returned < count) {
          break;
        }

        start += count;

        // 安全のため最大500件まで
        if (start > 500) {
          logger.warn({ date }, "Reached max events limit for date");
          break;
        }
      }
    }

    logger.info({ total: allEvents.length }, "Total events fetched");

    // 重複排除 (id で)
    const uniqueEvents = Array.from(new Map(allEvents.map((e) => [e.id, e])).values());

    // enrich & filter
    const enrichedEvents = uniqueEvents.map((e) => this.enrichEvent(e));
    const filteredEvents = this.filterEvents(enrichedEvents);

    logger.info(
      {
        unique: uniqueEvents.length,
        filtered: filteredEvents.length,
      },
      "Events processed",
    );

    return filteredEvents;
  }
}
