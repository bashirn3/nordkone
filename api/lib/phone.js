import { parsePhoneNumberFromString } from 'libphonenumber-js';

const PHONE_CANDIDATE_RE = /(?:\+358|00358|0)\s*(?:4\d|5\d|[1-9])(?:[\s().-]*\d){5,11}/g;

export function extractPhoneCandidates(text = '') {
  const matches = String(text).match(PHONE_CANDIDATE_RE) || [];
  return [...new Set(matches.map((value) => value.trim()))].filter(Boolean);
}

export function normalizePhone(value) {
  if (!value) return null;

  let cleaned = String(value)
    .replace(/\b(?:puh|tel|phone|gsm|whatsapp|wa)\b[:.]?/gi, '')
    .replace(/[^\d+]/g, '')
    .replace(/^00358/, '+358');

  if (!cleaned.startsWith('+') && /^(234|358|44)\d{6,14}$/.test(cleaned)) {
    cleaned = `+${cleaned}`;
  }

  const phone = parsePhoneNumberFromString(cleaned, 'FI');
  if (!phone || !phone.isValid()) return null;

  return phone.number;
}

export function firstValidPhone(values = []) {
  for (const value of values) {
    const normalized = normalizePhone(value);
    if (normalized) {
      return {
        raw: value,
        normalized,
      };
    }
  }

  return null;
}
