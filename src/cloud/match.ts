import { MiioDevice, discover } from '../miio/device';
import type { CloudDevice } from './xiaomi';

/**
 * Finds the IP and token this camera actually answers to.
 *
 * Two things the cloud gets wrong, both seen on this account:
 *
 * - The same camera listed twice, on two servers, with different tokens.
 *   Only one token works.
 * - A stale IP. The account said 192.168.1.14 while the camera had been at
 *   .11; the router hands out new addresses and the cloud lags behind.
 *
 * So the LAN is asked first: a hello broadcast returns each device's id, and
 * whatever address answers with this camera's id is where it really is. The
 * cloud's addresses are only fallbacks. Then every token is tried against
 * every candidate address.
 *
 * Each attempt is recorded, because the two failures need different fixes
 * and look identical from a single "no answer": no handshake reply means
 * nothing is at that address; a handshake reply followed by silence means the
 * camera is there and the token is wrong (it verifies our checksum before
 * replying, so a bad token produces silence, not an error).
 */

export interface Attempt {
  ip: string;
  tokenTail: string;
  result: 'ok' | 'no-device' | 'wrong-token';
}

export interface MatchResult {
  creds: { ip: string; token: string } | null;
  attempts: Attempt[];
  lanIps: string[];
  tokenCount: number;
}

export async function findWorkingCredentials(
  chosen: CloudDevice,
  all: CloudDevice[],
  onProgress?: (note: string) => void,
): Promise<MatchResult> {
  const same = all.filter(d => d.did === chosen.did);
  const tokens = [
    ...new Set([chosen.token, ...same.map(d => d.token)].filter(t => /^[0-9a-f]{32}$/i.test(t))),
  ];

  onProgress?.('Looking for the camera on this Wi-Fi…');
  let lanIps: string[] = [];
  try {
    const found = await discover(3000);
    lanIps = found.filter(f => String(f.deviceId) === chosen.did).map(f => f.ip);
  } catch {
    // Discovery is a shortcut, not a requirement.
  }

  const ips = [...new Set([...lanIps, chosen.ip, ...same.map(d => d.ip)].filter(Boolean))];
  const attempts: Attempt[] = [];

  for (const ip of ips) {
    for (const token of tokens) {
      const tokenTail = token.slice(-4);
      onProgress?.(`Trying ${ip} with token …${tokenTail}`);
      const dev = new MiioDevice(ip, token, undefined, 3000);
      let handshook = false;
      try {
        await dev.handshake();
        handshook = true;
        const info = await dev.send('miIO.info', [], 1);
        if (!info.error) {
          attempts.push({ ip, tokenTail, result: 'ok' });
          return { creds: { ip, token }, attempts, lanIps, tokenCount: tokens.length };
        }
        attempts.push({ ip, tokenTail, result: 'wrong-token' });
      } catch {
        attempts.push({ ip, tokenTail, result: handshook ? 'wrong-token' : 'no-device' });
      } finally {
        dev.dispose();
      }
      // Nothing listens at this address; other tokens won't change that.
      if (!handshook) break;
    }
  }
  return { creds: null, attempts, lanIps, tokenCount: tokens.length };
}

/** Turns the attempts into something a person can act on. */
export function explainFailure(name: string, did: string, m: MatchResult): string {
  if (m.tokenCount === 0) {
    return `The account returned no token for ${name}. Xiaomi only gives tokens to the device's owner — if this camera is shared with you, sign in with the owner's account.`;
  }
  const lines = m.attempts.map(a =>
    `• ${a.ip}, token …${a.tokenTail}: ${
      a.result === 'no-device' ? 'nothing answered at this address' : 'camera is there, token rejected'
    }`,
  );
  const lan = m.lanIps.length
    ? `On this Wi-Fi, device ${did} answered at ${m.lanIps.join(', ')}.`
    : `No device with id ${did} answered the scan on this Wi-Fi.`;
  const rejected = m.attempts.some(a => a.result === 'wrong-token');
  // Seen on the real camera (2026-11-12): handshake answered, the account's
  // current token silently rejected — and unplugging the camera for ten
  // seconds fixed it. Its local-command service had stuck after it rejoined
  // Wi-Fi on a new address. So restart first; re-adding is the last resort.
  const advice = rejected
    ? 'The camera is reachable but ignored every token. Unplug it for 10 seconds, plug it back in, wait for it to rejoin Wi-Fi (about a minute), then try again — that fixed this exact symptom before. If it still fails, the camera may have been re-added in Mi Home with a new token.'
    : 'Nothing answered at any address. Check that this phone is on the same Wi-Fi as the camera (not mobile data, not a guest network) and that the camera is powered.';
  return `${name} didn't connect.\n\n${lan}\n${lines.join('\n')}\n\n${advice}`;
}
