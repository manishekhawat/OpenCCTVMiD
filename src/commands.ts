/**
 * What a Dafang might answer to.
 *
 * python-miio has no driver for `isa.camera.df3` and Xiaomi never published
 * its method list, so nothing here is guaranteed. The probe screen discovers
 * which of these the camera actually implements, and the control screen only
 * shows what was confirmed.
 */

export interface Candidate {
  method: string;
  params: unknown[];
  label: string;
  group: string;
  /** Never fired during an automatic sweep. */
  destructive?: boolean;
}

export const signatureOf = (c: Candidate): string =>
  `${c.method}(${c.params.map(p => JSON.stringify(p)).join(', ')})`;

/**
 * Read-only properties, queried one at a time — a single bad name makes the
 * whole batched get_prop fail.
 */
export const candidateProps: string[] = [
  'power', 'video', 'light', 'led', 'night_mode', 'nightmode', 'ir',
  'full_color', 'flip', 'rotate', 'mirror', 'watermark', 'wdr', 'hdr',
  'motion_record', 'motion_detect', 'md', 'mdsens', 'sensitivity',
  'alarm', 'alarm_interval', 'track', 'cruise', 'auto_track',
  'sdcard_status', 'sd_status', 'storage', 'free_space', 'total_space',
  'rtsp', 'resolution', 'quality', 'bitrate', 'volume', 'mic', 'speaker',
  'motor_x', 'motor_y', 'pan', 'tilt', 'preset', 'ota_state',
];

export const candidateCommands: Candidate[] = [
  // --- stream / power ---
  { method: 'set_video', params: ['on'], label: 'Wake stream', group: 'Power' },
  { method: 'set_video', params: ['off'], label: 'Sleep stream', group: 'Power' },
  { method: 'set_power', params: ['on'], label: 'Power on', group: 'Power' },
  { method: 'set_power', params: ['off'], label: 'Power off', group: 'Power' },

  // --- the PTZ hunt ---
  { method: 'set_motor', params: [{ operation: 0 }], label: 'Motor op 0', group: 'PTZ' },
  { method: 'set_motor', params: [{ operation: 1 }], label: 'Motor op 1', group: 'PTZ' },
  { method: 'motor_move', params: [{ direction: 0, steps: 10 }], label: 'Move dir 0', group: 'PTZ' },
  { method: 'set_motor_move', params: [{ direction: 0, steps: 10 }], label: 'Move dir 0 (alt)', group: 'PTZ' },
  { method: 'ptz_move', params: ['left'], label: 'PTZ left', group: 'PTZ' },
  { method: 'set_ptz', params: ['left'], label: 'Set PTZ left', group: 'PTZ' },
  { method: 'set_pan', params: [10], label: 'Pan 10', group: 'PTZ' },
  { method: 'set_tilt', params: [10], label: 'Tilt 10', group: 'PTZ' },
  { method: 'motor_reset', params: [], label: 'Recalibrate', group: 'PTZ' },
  { method: 'set_motor_reset', params: [], label: 'Recalibrate (alt)', group: 'PTZ' },
  { method: 'get_motor_status', params: [], label: 'Motor status', group: 'PTZ' },
  { method: 'motor_status', params: [], label: 'Motor status (alt)', group: 'PTZ' },
  { method: 'goto_preset', params: [1], label: 'Go to preset 1', group: 'PTZ' },
  { method: 'set_preset', params: [1], label: 'Save preset 1', group: 'PTZ' },
  { method: 'get_preset', params: [], label: 'List presets', group: 'PTZ' },
  { method: 'set_cruise', params: ['off'], label: 'Cruise off', group: 'PTZ' },
  { method: 'set_track', params: ['off'], label: 'Track off', group: 'PTZ' },
  { method: 'set_auto_track', params: ['off'], label: 'Auto-track off', group: 'PTZ' },

  // --- image ---
  { method: 'set_flip', params: ['on'], label: 'Flip on', group: 'Image' },
  { method: 'set_flip', params: ['off'], label: 'Flip off', group: 'Image' },
  { method: 'set_rotate', params: [180], label: 'Rotate 180', group: 'Image' },
  { method: 'set_mirror', params: ['on'], label: 'Mirror on', group: 'Image' },
  { method: 'set_watermark', params: ['on'], label: 'Timestamp on', group: 'Image' },
  { method: 'set_watermark', params: ['off'], label: 'Timestamp off', group: 'Image' },
  { method: 'set_wdr', params: ['on'], label: 'WDR on', group: 'Image' },
  { method: 'set_night_mode', params: [0], label: 'Night: off', group: 'Image' },
  { method: 'set_night_mode', params: [1], label: 'Night: on', group: 'Image' },
  { method: 'set_night_mode', params: [2], label: 'Night: auto', group: 'Image' },
  { method: 'set_full_color', params: [1], label: 'Full colour', group: 'Image' },
  { method: 'set_light', params: ['on'], label: 'Indicator LED on', group: 'Image' },
  { method: 'set_light', params: ['off'], label: 'Indicator LED off', group: 'Image' },

  // --- detection ---
  { method: 'set_motion_record', params: ['on'], label: 'Motion record on', group: 'Detection' },
  { method: 'set_motion_record', params: ['off'], label: 'Motion record off', group: 'Detection' },
  { method: 'set_motion_detect', params: ['on'], label: 'Motion detect on', group: 'Detection' },
  { method: 'set_md', params: [1], label: 'MD on', group: 'Detection' },
  { method: 'set_mdsens', params: [1], label: 'Sensitivity low', group: 'Detection' },
  { method: 'set_mdsens', params: [2], label: 'Sensitivity medium', group: 'Detection' },
  { method: 'set_mdsens', params: [3], label: 'Sensitivity high', group: 'Detection' },
  { method: 'set_alarm', params: ['on'], label: 'Alarm on', group: 'Detection' },
  { method: 'set_alarm_interval', params: [5], label: 'Alarm every 5 min', group: 'Detection' },

  // --- storage ---
  { method: 'get_sdcard_status', params: [], label: 'SD status', group: 'Storage' },
  { method: 'get_free_space', params: [], label: 'Free space', group: 'Storage' },
  { method: 'sdcard_format', params: [], label: 'Format SD card', group: 'Storage', destructive: true },

  // --- misc ---
  { method: 'set_volume', params: [50], label: 'Volume 50', group: 'Audio' },
  { method: 'miIO.info', params: [], label: 'Device info', group: 'Info' },
];

