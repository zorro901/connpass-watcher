import type Database from "better-sqlite3";
import type { EnrichedEvent } from "../connpass/types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("db:events");

export interface ProcessedEventRecord {
  event_id: number;
  has_speaker_opportunity: number;
  has_interest_match: number;
  interest_score: number | null;
  calendar_event_id: string | null;
  connpass_updated_at: string | null;
  processed_at: string;
}

/**
 * イベントDBアクセス
 */
export class EventRepository {
  private db: Database.Database;
  private stmtUpsertEvent: Database.Statement;
  private stmtGetProcessed: Database.Statement;
  private stmtMarkProcessed: Database.Statement;
  private stmtGetUnprocessedIds: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    // Prepared statements
    this.stmtUpsertEvent = db.prepare(`
      INSERT INTO events (event_id, title, event_url, started_at, ended_at, place, address, is_online, is_tokyo, connpass_updated_at, updated_at)
      VALUES (@event_id, @title, @event_url, @started_at, @ended_at, @place, @address, @is_online, @is_tokyo, @connpass_updated_at, datetime('now'))
      ON CONFLICT(event_id) DO UPDATE SET
        title = @title,
        event_url = @event_url,
        started_at = @started_at,
        ended_at = @ended_at,
        place = @place,
        address = @address,
        is_online = @is_online,
        is_tokyo = @is_tokyo,
        connpass_updated_at = @connpass_updated_at,
        updated_at = datetime('now')
    `);

    this.stmtGetProcessed = db.prepare(`
      SELECT * FROM processed_events WHERE event_id = ?
    `);

    this.stmtMarkProcessed = db.prepare(`
      INSERT INTO processed_events (event_id, has_speaker_opportunity, has_interest_match, interest_score, calendar_event_id, connpass_updated_at)
      VALUES (@event_id, @has_speaker_opportunity, @has_interest_match, @interest_score, @calendar_event_id, @connpass_updated_at)
      ON CONFLICT(event_id) DO UPDATE SET
        has_speaker_opportunity = @has_speaker_opportunity,
        has_interest_match = @has_interest_match,
        interest_score = @interest_score,
        calendar_event_id = COALESCE(@calendar_event_id, calendar_event_id),
        connpass_updated_at = @connpass_updated_at,
        processed_at = datetime('now')
    `);

    this.stmtGetUnprocessedIds = db.prepare(`
      SELECT e.event_id FROM events e
      LEFT JOIN processed_events p ON e.event_id = p.event_id
      WHERE p.event_id IS NULL
    `);
  }

  /**
   * イベントを保存 (upsert)
   */
  saveEvent(event: EnrichedEvent): void {
    this.stmtUpsertEvent.run({
      event_id: event.id,
      title: event.title,
      event_url: event.url,
      started_at: event.started_at,
      ended_at: event.ended_at,
      place: event.place,
      address: event.address,
      is_online: event.is_online ? 1 : 0,
      is_tokyo: event.is_tokyo ? 1 : 0,
      connpass_updated_at: event.updated_at,
    });
  }

  /**
   * 複数イベントを一括保存
   */
  saveEvents(events: EnrichedEvent[]): void {
    const insertMany = this.db.transaction((evts: EnrichedEvent[]) => {
      for (const event of evts) {
        this.saveEvent(event);
      }
    });

    insertMany(events);
    logger.debug({ count: events.length }, "Events saved");
  }

  /**
   * 処理済みかどうかを確認
   */
  isProcessed(eventId: number): boolean {
    const result = this.stmtGetProcessed.get(eventId) as ProcessedEventRecord | undefined;
    return result !== undefined;
  }

  /**
   * 未処理のイベントIDを取得
   */
  getUnprocessedEventIds(): number[] {
    const rows = this.stmtGetUnprocessedIds.all() as { event_id: number }[];
    return rows.map((r) => r.event_id);
  }

  /**
   * イベントを処理済みとしてマーク
   */
  markProcessed(params: {
    eventId: number;
    hasSpeakerOpportunity: boolean;
    hasInterestMatch: boolean;
    interestScore?: number;
    calendarEventId?: string;
    connpassUpdatedAt?: string;
  }): void {
    this.stmtMarkProcessed.run({
      event_id: params.eventId,
      has_speaker_opportunity: params.hasSpeakerOpportunity ? 1 : 0,
      has_interest_match: params.hasInterestMatch ? 1 : 0,
      interest_score: params.interestScore ?? null,
      calendar_event_id: params.calendarEventId ?? null,
      connpass_updated_at: params.connpassUpdatedAt ?? null,
    });

    logger.debug({ eventId: params.eventId }, "Event marked as processed");
  }

  /**
   * イベントが更新されていて再処理が必要かどうかを確認
   */
  needsReprocessing(eventId: number, currentUpdatedAt: string): boolean {
    const processed = this.getProcessedEvent(eventId);
    if (!processed) {
      return false; // 未処理なので needsReprocessing ではない
    }
    // 保存されている updated_at と現在の updated_at を比較
    if (!processed.connpass_updated_at) {
      return true; // 古いデータで updated_at が保存されていない場合は再処理
    }
    return processed.connpass_updated_at !== currentUpdatedAt;
  }

  /**
   * 処理済みイベント情報を取得
   */
  getProcessedEvent(eventId: number): ProcessedEventRecord | null {
    const result = this.stmtGetProcessed.get(eventId) as ProcessedEventRecord | undefined;
    return result ?? null;
  }
}
