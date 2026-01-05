import Bottleneck from "bottleneck";

// Claude API rate limiter: 5 requests per minute for free tier
export const claudeRateLimiter = new Bottleneck({
  minTime: 12000, // 12 seconds between requests (5 per minute)
  maxConcurrent: 1,
});

// connpass API rate limiter: be respectful, 1 request per 2 seconds
export const connpassRateLimiter = new Bottleneck({
  minTime: 2000,
  maxConcurrent: 1,
});

// Google Calendar API rate limiter
export const googleCalendarRateLimiter = new Bottleneck({
  minTime: 500,
  maxConcurrent: 2,
});
