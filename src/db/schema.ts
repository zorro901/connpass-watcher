import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("db");

/**
 * データベーススキーマを初期化
 */
export function initializeDatabase(dbPath: string): Database.Database {
  // ディレクトリが存在しない場合は作成
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WALモードを有効化 (パフォーマンス向上)
  db.pragma("journal_mode = WAL");

  // テーブル作成
  db.exec(`
    -- イベントテーブル
    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      event_url TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      place TEXT,
      address TEXT,
      is_online INTEGER NOT NULL DEFAULT 0,
      is_tokyo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 処理済みイベントテーブル
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id INTEGER PRIMARY KEY,
      has_speaker_opportunity INTEGER NOT NULL DEFAULT 0,
      has_interest_match INTEGER NOT NULL DEFAULT 0,
      interest_score INTEGER,
      calendar_event_id TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(event_id)
    );

    -- インデックス
    CREATE INDEX IF NOT EXISTS idx_events_started_at ON events(started_at);
    CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at ON processed_events(processed_at);
  `);

  logger.debug({ path: dbPath }, "Database initialized");

  return db;
}
