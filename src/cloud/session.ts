import type { CloudDevice } from './xiaomi';
import { XiaomiCloud } from './xiaomi';

/**
 * The signed-in cloud session, shared app-wide and held in memory only.
 *
 * Sign-in fetches the device token, and P2P needs the same session to fetch
 * the camera's P2P keys — so it lives here rather than inside the sign-in
 * panel. Closing the app forgets it.
 */
let current: XiaomiCloud | null = null;
let devices: CloudDevice[] = [];

export const cloudSession = {
  get(): XiaomiCloud {
    if (!current) current = new XiaomiCloud();
    return current;
  },
  reset() {
    current = new XiaomiCloud();
    devices = [];
    return current;
  },
  setDevices(list: CloudDevice[]) {
    devices = list;
  },
  devices(): CloudDevice[] {
    return devices;
  },
  /** The cloud's entries for one camera, matched by miIO device id. */
  entriesFor(deviceId: number | string): CloudDevice[] {
    return devices.filter(d => d.did === String(deviceId));
  },
};
