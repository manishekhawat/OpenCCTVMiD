/** Pure helpers for the login HTTP flow — kept free of native imports so
 * they can be tested under Jest. */
import type { Params } from './crypto';

export const encodeParams = (params: Params): string =>
  params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

/**
 * Splits a Set-Cookie value that the native layer joined with ", ". Commas
 * also appear inside Expires dates ("Wed, 01-Jan-2031 ..."), so a comma only
 * starts a new cookie when it is followed by `name=`.
 */
export function parseSetCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const cookie of header.split(/,\s*(?=[^;,=\s]+=)/)) {
    const pair = cookie.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

/** Strips the "&&&START&&&" guard Xiaomi's account API puts before JSON. */
export function parseAccountJson(text: string): Record<string, any> | null {
  const body = text.replace(/^&&&START&&&/, '').trim();
  if (!body.startsWith('{')) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export const resolveUrl = (location: string, base: string): string => {
  if (/^https?:\/\//i.test(location)) return location;
  const origin = base.match(/^https?:\/\/[^/]+/i)?.[0] ?? '';
  return location.startsWith('/') ? origin + location : `${origin}/${location}`;
};
