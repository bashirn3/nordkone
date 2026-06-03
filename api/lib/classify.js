const INTERESTED_RE = /\b(kylla|kyllä|joo|juu|on kaupan|edelleen|soita|tarjous|kiinnostaa|voitte soittaa)\b/i;
const SOLD_RE = /\b(myyty|meni jo|ei ole enää|ei ole enaa|kaupat tehty)\b/i;
const NOT_INTERESTED_RE = /\b(ei kiinnosta|en myy|älä|ala laita|lopeta|poista|ei viesteja|ei viestejä)\b/i;

export function classifyInbound(message = '') {
  const text = String(message).toLowerCase();

  if (NOT_INTERESTED_RE.test(text)) {
    return { classification: 'opted_out', needs_human: false };
  }

  if (SOLD_RE.test(text)) {
    return { classification: 'sold', needs_human: false };
  }

  if (INTERESTED_RE.test(text)) {
    return { classification: 'interested', needs_human: true };
  }

  return { classification: 'unclear', needs_human: true };
}
