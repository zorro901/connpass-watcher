import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import type { Config } from "../config/schema.js";
import type { EnrichedEvent } from "../connpass/types.js";
import { createChildLogger } from "../utils/logger.js";
import { googleCalendarRateLimiter } from "../utils/rate-limiter.js";

const logger = createChildLogger("calendar:google");

const APP_DIR = ".connpass-watcher";
const CREDENTIALS_FILE = "credentials.json";
const TOKEN_FILE = "tokens.json";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

interface Credentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

interface Tokens {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

/**
 * Google Calendar クライアント
 */
export class GoogleCalendarClient {
  private config: Config;
  private oauth2Client: OAuth2Client | null = null;
  private appDir: string;

  constructor(config: Config) {
    this.config = config;
    this.appDir = join(homedir(), APP_DIR);

    // アプリディレクトリを作成
    if (!existsSync(this.appDir)) {
      mkdirSync(this.appDir, { recursive: true });
    }
  }

  /**
   * credentials.json のパスを取得
   */
  private get credentialsPath(): string {
    return join(this.appDir, CREDENTIALS_FILE);
  }

  /**
   * tokens.json のパスを取得
   */
  private get tokensPath(): string {
    return join(this.appDir, TOKEN_FILE);
  }

  /**
   * 認証情報を読み込み
   */
  private loadCredentials(): Credentials {
    if (!existsSync(this.credentialsPath)) {
      throw new Error(
        `Credentials file not found. Please download it from Google Cloud Console and save to: ${this.credentialsPath}`,
      );
    }

    const content = readFileSync(this.credentialsPath, "utf-8");
    return JSON.parse(content) as Credentials;
  }

  /**
   * トークンを読み込み
   */
  private loadTokens(): Tokens | null {
    if (!existsSync(this.tokensPath)) {
      return null;
    }

    const content = readFileSync(this.tokensPath, "utf-8");
    return JSON.parse(content) as Tokens;
  }

  /**
   * トークンを保存
   */
  private saveTokens(tokens: Tokens): void {
    writeFileSync(this.tokensPath, JSON.stringify(tokens, null, 2));
    logger.debug("Tokens saved");
  }

  /**
   * OAuth2クライアントを初期化
   */
  private async initOAuth2Client(): Promise<OAuth2Client> {
    if (this.oauth2Client) {
      return this.oauth2Client;
    }

    const credentials = this.loadCredentials();
    const config = credentials.installed ?? credentials.web;

    if (!config) {
      throw new Error("Invalid credentials file format");
    }

    this.oauth2Client = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
      "http://localhost:3000/oauth2callback",
    );

    // 保存済みトークンがあれば使用
    const tokens = this.loadTokens();
    if (tokens) {
      this.oauth2Client.setCredentials(tokens);
      logger.debug("Using saved tokens");
    }

    return this.oauth2Client;
  }

  /**
   * 認証済みかどうかを確認
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const client = await this.initOAuth2Client();
      const tokens = this.loadTokens();

      if (!tokens?.refresh_token) {
        return false;
      }

      // トークンをリフレッシュしてみる
      client.setCredentials(tokens);
      await client.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ブラウザで認証フローを開始
   */
  async authenticate(): Promise<void> {
    const client = await this.initOAuth2Client();

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });

    console.log("\n=== Google Calendar Authentication ===");
    console.log("\n1. Open this URL in your browser:");
    console.log(`\n   ${authUrl}\n`);
    console.log("2. Authorize the application");
    console.log("3. You will be redirected to localhost:3000");
    console.log("\nWaiting for authorization...\n");

    // ローカルサーバーでコールバックを受け取る
    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "", "http://localhost:3000");

        if (url.pathname === "/oauth2callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<h1>認証エラー</h1><p>${error}</p>`);
            server.close();
            reject(new Error(`Authorization error: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`
              <html>
                <head><title>認証成功</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                  <h1>認証成功!</h1>
                  <p>このウィンドウを閉じてください。</p>
                </body>
              </html>
            `);
            server.close();
            resolve(code);
            return;
          }
        }

        res.writeHead(404);
        res.end("Not found");
      });

      server.listen(3000, () => {
        logger.debug("OAuth callback server listening on port 3000");
      });

      // タイムアウト (5分)
      setTimeout(
        () => {
          server.close();
          reject(new Error("Authentication timeout"));
        },
        5 * 60 * 1000,
      );
    });

    // コードをトークンに交換
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    // トークンを保存 (JSON形式なのでnullは除外される)
    this.saveTokens(tokens as unknown as Tokens);

    console.log("Authentication successful!");
    logger.info("Google Calendar authentication completed");
  }

  /**
   * カレンダーにイベントを追加
   */
  async addEvent(event: EnrichedEvent): Promise<string | null> {
    if (!this.config.google_calendar.enabled) {
      logger.debug({ eventId: event.id }, "Calendar integration disabled");
      return null;
    }

    const client = await this.initOAuth2Client();
    const calendar = google.calendar({ version: "v3", auth: client });

    // イベントの説明文を作成
    const description = [
      `connpass URL: ${event.url}`,
      "",
      event.speaker_opportunity?.has_opportunity ? "登壇可能性: あり" : "",
      event.interest_match?.llm_reason
        ? `興味マッチング理由: ${event.interest_match.llm_reason}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const calendarEvent = {
      summary: `[connpass] ${event.title}`,
      description,
      location: event.place ?? null,
      start: {
        dateTime: event.started_at,
        timeZone: "Asia/Tokyo",
      },
      end: {
        dateTime: event.ended_at,
        timeZone: "Asia/Tokyo",
      },
      source: {
        title: "connpass",
        url: event.url,
      },
    };

    try {
      const result = await googleCalendarRateLimiter.schedule(() =>
        calendar.events.insert({
          calendarId: this.config.google_calendar.calendar_id,
          requestBody: calendarEvent,
        }),
      );

      const calendarEventId = result.data.id;
      logger.info(
        {
          eventId: event.id,
          calendarEventId,
        },
        "Event added to Google Calendar",
      );

      return calendarEventId ?? null;
    } catch (error) {
      logger.error({ error, eventId: event.id }, "Failed to add event to calendar");
      throw error;
    }
  }

  /**
   * 既存のイベントかどうかをチェック (タイトルと日時で判定)
   */
  async eventExists(event: EnrichedEvent): Promise<boolean> {
    const client = await this.initOAuth2Client();
    const calendar = google.calendar({ version: "v3", auth: client });

    try {
      const result = await googleCalendarRateLimiter.schedule(() =>
        calendar.events.list({
          calendarId: this.config.google_calendar.calendar_id,
          timeMin: event.started_at,
          timeMax: event.ended_at,
          q: event.title,
          maxResults: 10,
        }),
      );

      const events = result.data.items ?? [];
      const exists = events.some((e) => e.summary?.includes(event.title));

      if (exists) {
        logger.debug({ eventId: event.id }, "Event already exists in calendar");
      }

      return exists;
    } catch (error) {
      logger.error({ error }, "Failed to check existing events");
      return false; // エラー時は存在しないとみなす
    }
  }
}
