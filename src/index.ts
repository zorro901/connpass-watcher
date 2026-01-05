import { homedir } from "node:os";
import { join } from "node:path";
import { program } from "commander";
import schedule from "node-schedule";
import { GoogleCalendarClient } from "./calendar/google.js";
import { loadConfig } from "./config/loader.js";
import type { Config } from "./config/schema.js";
import { ConnpassClient } from "./connpass/client.js";
import type { EnrichedEvent } from "./connpass/types.js";
import { EventRepository } from "./db/events.js";
import { initializeDatabase } from "./db/schema.js";
import { matchKeywords } from "./matcher/keyword.js";
import { LLMMatcher } from "./matcher/llm.js";
import { enrichWithSpeakerOpportunity } from "./matcher/speaker.js";
import { logger } from "./utils/logger.js";

const APP_DIR = ".connpass-watcher";
const DB_FILE = "events.db";

interface ScanOptions {
  config?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface ScanResult {
  event: EnrichedEvent;
  action: "registered" | "skipped" | "already_processed" | "no_match";
  calendarEventId?: string;
}

/**
 * イベントをスキャンして処理
 */
async function scanEvents(config: Config, options: ScanOptions): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // DB初期化
  const dbPath = join(homedir(), APP_DIR, DB_FILE);
  const db = initializeDatabase(dbPath);
  const eventRepo = new EventRepository(db);

  // クライアント初期化
  const connpassClient = new ConnpassClient(config);
  const llmMatcher = new LLMMatcher(config);
  const calendarClient = new GoogleCalendarClient(config);

  // カレンダー認証チェック (dry-run以外)
  if (!options.dryRun && config.google_calendar.enabled) {
    const isAuth = await calendarClient.isAuthenticated();
    if (!isAuth) {
      logger.warn("Google Calendar not authenticated. Run 'connpass-watcher auth' first.");
    }
  }

  // connpassからイベント取得
  logger.info("Fetching events from connpass...");
  const events = await connpassClient.getEvents();
  logger.info({ count: events.length }, "Events fetched");

  // イベントを保存
  eventRepo.saveEvents(events);

  // 各イベントを処理
  for (const event of events) {
    // 処理済みチェック
    if (eventRepo.isProcessed(event.id)) {
      results.push({ event, action: "already_processed" });
      continue;
    }

    // 登壇可能性を判定
    const enrichedEvent = enrichWithSpeakerOpportunity(event, config);

    // キーワードマッチング
    const keywordResult = matchKeywords(event, config);

    // LLMマッチング (キーワードマッチした場合、または登壇可能性がある場合)
    let interestMatch = keywordResult;
    if (
      config.llm.enabled &&
      (keywordResult.is_match || enrichedEvent.speaker_opportunity?.has_opportunity)
    ) {
      interestMatch = await llmMatcher.matchInterest(event, keywordResult);
    }

    enrichedEvent.interest_match = interestMatch;

    // マッチしない場合はスキップ
    if (!interestMatch.is_match && !enrichedEvent.speaker_opportunity?.has_opportunity) {
      eventRepo.markProcessed({
        eventId: event.id,
        hasSpeakerOpportunity: false,
        hasInterestMatch: false,
        interestScore: interestMatch.score,
      });
      results.push({ event: enrichedEvent, action: "no_match" });
      continue;
    }

    // カレンダーに登録
    let calendarEventId: string | undefined;
    if (!options.dryRun && config.google_calendar.enabled) {
      try {
        const isAuth = await calendarClient.isAuthenticated();
        if (isAuth) {
          // 重複チェック
          const exists = await calendarClient.eventExists(enrichedEvent);
          if (!exists) {
            calendarEventId = (await calendarClient.addEvent(enrichedEvent)) ?? undefined;
          }
        }
      } catch (error) {
        logger.error({ error, eventId: event.id }, "Failed to register to calendar");
      }
    }

    // 処理済みとしてマーク
    eventRepo.markProcessed({
      eventId: event.id,
      hasSpeakerOpportunity: enrichedEvent.speaker_opportunity?.has_opportunity ?? false,
      hasInterestMatch: interestMatch.is_match,
      interestScore: interestMatch.score,
      ...(calendarEventId ? { calendarEventId } : {}),
    });

    const result: ScanResult = {
      event: enrichedEvent,
      action: calendarEventId ? "registered" : "skipped",
    };
    if (calendarEventId) {
      result.calendarEventId = calendarEventId;
    }
    results.push(result);
  }

  db.close();
  return results;
}

/**
 * 結果を表示
 */
