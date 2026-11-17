import { get, list, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

const SETTINGS_PREFIX = 'bankshield/settings/quiz-config-';
export const DEFAULT_QUIZ_SETTINGS = Object.freeze({ questionCount: 25, timeLimitMinutes: 15 });
export const MAX_QUESTIONS = 93;

function validSettings(value) {
  return value && Number.isInteger(value.questionCount) && value.questionCount >= 5 && value.questionCount <= MAX_QUESTIONS &&
    Number.isInteger(value.timeLimitMinutes) && value.timeLimitMinutes >= 1 && value.timeLimitMinutes <= 180;
}

export async function readQuizSettings() {
  let blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: SETTINGS_PREFIX, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const blob = latest ? await get(latest.pathname, { access: 'private' }) : null;
  if (!blob) return { ...DEFAULT_QUIZ_SETTINGS };
  const saved = JSON.parse(await new Response(blob.stream).text());
  // Clamp settings saved before subjective questions were removed.
  if (!saved || !Number.isInteger(saved.questionCount) || saved.questionCount < 5 ||
      !Number.isInteger(saved.timeLimitMinutes) || saved.timeLimitMinutes < 1 || saved.timeLimitMinutes > 180) {
    throw new Error('Stored quiz settings are invalid.');
  }
  return { questionCount: Math.min(saved.questionCount, MAX_QUESTIONS), timeLimitMinutes: saved.timeLimitMinutes };
}

export async function writeQuizSettings(value) {
  if (!validSettings(value)) {
    throw Object.assign(new Error(`Questions must be 5–${MAX_QUESTIONS}; time must be 1–180 minutes.`), { status: 400 });
  }
  const settings = { questionCount: value.questionCount, timeLimitMinutes: value.timeLimitMinutes, updatedAt: new Date().toISOString() };
  await put(`${SETTINGS_PREFIX}${Date.now()}-${randomUUID()}.json`, JSON.stringify(settings), {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
  });
  return { questionCount: settings.questionCount, timeLimitMinutes: settings.timeLimitMinutes };
}

