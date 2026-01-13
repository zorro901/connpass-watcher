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
import { LLMMatcher } from "./matcher/llm.js";
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
  action: "registered" | "updated" | "skipped" | "already_processed" | "excluded" | "filtered" | "no_match";
  calendarEventId?: string;
  colorId?: string;
  category?: "popular" | "speaker" | "interest";
}

/**
 * 除外キーワードに該当するかチェック
 */
function shouldExclude(event: EnrichedEvent, excludeKeywords: string[]): boolean {
  const title = event.title.toLowerCase();
  return excludeKeywords.some((kw) => title.includes(kw.toLowerCase()));
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

  const minParticipants = config.interests.min_participants;
  const excludeKeywords = config.interests.exclude_keywords;

  // 各イベントを処理
  for (const event of events) {
    // event は既に EnrichedEvent で is_online, is_tokyo が設定済み

    // 処理済みチェック & 更新検知
    const isProcessed = eventRepo.isProcessed(event.id);
    const needsReprocessing = isProcessed && eventRepo.needsReprocessing(event.id, event.updated_at);
    const existingRecord = isProcessed ? eventRepo.getProcessedEvent(event.id) : null;

    if (isProcessed && !needsReprocessing) {
      results.push({ event, action: "already_processed" });
      continue;
    }

    if (needsReprocessing) {
      logger.info({ eventId: event.id, title: event.title }, "Event updated, reprocessing");
    }

    // 2. 除外キーワードチェック
    if (shouldExclude(event, excludeKeywords)) {
      logger.debug({ eventId: event.id, title: event.title }, "Excluded by keyword");
      results.push({ event, action: "excluded" });
      continue;
    }

    // 3. 人気イベント判定 (50人以上)
    const isPopular = event.accepted >= minParticipants;

    let hasSpeakerOpportunity = false;
    let isInterested = false;

    if (isPopular) {
      // 人気イベントはLLM判定なしで興味ありとみなす
      isInterested = true;
      event.interest_match = {
        is_match: true,
        score: 80,
        keyword_matches: [`人気(${event.accepted}人)`],
      };
      logger.info({ eventId: event.id, title: event.title, accepted: event.accepted }, "Popular event");
    } else {
      // 4. 50人以下はLLMで判断
      const llmResult = await llmMatcher.analyzeEvent(event);
      event.interest_match = llmResult.interest;
      event.speaker_opportunity = llmResult.speaker;
      hasSpeakerOpportunity = llmResult.speaker.has_opportunity;
      isInterested = llmResult.interest.is_match;
    }

    // マッチしない場合はスキップ
    if (!isInterested && !hasSpeakerOpportunity) {
      eventRepo.markProcessed({
        eventId: event.id,
        hasSpeakerOpportunity: false,
        hasInterestMatch: false,
        interestScore: event.interest_match?.score ?? 0,
        connpassUpdatedAt: event.updated_at,
      });
      results.push({ event, action: "no_match" });
      continue;
    }

    // カテゴリと色の決定 (優先順: 登壇 > 人気 > 興味)
    let category: "popular" | "speaker" | "interest";
    if (hasSpeakerOpportunity) {
      category = "speaker";
    } else if (isPopular) {
      category = "popular";
    } else {
      category = "interest";
    }

    const colorId = calendarClient.getColorId({
      hasSpeakerOpportunity,
      isPopular,
    });

    // カレンダーに登録または更新 (upsert: 既存イベントがあれば更新)
    let calendarEventId: string | undefined = existingRecord?.calendar_event_id ?? undefined;
    let calendarAction: "created" | "updated" | "skipped" = "skipped";

    if (!options.dryRun && config.google_calendar.enabled) {
      try {
        const isAuth = await calendarClient.isAuthenticated();
        if (isAuth) {
          // upsertEvent: 既存イベントがあれば更新、なければ新規作成
          const upsertResult = await calendarClient.upsertEvent(event, colorId ? { colorId } : undefined);
          calendarEventId = upsertResult.calendarEventId ?? undefined;
          calendarAction = upsertResult.action;

          if (calendarAction === "created") {
            logger.info({ eventId: event.id, calendarEventId }, "Calendar event created");
          } else if (calendarAction === "updated") {
            logger.info({ eventId: event.id, calendarEventId }, "Calendar event updated");
          }
        }
      } catch (error) {
        logger.error({ error, eventId: event.id }, "Failed to register/update calendar");
      }
    }

    // 処理済みとしてマーク
    eventRepo.markProcessed({
      eventId: event.id,
      hasSpeakerOpportunity,
      hasInterestMatch: isInterested,
      interestScore: event.interest_match?.score ?? 0,
      connpassUpdatedAt: event.updated_at,
      ...(calendarEventId ? { calendarEventId } : {}),
    });

    // アクションを決定
    let action: ScanResult["action"];
    if (calendarAction === "updated") {
      action = "updated";
    } else if (calendarAction === "created") {
      action = "registered";
    } else {
      action = "skipped";
    }

    const result: ScanResult = {
      event,
      action,
      category,
    };
    if (colorId) {
      result.colorId = colorId;
    }
    if (calendarEventId) {
      result.calendarEventId = calendarEventId;
    }
    results.push(result);
  }

  db.close();
  return results;
}

/**
 * カテゴリのアイコンを取得
 */
function getCategoryIcon(category?: "popular" | "speaker" | "interest"): string {
  switch (category) {
    case "speaker":
      return "🎤"; // ブルーベリー
    case "popular":
      return "🔥"; // みかん
    case "interest":
      return "💡"; // デフォルト
    default:
      return "📅";
  }
}

/**
 * 結果を表示
 */
function displayResults(results: ScanResult[], json: boolean): void {
  const matched = results.filter((r) => r.action === "registered" || r.action === "updated" || r.action === "skipped");

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
          category: r.category,
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
  console.log(`  🎤 Speaker: ${matched.filter((r) => r.category === "speaker").length}`);
  console.log(`  🔥 Popular: ${matched.filter((r) => r.category === "popular").length}`);
  console.log(`  💡 Interest: ${matched.filter((r) => r.category === "interest").length}`);
  console.log(`  ✅ Registered: ${results.filter((r) => r.action === "registered").length}`);
  console.log(`  🔄 Updated: ${results.filter((r) => r.action === "updated").length}`);
  console.log(`Filtered: ${results.filter((r) => r.action === "filtered").length}`);
  console.log(`Excluded: ${results.filter((r) => r.action === "excluded").length}`);
  console.log(`Already processed: ${results.filter((r) => r.action === "already_processed").length}`);
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
    const categoryIcon = getCategoryIcon(result.category);
    const locationIcon = event.is_online ? "🌐" : "📍";

    console.log(`\n${categoryIcon} ${event.title}`);
    console.log(`   ${locationIcon} ${event.place ?? "オンライン"}`);
    console.log(`   📅 ${event.started_at}`);
    console.log(`   🔗 ${event.url}`);
    console.log(`   👥 ${event.accepted}人参加`);

    if (event.speaker_opportunity?.has_opportunity) {
      console.log(`   🎤 登壇機会: ${event.speaker_opportunity.detected_keywords.join(", ")}`);
    }

    if (event.interest_match) {
      console.log(`   📊 スコア: ${event.interest_match.score}/100`);
      if (event.interest_match.llm_reason) {
        console.log(`   💬 理由: ${event.interest_match.llm_reason}`);
      }
    }

    if (result.action === "registered") {
      console.log(`   ✅ カレンダーに登録済み`);
    } else if (result.action === "updated") {
      console.log(`   🔄 カレンダーを更新済み`);
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
