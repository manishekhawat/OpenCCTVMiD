import { decryptResponse, encryptRequest, makeNonce, passwordHash } from './crypto';
import {
  type HttpResponse,
  parseAccountJson,
  parseSetCookie,
  request,
  resolveUrl,
} from './http';

/**
 * Xiaomi account login and device listing, done inside the app.
 *
 * Follows the request sequence of PiotrMachowski/Xiaomi-cloud-tokens-extractor
 * — which produced the working token for this camera — with go2rtc's
 * pkg/xiaomi/cloud.go as a second reference for the parts the two handle
 * differently (phone verification, captcha during verification, collecting
 * cookies and ssecurity across the redirect chain).
 *
 * Nothing here is stored. The password is used for one request and dropped;
 * the session lives in memory until the app closes. What the user keeps is
 * the device token, as before — the cloud is only a way to fetch it.
 */

export const SERVERS = ['cn', 'de', 'us', 'ru', 'tw', 'sg', 'in', 'i2'] as const;
export type Server = (typeof SERVERS)[number];

export type LoginStep =
  | { kind: 'done' }
  | { kind: 'captcha'; imageBase64: string }
  | { kind: 'verify'; via: 'email' | 'phone'; target: string };

export interface CloudDevice {
  did: string;
  name: string;
  model: string;
  ip: string;
  mac: string;
  token: string;
  server: Server;
}

export class CloudError extends Error {}

const ACCOUNT = 'https://account.xiaomi.com';
const SID = 'xiaomiio';
const LOCALE = 'en_US';

const randomLetters = (n: number, from = 97, to = 122) =>
  Array.from({ length: n }, () => String.fromCharCode(from + Math.floor(Math.random() * (to - from + 1)))).join('');

/** Explains the codes users actually hit, instead of echoing JSON. */
function explainCode(json: Record<string, any> | null, fallback: string): string {
  const code = json?.code;
  if (code === 70016) return 'Wrong username or password.';
  if (code === 87001) return 'The captcha was wrong. Try again.';
  if (code === 70014) return 'That verification code is wrong or has expired.';
  const desc = json?.desc || json?.description || json?.message;
  return desc ? `${fallback} (${code ?? '?'}: ${desc})` : fallback;
}

export class XiaomiCloud {
  private cookies: Record<string, string> = {};
  private readonly agent = `${randomLetters(18)}-${randomLetters(13, 65, 69)} APP/com.xiaomi.mihome APPV/10.5.201`;
  private readonly deviceId = randomLetters(6);

  private username = '';
  private password = '';
  private sign = '';
  private captchaCode = '';

  // two-step verification
  private context = '';
  private verifyName: 'Email' | 'Phone' = 'Email';
  private flag = '8';
  private stage: 'login' | 'verify' = 'login';

  // the session
  private ssecurity = '';
  private serviceToken = '';
  userId = '';

  get loggedIn(): boolean {
    return Boolean(this.ssecurity && this.serviceToken && this.userId);
  }

  // --- plumbing -------------------------------------------------------------

  private async call(req: Parameters<typeof request>[0]): Promise<HttpResponse> {
    const res = await request({
      ...req,
      headers: { 'User-Agent': this.agent, ...(req.headers ?? {}) },
      cookies: {
        sdkVersion: 'accountsdk-18.8.15',
        deviceId: this.deviceId,
        ...this.cookies,
        ...(req.cookies ?? {}),
      },
    });
    this.absorb(res);
    return res;
  }

  private absorb(res: HttpResponse) {
    for (const [k, v] of Object.entries(parseSetCookie(res.headers['set-cookie']))) {
      if (!v || v === 'EXPIRED' || v === 'deleted') delete this.cookies[k];
      else this.cookies[k] = v;
    }
    const pragma = res.headers['extension-pragma'];
    if (pragma) {
      try {
        const p = JSON.parse(pragma);
        if (p.ssecurity) this.ssecurity = p.ssecurity;
      } catch {
        // Not JSON; ignore.
      }
    }
  }

