/**
 * Mobile-safe hex equivalents of @syncflow/design-tokens OKLCH palette.
 * React Native does not support OKLCH, so we convert to hex.
 */
export const colors = {
  background: '#F7F9FC',
  foreground: '#1C1C1E',
  card: '#FFFFFF',
  cardForeground: '#1C1C1E',
  primary: '#1A3A5C',
  primaryForeground: '#FFFFFF',
  secondary: '#F0F4F8',
  secondaryForeground: '#5A7A96',
  muted: '#EBF0F5',
  mutedForeground: '#8AABBD',
  accent: '#3B9FD8',
  accentForeground: '#FFFFFF',
  border: 'rgba(0,0,0,0.05)',
  input: '#F0F4F8',
  ring: '#1A3A5C',
  success: '#16A34A',
  successForeground: '#FFFFFF',
  warning: '#F59E0B',
  warningForeground: '#D97706',
  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',
  screenBackground: '#F7F9FC',
  screenTitle: '#1A3A5C',
} as const;
