import ReactNativeBlobUtil from 'react-native-blob-util';

import type { Params } from './crypto';
import { encodeParams } from './parse';

export { encodeParams, parseAccountJson, parseSetCookie, resolveUrl } from './parse';

/**
 * HTTP for the Xiaomi login, on react-native-blob-util rather than fetch.
 *
 * The login needs two things React Native's fetch cannot do: stop at a
 * redirect to read its Location header, and read headers off a 302 — the
 * two-step-verification path delivers `ssecurity` in an `extension-pragma`
 * header on a redirect. fetch always follows redirects and only shows the
 * last response. blob-util exposes `followRedirect: false` and every header.
 *
 * Cookies are tracked here, by name, and sent explicitly — the same model as
 * the Python extractor's requests.Session. Android's native cookie jar also
 * sees these responses and may add the same cookies; since it learns them
 * from the same Set-Cookie headers, the two agree.
 */

export interface HttpResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  text: string;
  base64?: string;
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  url: string;
  query?: Params;
  form?: Params;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  /** Return the body as base64 (binary, e.g. a captcha image). */
  binary?: boolean;
}

export async function request(req: HttpRequest): Promise<HttpResponse> {
  let url = req.url;
  if (req.query?.length) url += (url.includes('?') ? '&' : '?') + encodeParams(req.query);

  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  const cookieEntries = Object.entries(req.cookies ?? {}).filter(([, v]) => v !== undefined && v !== '');
  if (cookieEntries.length) headers.Cookie = cookieEntries.map(([k, v]) => `${k}=${v}`).join('; ');

  let body: string | undefined;
  if (req.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeParams(req.form);
  }

  const res = await ReactNativeBlobUtil.config({ followRedirect: false, timeout: 20000 }).fetch(
    req.method ?? 'GET',
    url,
    headers,
    body,
  );

  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.info().headers ?? {})) lowered[k.toLowerCase()] = String(v);

  return {
    status: res.info().status,
    headers: lowered,
    text: req.binary ? '' : await res.text(),
    base64: req.binary ? await res.base64() : undefined,
  };
}