  /**
   * Walks a redirect chain one hop at a time, absorbing cookies and the
   * extension-pragma header at every hop — serviceToken, userId and ssecurity
   * can each arrive on a different one.
   */
  private async follow(start: string): Promise<HttpResponse> {
    let url = start;
    let retriedTips = false;
    for (let hop = 0; hop < 12; hop++) {
      const res = await this.call({ url });
      // Auth2/end sometimes serves an HTML "Tips" page first and the 302 on a
      // second request. The extractor handles it the same way.
      if (res.status === 200 && !retriedTips && res.text.includes('Xiaomi Account - Tips')) {
        retriedTips = true;
        continue;
      }
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        url = resolveUrl(location, url);
        continue;
      }
      return res;
    }
    throw new CloudError('Too many redirects while finishing the login.');
  }

  private async finish(location: string, json?: Record<string, any> | null): Promise<LoginStep> {
    if (json?.ssecurity) this.ssecurity = json.ssecurity;
    if (json?.userId) this.userId = String(json.userId);
    await this.follow(location);

    this.serviceToken = this.cookies.serviceToken ?? '';
    if (!this.userId && this.cookies.userId) this.userId = this.cookies.userId;

    if (!this.loggedIn) {
      const missing = [
        !this.ssecurity && 'ssecurity',
        !this.serviceToken && 'serviceToken',
        !this.userId && 'userId',
      ].filter(Boolean);
      throw new CloudError(
        `Xiaomi accepted the login but did not hand back ${missing.join(', ')}. ` +
          `This is the step that could not be tested from here — please send a screenshot.`,
      );
    }
    this.password = '';
    return { kind: 'done' };
  }

  private async captcha(captchaUrl: string): Promise<LoginStep> {
    const res = await this.call({ url: resolveUrl(captchaUrl, ACCOUNT), binary: true });
    return { kind: 'captcha', imageBase64: res.base64 ?? '' };
  }

  // --- login ----------------------------------------------------------------

  async login(username: string, password: string): Promise<LoginStep> {
    this.username = username.trim();
    this.password = password;
    this.captchaCode = '';
    this.stage = 'login';

    const step1 = await this.call({
      url: `${ACCOUNT}/pass/serviceLogin`,
      query: [['sid', SID], ['_json', 'true']],
      cookies: { userId: this.username },
    });
    const j1 = parseAccountJson(step1.text);
    if (!j1) throw new CloudError(`Xiaomi's login page answered unexpectedly (HTTP ${step1.status}).`);

    // A session left in Android's cookie jar from an earlier login can make
    // this step succeed outright.
    if (j1.ssecurity && j1.location) return this.finish(j1.location, j1);

    this.sign = j1._sign ?? '';
    if (!this.sign) throw new CloudError(explainCode(j1, 'Xiaomi did not start a login for this username.'));
    return this.submitPassword();
  }

  private async submitPassword(): Promise<LoginStep> {
    const form: [string, string][] = [
      ['sid', SID],
      ['hash', passwordHash(this.password)],
      ['callback', 'https://sts.api.io.mi.com/sts'],
      ['qs', '%3Fsid%3Dxiaomiio%26_json%3Dtrue'],
      ['user', this.username],
      ['_sign', this.sign],
      ['_json', 'true'],
    ];
    if (this.captchaCode) form.push(['captCode', this.captchaCode]);

    const res = await this.call({ method: 'POST', url: `${ACCOUNT}/pass/serviceLoginAuth2`, form });
    const json = parseAccountJson(res.text);
    if (!json) throw new CloudError(`The password step answered unexpectedly (HTTP ${res.status}).`);

    const captchaUrl = json.captchaUrl ?? json.captchaURL;
    if (captchaUrl) {
      if (this.captchaCode && json.code === 87001) this.captchaCode = '';
      return this.captcha(captchaUrl);
    }
    if (json.ssecurity && String(json.ssecurity).length > 4 && json.location) {
      return this.finish(json.location, json);
    }
    if (json.notificationUrl) return this.startVerification(json.notificationUrl);
    throw new CloudError(explainCode(json, 'Login failed.'));
  }

  async submitCaptcha(code: string): Promise<LoginStep> {
    this.captchaCode = code.trim();
    return this.stage === 'verify' ? this.sendTicket() : this.submitPassword();
  }

  // --- two-step verification -----------------------------------------------

  private async startVerification(notificationUrl: string): Promise<LoginStep> {
    this.stage = 'verify';
    this.captchaCode = '';
    this.context = notificationUrl.match(/[?&]context=([^&]+)/)?.[1] ?? '';
    if (this.context) this.context = decodeURIComponent(this.context);

    // Opening authStart sets identity_session.
    await this.follow(notificationUrl);

    const list = await this.call({
      url: `${ACCOUNT}/identity/list`,
      query: [['sid', SID], ['context', this.context], ['_locale', LOCALE]],
    });
    const lj = parseAccountJson(list.text);
    this.flag = String(lj?.flag ?? '8');
    this.verifyName = this.flag === '4' ? 'Phone' : 'Email';

    return this.sendTicket();
  }

  private async sendTicket(): Promise<LoginStep> {
    let target = '';
    try {
      const info = await this.call({
        url: `${ACCOUNT}/identity/auth/verify${this.verifyName}`,
        query: [['_flag', this.flag], ['_json', 'true']],
      });
      const ij = parseAccountJson(info.text);
      target = ij?.maskedEmail ?? ij?.maskedPhone ?? '';
    } catch {
      // Only used to tell the user where the code went.
    }

    const res = await this.call({
      method: 'POST',
      url: `${ACCOUNT}/identity/auth/send${this.verifyName}Ticket`,
      query: [
        ['_dc', String(Date.now())],
        ['sid', SID],
        ['context', this.context],
        ['mask', '0'],
        ['_locale', LOCALE],
      ],
      form: [
        ['retry', '0'],
        ['icode', this.captchaCode],
        ['_json', 'true'],
        ['ick', this.cookies.ick ?? ''],
      ],
    });
    const json = parseAccountJson(res.text);
    const captchaUrl = json?.captchaUrl ?? json?.captchaURL;
    if (captchaUrl) return this.captcha(captchaUrl);
    if (json && json.code !== 0) throw new CloudError(explainCode(json, 'Could not send the verification code.'));

    return { kind: 'verify', via: this.verifyName === 'Phone' ? 'phone' : 'email', target };
  }

  async submitVerificationCode(code: string): Promise<LoginStep> {
    const res = await this.call({
      method: 'POST',
      url: `${ACCOUNT}/identity/auth/verify${this.verifyName}`,
      query: [
        ['_flag', this.flag],
        ['_json', 'true'],
        ['sid', SID],
        ['context', this.context],
        ['mask', '0'],
        ['_locale', LOCALE],
      ],
      form: [
        ['_flag', this.flag],
        ['ticket', code.trim()],
        ['trust', 'false'],
        ['_json', 'true'],
        ['ick', this.cookies.ick ?? ''],
      ],
    });
    const json = parseAccountJson(res.text);
    if (json && json.code !== undefined && json.code !== 0 && !json.location) {
      throw new CloudError(explainCode(json, 'Verification failed.'));
    }

    let location: string | undefined =
      json?.location ??
      res.headers.location ??
      res.text.match(/https:\/\/account\.xiaomi\.com\/identity\/result\/check\?[^"']+/)?.[0];

    if (!location) {
      location =
        `${ACCOUNT}/identity/result/check?sid=${SID}` +
        `&context=${encodeURIComponent(this.context)}&_locale=${LOCALE}`;
    }
    return this.finish(resolveUrl(location, ACCOUNT));
  }

  // --- API ------------------------------------------------------------------

  private baseUrl(server: Server) {
    return `https://${server === 'cn' ? '' : `${server}.`}api.io.mi.com/app`;
  }

  async api(server: Server, path: string, data: string): Promise<any> {
    if (!this.loggedIn) throw new CloudError('Not signed in.');
    const { form, signedNonceB64 } = encryptRequest(path, data, this.ssecurity, makeNonce());

    const res = await request({
      method: 'POST',
      url: this.baseUrl(server) + path,
      form,
      headers: {
        'User-Agent': this.agent,
        'Accept-Encoding': 'identity',
        'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
        'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
      },
      cookies: {
        userId: this.userId,
        yetAnotherServiceToken: this.serviceToken,
        serviceToken: this.serviceToken,
        locale: 'en_GB',
        channel: 'MI_APP_STORE',
      },
    });
    if (res.status !== 200) throw new CloudError(`${path} on ${server}: HTTP ${res.status}`);

    const reply = JSON.parse(decryptResponse(res.text, signedNonceB64));
    if (reply.code !== 0) throw new CloudError(`${path} on ${server}: ${reply.message ?? reply.code}`);
    return reply.result;
  }

  /**
   * Every device on every server, the way the extractor walks them: own homes
   * from gethome, shared homes from get_device_cnt, devices per home.
   *
   * The same camera can appear on more than one server with different tokens
   * — a leftover registration. That bit us once already, so duplicates are
   * kept, not merged; the caller tests which token the camera answers to.
   */
  async listDevices(onProgress?: (server: Server) => void): Promise<CloudDevice[]> {
    const found: CloudDevice[] = [];

    for (const server of SERVERS) {
      onProgress?.(server);
      const homes: { id: string; owner: string }[] = [];
      try {
        const r = await this.api(
          server,
          '/v2/homeroom/gethome',
          '{"fg": true, "fetch_share": true, "fetch_share_dev": true, "limit": 300, "app_ver": 7}',
        );
        for (const h of r?.homelist ?? []) homes.push({ id: String(h.id), owner: this.userId });
      } catch {
        // No account data on this server.
      }
      try {
        const r = await this.api(server, '/v2/user/get_device_cnt', '{ "fetch_own": true, "fetch_share": true}');
        for (const h of r?.share?.share_family ?? []) {
          homes.push({ id: String(h.home_id), owner: String(h.home_owner) });
        }
      } catch {
        // Nothing shared here.
      }

      for (const home of homes) {
        try {
          const r = await this.api(
            server,
            '/v2/home/home_device_list',
            `{"home_owner": ${home.owner},"home_id": ${home.id},  "limit": 200,  "get_split_device": true, "support_smart_home": true}`,
          );
          for (const d of r?.device_info ?? []) {
            found.push({
              did: String(d.did ?? ''),
              name: String(d.name ?? ''),
              model: String(d.model ?? ''),
              ip: String(d.localip ?? ''),
              mac: String(d.mac ?? ''),
              token: String(d.token ?? ''),
              server,
            });
          }
        } catch {
          // Skip a home that will not list.
        }
      }
    }
    return found;
  }
}

export const isCamera = (d: CloudDevice) =>
  d.model.includes('.camera.') || d.model.includes('.cateye.');
