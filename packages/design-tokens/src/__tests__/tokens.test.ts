import { describe, it, expect } from 'vitest';
import { colors } from '../colors';
import { radius } from '../radius';
import { elevation, glass } from '../elevation';
import { fontFamily } from '../typography';

describe('colors', () => {
  it('all values are valid oklch strings', () => {
    for (const value of Object.values(colors)) {
      expect(value).toMatch(/^oklch\(/);
    }
  });
  it('has primary color', () => {
    expect(colors.primary).toBe('oklch(0.60 0.16 245)');
  });
  it('has all 36 color tokens', () => {
    expect(Object.keys(colors)).toHaveLength(36);
  });
});

describe('radius', () => {
  it('has base radius', () => {
    expect(radius.base).toBe('0.75rem');
  });
});

describe('elevation', () => {
  it('has card shadow', () => {
    expect(elevation.card).toContain('rgba');
  });
  it('has 6 presets', () => {
    expect(Object.keys(elevation)).toHaveLength(6);
  });
});

describe('glass', () => {
  it('has card preset', () => {
    expect(glass.card.background).toContain('rgba');
    expect(glass.card.blur).toBe('16px');
  });
  it('has 5 presets', () => {
    expect(Object.keys(glass)).toHaveLength(5);
  });
});

describe('typography', () => {
  it('has Geist font family', () => {
    expect(fontFamily.sans).toContain('Geist');
  });
});