/**
 * Confirmed against isa.camera.df3 on firmware 5.5.1_1025, 2026-11-08.
 *
 * These are the only properties observed to return a value. They are read one
 * per call on purpose: get_prop omits unknown names from the reply instead of
 * padding it, so asking for four names and getting two back leaves no way to
 * tell which two they were.
 */
export const verifiedProps: { name: string; label: string }[] = [
  { name: 'power', label: 'Camera' },
  { name: 'night_mode', label: 'Night mode' },
  { name: 'sdcard_status', label: 'SD card' },
];

/**
 * The only writes the camera acknowledges. It returns "ok" for both — though
 * set_cruise("on") was observed not to move the motors, so the ack means the
 * write was parsed, not that anything acted on it.
 */
export const verifiedCommands: Candidate[] = [
  { method: 'set_cruise', params: ['on'], label: 'Cruise on', group: 'Confirmed' },
  { method: 'set_cruise', params: ['off'], label: 'Cruise off', group: 'Confirmed' },
  { method: 'set_track', params: ['on'], label: 'Track on', group: 'Confirmed' },
  { method: 'set_track', params: ['off'], label: 'Track off', group: 'Confirmed' },
];

/**
 * The camera answered cloud-side MIoT calls in python-miio #996 (siid 2 /
 * piid 1), so the local endpoint is worth sweeping even though the published
 * spec lists only a power switch and P2P stream start/stop. A grid is the
 * only way in: the spec cannot be trusted to be complete, and get_prop
 * already proved it understates this firmware.
 */
export function miotPropertyGrid(maxSiid = 6, maxPiid = 6): Candidate[] {
  const out: Candidate[] = [];
  for (let siid = 1; siid <= maxSiid; siid++) {
    for (let piid = 1; piid <= maxPiid; piid++) {
      out.push({
        method: 'get_properties',
        params: [{ did: `s${siid}p${piid}`, siid, piid }],
        label: `siid ${siid} piid ${piid}`,
        group: 'MIoT',
      });
    }
  }
  return out;
}

/** MIoT actions, where a pan/tilt call would live if one exists locally. */
export function miotActionGrid(maxSiid = 6, maxAiid = 4): Candidate[] {
  const out: Candidate[] = [];
  for (let siid = 1; siid <= maxSiid; siid++) {
    for (let aiid = 1; aiid <= maxAiid; aiid++) {
      out.push({
        method: 'action',
        params: [{ did: `a${siid}_${aiid}`, siid, aiid, in: [] }],
        label: `action siid ${siid} aiid ${aiid}`,
        group: 'MIoT actions',
      });
    }
  }
  return out;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Directional candidates tried, in order, until one is accepted. The winner is
 * remembered so later presses go straight to it.
 */
export const ptzByDirection: Record<Direction, Candidate[]> = {
  up: [
    { method: 'motor_move', params: [{ direction: 0, steps: 10 }], label: 'up', group: 'PTZ' },
    { method: 'set_motor', params: [{ operation: 0 }], label: 'up', group: 'PTZ' },
    { method: 'ptz_move', params: ['up'], label: 'up', group: 'PTZ' },
  ],
  down: [
    { method: 'motor_move', params: [{ direction: 1, steps: 10 }], label: 'down', group: 'PTZ' },
    { method: 'set_motor', params: [{ operation: 1 }], label: 'down', group: 'PTZ' },
    { method: 'ptz_move', params: ['down'], label: 'down', group: 'PTZ' },
  ],
  left: [
    { method: 'motor_move', params: [{ direction: 2, steps: 10 }], label: 'left', group: 'PTZ' },
    { method: 'set_motor', params: [{ operation: 2 }], label: 'left', group: 'PTZ' },
    { method: 'ptz_move', params: ['left'], label: 'left', group: 'PTZ' },
  ],
  right: [
    { method: 'motor_move', params: [{ direction: 3, steps: 10 }], label: 'right', group: 'PTZ' },
    { method: 'set_motor', params: [{ operation: 3 }], label: 'right', group: 'PTZ' },
    { method: 'ptz_move', params: ['right'], label: 'right', group: 'PTZ' },
  ],
};
