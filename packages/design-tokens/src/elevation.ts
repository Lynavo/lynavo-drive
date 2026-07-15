export const elevation = {
  card: '0 2px 16px rgba(100,160,210,0.10)',
  cardSubtle: '0 2px 12px rgba(100,160,210,0.08), 0 1px 3px rgba(0,0,0,0.03)',
  cardActive: '0 4px 24px rgba(59,130,246,0.12), 0 1px 4px rgba(0,0,0,0.04)',
  modal: '0 24px 80px rgba(80,150,200,0.18), 0 4px 20px rgba(0,0,0,0.06)',
  sidebar: '2px 0 16px rgba(100,170,220,0.08)',
  dropdown: '0 8px 24px rgba(0,0,0,0.12)',
} as const;

export const glass = {
  sidebar: { background: 'rgba(255,255,255,0.55)', blur: '20px' },
  card: { background: 'rgba(255,255,255,0.72)', blur: '16px' },
  cardMuted: { background: 'rgba(255,255,255,0.45)', blur: '16px' },
  modal: { background: 'rgba(248,252,255,0.88)', blur: '24px' },
  dropdown: { background: 'rgba(255,255,255,0.96)', blur: '16px' },
} as const;
