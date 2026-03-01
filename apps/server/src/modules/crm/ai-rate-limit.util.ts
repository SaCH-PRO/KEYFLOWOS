import { HttpException, HttpStatus } from '@nestjs/common';

const AI_RATE_LIMIT = 10;
const AI_RATE_WINDOW_MS = 60_000;
const aiRateMap = new Map<string, number[]>();

export function checkAiRateLimit(businessId: string) {
  const now = Date.now();
  const timestamps = (aiRateMap.get(businessId) ?? []).filter((t) => now - t < AI_RATE_WINDOW_MS);
  if (timestamps.length >= AI_RATE_LIMIT) {
    throw new HttpException('AI rate limit exceeded. Please wait a moment before trying again.', HttpStatus.TOO_MANY_REQUESTS);
  }
  timestamps.push(now);
  aiRateMap.set(businessId, timestamps);
}
