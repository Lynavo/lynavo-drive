import { shouldKeepCachedDevicesVisible } from '../deviceDiscoveryRefresh';

describe('deviceDiscoveryRefresh', () => {
  it('keeps the previous device list visible while a refresh temporarily reports no devices', () => {
    expect(
      shouldKeepCachedDevicesVisible({
        currentDeviceCount: 2,
        nextDeviceCount: 0,
        preserveCachedDevices: true,
      }),
    ).toBe(true);
  });

  it('allows empty updates through when there is no cached list to preserve', () => {
    expect(
      shouldKeepCachedDevicesVisible({
        currentDeviceCount: 0,
        nextDeviceCount: 0,
        preserveCachedDevices: true,
      }),
    ).toBe(false);
  });

  it('allows fresh non-empty discovery results to replace the cached list', () => {
    expect(
      shouldKeepCachedDevicesVisible({
        currentDeviceCount: 2,
        nextDeviceCount: 1,
        preserveCachedDevices: true,
      }),
    ).toBe(false);
  });
});
