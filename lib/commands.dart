/// What a Dafang might answer to.
///
/// python-miio has no driver for `isa.camera.df3` and Xiaomi never published
/// its method list, so nothing here is guaranteed. The probe screen discovers
/// which of these the camera actually implements, and the control screen only
/// shows buttons that were confirmed.
library;

enum Confidence {
  /// Reported working on Xiaomi cameras by more than one source.
  likely,

  /// Plausible by naming convention; unverified on this model.
  guess,
}

class Candidate {
  final String method;
  final List<dynamic> params;
  final String label;
  final String group;
  final Confidence confidence;

  /// Never fired during an automatic sweep.
  final bool destructive;

  const Candidate(
    this.method,
    this.params, {
    required this.label,
    required this.group,
    this.confidence = Confidence.guess,
    this.destructive = false,
  });

  String get signature => '$method(${params.join(', ')})';
}

/// Read-only properties, queried one at a time — a single bad name makes the
/// whole batched get_prop fail.
const List<String> candidateProps = [
  'power', 'video', 'light', 'led', 'night_mode', 'nightmode', 'ir',
  'full_color', 'flip', 'rotate', 'mirror', 'watermark', 'wdr', 'hdr',
  'motion_record', 'motion_detect', 'md', 'mdsens', 'sensitivity',
  'alarm', 'alarm_interval', 'track', 'cruise', 'auto_track',
  'sdcard_status', 'sd_status', 'storage', 'free_space', 'total_space',
  'rtsp', 'resolution', 'quality', 'bitrate', 'volume', 'mic', 'speaker',
  'motor_x', 'motor_y', 'pan', 'tilt', 'preset', 'ota_state',
];

