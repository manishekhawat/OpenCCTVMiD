export const theme = {
  bg: '#0A0A0B',
  surface: '#17171A',
  surfaceAlt: '#202024',
  border: '#2A2A2F',
  text: '#ECECEE',
  dim: '#8E8E96',
  faint: '#55555E',
  accent: '#17B3A6', // the teal Mi Home uses for its toggles
  accentDim: '#0E3B38',
  good: '#4ADE80',
  warn: '#FBBF24',
  bad: '#F87171',
  mono: 'monospace' as const,
};

export const statusColor: Record<string, string> = {
  works: theme.good,
  exists: theme.warn,
  empty: '#6B7280',
  ignored: '#FB923C',
  absent: theme.faint,
  untested: theme.faint,
};
