import nacl from 'tweetnacl';

import { randomBytes } from '../cloud/crypto';
import type { Server, XiaomiCloud } from '../cloud/xiaomi';

// tweetnacl looks for self.crypto when it loads and has no fallback under
// Hermes; without this, keyPair() throws "no PRNG". Point it at the same
// secure source the cloud nonces use.
nacl.setPRNG((x: Uint8Array, n: number) => {
  x.set(randomBytes(n));
});

/**
 * Fetches what the cloud hands out for a P2P session with one camera.
 *
 * Mirrors go2rtc internal/xiaomi/xiaomi.go for a model it doesn't list as
 * "legacy only" — which includes isa.camera.df3, noted there as supporting
 * the newer "miss" format on new firmware and the legacy format on old:
 *
 *   1. /v2/device/miss_get_vendor — the newer format. If the camera supports
 *      it, the reply names a vendor (1 = TUTK, 4 = CS2, ...) and keys.
 *   2. On "no available vendor support", /device/devicepass — the legacy
 *      format: a TUTK UID and a password. For the Dafang the password is the
 *      XXTEA key for its ICAM login.
 *
 * Which branch this camera takes is the first thing the P2P test reports.
 */

export type P2PKeys =
  | {
      format: 'miss';
      vendor: number;
      vendorName: string;
      uid: string;
      devicePublic: string;
      sign: string;
      clientPublic: string;
      clientPrivate: string;
    }
  | {
      format: 'legacy';
      uid: string;
      password: string;
      devicePublic: string;
      sign: string;
      clientPublic: string;
      clientPrivate: string;
    };

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

const vendorName = (id: number) =>
  ({ 1: 'TUTK', 3: 'Agora', 4: 'CS2', 6: 'MTP' } as Record<number, string>)[id] ?? `vendor ${id}`;

export async function fetchP2PKeys(cloud: XiaomiCloud, server: Server, did: string): Promise<P2PKeys> {
  const pair = nacl.box.keyPair();
  const clientPublic = toHex(pair.publicKey);
  const clientPrivate = toHex(pair.secretKey);

  try {
    const r = await cloud.api(
      server,
      '/v2/device/miss_get_vendor',
      `{"app_pubkey":"${clientPublic}","did":"${did}","support_vendors":"TUTK_CS2_MTP"}`,
    );
    const id = Number(r?.vendor?.vendor ?? 0);
    return {
      format: 'miss',
      vendor: id,
      vendorName: vendorName(id),
      uid: String(r?.vendor?.vendor_params?.p2p_id ?? ''),
      devicePublic: String(r?.public_key ?? ''),
      sign: String(r?.sign ?? ''),
      clientPublic,
      clientPrivate,
    };
  } catch (e) {
    if (!String(e instanceof Error ? e.message : e).includes('no available vendor support')) throw e;
  }

  const r = await cloud.api(server, '/device/devicepass', `{"did":"${did}","toSignAppData":"${clientPublic}"}`);
  return {
    format: 'legacy',
    uid: String(r?.p2p_id ?? ''),
    password: String(r?.password ?? ''),
    devicePublic: String(r?.p2p_dev_public_key ?? ''),
    sign: String(r?.signForAppData ?? ''),
    clientPublic,
    clientPrivate,
  };
}