const List<Candidate> candidateCommands = [
  // --- stream / power -----------------------------------------------------
  Candidate('set_video', ['on'],
      label: 'Wake stream', group: 'Power', confidence: Confidence.likely),
  Candidate('set_video', ['off'],
      label: 'Sleep stream', group: 'Power', confidence: Confidence.likely),
  Candidate('set_power', ['on'], label: 'Power on', group: 'Power'),
  Candidate('set_power', ['off'], label: 'Power off', group: 'Power'),

  // --- the PTZ hunt -------------------------------------------------------
  Candidate('set_motor', [{'operation': 0}], label: 'Motor op 0', group: 'PTZ'),
  Candidate('set_motor', [{'operation': 1}], label: 'Motor op 1', group: 'PTZ'),
  Candidate('motor_move', [{'direction': 0, 'steps': 10}],
      label: 'Move dir 0', group: 'PTZ'),
  Candidate('set_motor_move', [{'direction': 0, 'steps': 10}],
      label: 'Move dir 0 (alt)', group: 'PTZ'),
  Candidate('ptz_move', ['left'], label: 'PTZ left', group: 'PTZ'),
  Candidate('set_ptz', ['left'], label: 'Set PTZ left', group: 'PTZ'),
  Candidate('set_pan', [10], label: 'Pan 10', group: 'PTZ'),
  Candidate('set_tilt', [10], label: 'Tilt 10', group: 'PTZ'),
  Candidate('motor_reset', [], label: 'Recalibrate', group: 'PTZ'),
  Candidate('set_motor_reset', [], label: 'Recalibrate (alt)', group: 'PTZ'),
  Candidate('get_motor_status', [], label: 'Motor status', group: 'PTZ'),
  Candidate('motor_status', [], label: 'Motor status (alt)', group: 'PTZ'),
  Candidate('goto_preset', [1], label: 'Go to preset 1', group: 'PTZ'),
  Candidate('set_preset', [1], label: 'Save preset 1', group: 'PTZ'),
  Candidate('get_preset', [], label: 'List presets', group: 'PTZ'),
  Candidate('set_cruise', ['off'], label: 'Cruise off', group: 'PTZ'),
  Candidate('set_track', ['off'], label: 'Track off', group: 'PTZ'),
  Candidate('set_auto_track', ['off'], label: 'Auto-track off', group: 'PTZ'),

  // --- image --------------------------------------------------------------
  Candidate('set_flip', ['on'], label: 'Flip on', group: 'Image'),
  Candidate('set_flip', ['off'], label: 'Flip off', group: 'Image'),
  Candidate('set_rotate', [180], label: 'Rotate 180', group: 'Image'),
  Candidate('set_mirror', ['on'], label: 'Mirror on', group: 'Image'),
  Candidate('set_watermark', ['on'], label: 'Timestamp on', group: 'Image'),
  Candidate('set_watermark', ['off'], label: 'Timestamp off', group: 'Image'),
  Candidate('set_wdr', ['on'], label: 'WDR on', group: 'Image'),
  Candidate('set_night_mode', [0], label: 'Night: off', group: 'Image'),
  Candidate('set_night_mode', [1], label: 'Night: on', group: 'Image'),
  Candidate('set_night_mode', [2], label: 'Night: auto', group: 'Image'),
  Candidate('set_full_color', [1], label: 'Full colour', group: 'Image'),
  Candidate('set_light', ['on'], label: 'Indicator LED on', group: 'Image'),
  Candidate('set_light', ['off'], label: 'Indicator LED off', group: 'Image'),

  // --- detection ----------------------------------------------------------
  Candidate('set_motion_record', ['on'],
      label: 'Motion record on', group: 'Detection'),
  Candidate('set_motion_record', ['off'],
      label: 'Motion record off', group: 'Detection'),
  Candidate('set_motion_detect', ['on'],
      label: 'Motion detect on', group: 'Detection'),
  Candidate('set_md', [1], label: 'MD on', group: 'Detection'),
  Candidate('set_mdsens', [1], label: 'Sensitivity low', group: 'Detection'),
  Candidate('set_mdsens', [2], label: 'Sensitivity medium', group: 'Detection'),
  Candidate('set_mdsens', [3], label: 'Sensitivity high', group: 'Detection'),
  Candidate('set_alarm', ['on'], label: 'Alarm on', group: 'Detection'),
  Candidate('set_alarm_interval', [5],
      label: 'Alarm every 5 min', group: 'Detection'),

  // --- storage ------------------------------------------------------------
  Candidate('get_sdcard_status', [], label: 'SD status', group: 'Storage'),
  Candidate('get_free_space', [], label: 'Free space', group: 'Storage'),
  Candidate('sdcard_format', [],
      label: 'Format SD card', group: 'Storage', destructive: true),

  // --- misc ---------------------------------------------------------------
  Candidate('set_volume', [50], label: 'Volume 50', group: 'Audio'),
  Candidate('miIO.info', [],
      label: 'Device info', group: 'Info', confidence: Confidence.likely),
];

/// Directional candidates tried, in order, by the PTZ pad once probing has
/// confirmed which family the firmware speaks.
const Map<String, List<Candidate>> ptzByDirection = {
  'up': [
    Candidate('motor_move', [{'direction': 0, 'steps': 10}],
        label: 'up', group: 'PTZ'),
    Candidate('set_motor', [{'operation': 0}], label: 'up', group: 'PTZ'),
    Candidate('ptz_move', ['up'], label: 'up', group: 'PTZ'),
  ],
  'down': [
    Candidate('motor_move', [{'direction': 1, 'steps': 10}],
        label: 'down', group: 'PTZ'),
    Candidate('set_motor', [{'operation': 1}], label: 'down', group: 'PTZ'),
    Candidate('ptz_move', ['down'], label: 'down', group: 'PTZ'),
  ],
  'left': [
    Candidate('motor_move', [{'direction': 2, 'steps': 10}],
        label: 'left', group: 'PTZ'),
    Candidate('set_motor', [{'operation': 2}], label: 'left', group: 'PTZ'),
    Candidate('ptz_move', ['left'], label: 'left', group: 'PTZ'),
  ],
  'right': [
    Candidate('motor_move', [{'direction': 3, 'steps': 10}],
        label: 'right', group: 'PTZ'),
    Candidate('set_motor', [{'operation': 3}], label: 'right', group: 'PTZ'),
    Candidate('ptz_move', ['right'], label: 'right', group: 'PTZ'),
  ],
};
