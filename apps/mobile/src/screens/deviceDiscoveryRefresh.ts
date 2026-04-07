type DeviceDiscoveryRefreshDecision = {
  currentDeviceCount: number;
  nextDeviceCount: number;
  preserveCachedDevices: boolean;
};

export function shouldKeepCachedDevicesVisible({
  currentDeviceCount,
  nextDeviceCount,
  preserveCachedDevices,
}: DeviceDiscoveryRefreshDecision): boolean {
  return (
    preserveCachedDevices &&
    currentDeviceCount > 0 &&
    nextDeviceCount === 0
  );
}