function displayResults(results: ScanResult[], json: boolean): void {
  const matched = results.filter((r) => r.action === "registered" || r.action === "skipped");

  if (json) {
    console.log(
      JSON.stringify(
        matched.map((r) => ({
          id: r.event.id,
          title: r.event.title,
          url: r.event.url,
          started_at: r.event.started_at,
          is_online: r.event.is_online,
          speaker_opportunity: r.event.speaker_opportunity,
          interest_match: r.event.interest_match,
          action: r.action,
          calendar_event_id: r.calendarEventId,
        })),
        null,
        2,
      ),
    );
    return;
  }

  console.log("\n=== Scan Results ===\n");
  console.log(`Total events: ${results.length}`);
  console.log(`Matched: ${matched.length}`);
  console.log(
    `Already processed: ${results.filter((r) => r.action === "already_processed").length}`,
  );
  console.log(`No match: ${results.filter((r) => r.action === "no_match").length}`);
  console.log();

  if (matched.length === 0) {
    console.log("No matching events found.");
    return;
  }

  console.log("Matched Events:");
  console.log("-".repeat(80));

  for (const result of matched) {
    const { event } = result;
    const speakerIcon = event.speaker_opportunity?.has_opportunity ? "" : "";
    const locationIcon = event.is_online ? "" : "";

    console.log(`\n${speakerIcon} ${event.title}`);
    console.log(`   ${locationIcon} ${event.place ?? "オンライン"}`);
    console.log(`    ${event.started_at}`);
    console.log(`    ${event.url}`);

    if (event.speaker_opportunity?.has_opportunity) {
      console.log(`    登壇機会: ${event.speaker_opportunity.detected_keywords.join(", ")}`);
    }

    if (event.interest_match) {
      console.log(`    スコア: ${event.interest_match.score}/100`);
      if (event.interest_match.llm_reason) {
        console.log(`    理由: ${event.interest_match.llm_reason}`);
      }
    }

    if (result.action === "registered") {
      console.log(`   ✅ カレンダーに登録済み`);
    } else if (result.action === "skipped") {
      console.log(`   ⏭️ スキップ (dry-run または認証なし)`);
    }
  }

  console.log("\n" + "-".repeat(80));
}

// CLI コマンド定義
program
  .name("connpass-watcher")
  .description("Monitor connpass events for speaking opportunities and interests")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan connpass events once")
  .option("-c, --config <path>", "Path to config file")
  .option("--dry-run", "Show results without registering to calendar")
  .option("--json", "Output results as JSON")
  .action(async (options: ScanOptions) => {
    try {
      const config = loadConfig(options.config);
      logger.info("Starting scan...");

      const results = await scanEvents(config, options);
      displayResults(results, options.json ?? false);

      logger.info("Scan completed");
    } catch (error) {
      logger.error(error, "Scan failed");
      process.exit(1);
    }
  });

program
  .command("auth")
  .description("Authenticate with Google Calendar")
  .action(async () => {
    try {
      const config = loadConfig();
      const calendarClient = new GoogleCalendarClient(config);

      const isAuth = await calendarClient.isAuthenticated();
      if (isAuth) {
        console.log("Already authenticated with Google Calendar.");
        return;
      }

      await calendarClient.authenticate();
      console.log("\nGoogle Calendar authentication successful!");
    } catch (error) {
      logger.error(error, "Authentication failed");
      process.exit(1);
    }
  });

program
  .command("daemon")
  .description("Run as a daemon with scheduled execution")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    try {
      const config = loadConfig(options.config);

      if (!config.schedule.cron) {
        console.error("Error: No cron schedule configured in config file.");
        console.error("Add 'schedule.cron' to your config.yaml");
        process.exit(1);
      }

      logger.info({ cron: config.schedule.cron }, "Starting daemon mode");
      console.log(`\nScheduled to run: ${config.schedule.cron}`);
      console.log("Press Ctrl+C to stop.\n");

      // 初回実行
      console.log("Running initial scan...");
      const results = await scanEvents(config, { dryRun: false });
      displayResults(results, false);

      // スケジュール実行
      schedule.scheduleJob(config.schedule.cron, async () => {
        logger.info("Running scheduled scan...");
        try {
          const results = await scanEvents(config, { dryRun: false });
          const matched = results.filter(
            (r) => r.action === "registered" || r.action === "skipped",
          );
          logger.info(
            { total: results.length, matched: matched.length },
            "Scheduled scan completed",
          );
        } catch (error) {
          logger.error(error, "Scheduled scan failed");
        }
      });

      // プロセスを維持
      process.on("SIGINT", () => {
        logger.info("Shutting down daemon...");
        schedule.gracefulShutdown().then(() => {
          process.exit(0);
        });
      });
    } catch (error) {
      logger.error(error, "Daemon failed");
      process.exit(1);
    }
  });

program.parse();
