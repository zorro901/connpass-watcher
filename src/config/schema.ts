import { z } from "zod";

export const configSchema = z.object({
  connpass: z.object({
    api_key: z.string().min(1, "connpass API key is required"),
    prefectures: z.array(z.string()).default(["tokyo"]),
    include_online: z.boolean().default(true),
    months_ahead: z.number().min(1).max(12).default(2),
  }),

  interests: z
    .object({
      keywords: z.array(z.string()).default([]),
      profile: z.string().optional(),
    })
    .default({}),

  speaker: z
    .object({
      check_participant_types: z.boolean().default(true),
      check_cfp: z.boolean().default(true),
    })
    .default({}),

  llm: z
    .object({
      enabled: z.boolean().default(true),
      provider: z.enum(["anthropic", "openai", "google", "ollama"]).default("anthropic"),
      model: z.string().optional(),
      api_key: z.string().optional(),
      base_url: z.string().optional(),
    })
    .default({}),

  google_calendar: z
    .object({
      calendar_id: z.string().default("primary"),
      enabled: z.boolean().default(true),
    })
    .default({}),

  schedule: z
    .object({
      cron: z.string().optional(),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;

export const defaultConfig: Config = configSchema.parse({});
