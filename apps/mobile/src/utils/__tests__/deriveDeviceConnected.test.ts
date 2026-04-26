import { deriveDeviceConnected } from '../deriveDeviceConnected';

describe('deriveDeviceConnected', () => {
  it('returns true for connected and bound', () => {
    expect(deriveDeviceConnected('connected', false)).toBe(true);
    expect(deriveDeviceConnected('bound', false)).toBe(true);
  });

  it('returns false for offline and discovering', () => {
    expect(deriveDeviceConnected('offline', true)).toBe(false);
    expect(deriveDeviceConnected('discovering', true)).toBe(false);
  });

  it('keeps the previous value during the connecting transient', () => {
    expect(deriveDeviceConnected('connecting', true)).toBe(true);
    expect(deriveDeviceConnected('connecting', false)).toBe(false);
  });

  it('does not flash offline during a connected -> connecting -> connected bounce', () => {
    let state = false;
    state = deriveDeviceConnected('connected', state);
    expect(state).toBe(true);
    state = deriveDeviceConnected('connecting', state);
    expect(state).toBe(true);
    state = deriveDeviceConnected('connected', state);
    expect(state).toBe(true);
  });

  it('still flips to offline immediately on a real disconnect', () => {
    let state = true;
    state = deriveDeviceConnected('offline', state);
    expect(state).toBe(false);
  });

  it('treats unknown values as offline', () => {
    expect(deriveDeviceConnected('', true)).toBe(false);
    expect(deriveDeviceConnected('unknown-state', true)).toBe(false);
  });
});
