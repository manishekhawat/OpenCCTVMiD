import { MiioDevice } from '../miio/device';
import type { CloudDevice } from './xiaomi';

/**
 * Finds the IP and token this camera actually answers to.
 *
 * The account can list the same camera more than once — a stale registration
 * on another server, with its own token and an old IP. That happened with
 * this exact camera: two entries, same device id, different tokens, and only
 * one of them worked. Rather than asking the user to guess, try every token
 * against every address the account knows for that device id, and keep the
 * first pair where miIO.info comes back.
 *
 * A wrong token produces silence rather than an error, so each attempt costs
 * one timeout; with two entries that is at most four short attempts.
 */
export async function findWorkingCredentials(
  chosen: CloudDevice,
  all: CloudDevice[],
  onAttempt?: (ip: string, tokenTail: string) => void,
): Promise<{ ip: string; token: string } | null> {
  const same = all.filter(d => d.did === chosen.did);
  const tokens = [...new Set([chosen.token, ...same.map(d => d.token)].filter(t => /^[0-9a-f]{32}$/i.test(t)))];
  const ips = [...new Set([chosen.ip, ...same.map(d => d.ip)].filter(Boolean))];

  for (const ip of ips) {
    for (const token of tokens) {
      onAttempt?.(ip, token.slice(-4));
      const dev = new MiioDevice(ip, token, undefined, 2000);
      try {
        await dev.handshake();
        const info = await dev.send('miIO.info', [], 0);
        if (!info.error) return { ip, token };
      } catch {
        // Unreachable or wrong token; try the next pair.
      } finally {
        dev.dispose();
      }
    }
  }
  return null;
}
