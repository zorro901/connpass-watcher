import { z } from "zod";

export const configSchema = z.object({
  connpass: z.object({
    api_key: z.string().min(1, "connpass API key is required"),
    prefectures: z.array(z.string()).default(["tokyo"]),
    include_online: z.boolean().default(true),
    // 検索期間: hours_ahead > weeks_ahead > months_ahead の優先順
    months_ahead: z.number().min(1).max(12).optional(),
    weeks_ahead: z.number().min(1).max(52).optional(),
    hours_ahead: z.number().min(1).max(168).optional(), // 最大1週間（168時間）
  }),

  interests: z
    .object({
      keywords: z.array(z.string()).default([]),
      // 除外キーワード（タイトルに含まれていたらスキップ）
      exclude_keywords: z.array(z.string()).default([]),
      profile: z.string().optional(),
      // 参加者数がこの値以上なら人気イベントとして興味ありとみなす
      min_participants: z.number().min(0).default(50),
    })
    .default({}),

  llm: z
    .object({
      enabled: z.boolean().default(true),
      provider: z.enum(["anthropic", "openai", "google", "ollama", "openrouter"]).default("anthropic"),
      model: z.string().optional(),
      api_key: z.string().optional(),
      base_url: z.string().optional(),
    })
    .default({}),

  google_calendar: z
    .object({
      enabled: z.boolean().default(true),
      calendar_id: z.string().default("primary"),
      // Google Calendar の色ID
      // 6: Tangerine (みかん), 9: Blueberry (ブルーベリー)
      color_popular: z.string().default("6"), // 人気イベント
      color_speaker: z.string().default("9"), // 登壇機会あり
      // 興味マッチのみはデフォルト色（colorIdなし）
    })
    .default({}),

  schedule: z
    .object({
      cron: z.string().optional(),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
