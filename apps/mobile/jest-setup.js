import { NativeModules } from 'react-native';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-documents/viewer', () => ({
  viewDocument: jest.fn(),
}));

global.__mockReactNativeShareOpen = jest.fn();
jest.mock('react-native-share', () => {
  const shareMock = {
    open: global.__mockReactNativeShareOpen,
  };
  shareMock.default = shareMock;
  return shareMock;
});

// Mock NativeSyncEngine NativeModule
NativeModules.NativeSyncEngine = {
  pairDevice: jest.fn(),
  getReadOnlyQueue: jest.fn().mockResolvedValue([]),
  getBindingState: jest.fn().mockResolvedValue({
    deviceId: 'desktop-device-id',
    host: '192.168.1.100',
    connectionState: 'connected',
  }),
  getClientId: jest.fn().mockResolvedValue('mock-client-id'),
  getClientDisplayName: jest.fn().mockResolvedValue('mock-client-name'),
  wipeSyncIdentity: jest.fn(),
  getPhotoAuthorizationStatus: jest.fn().mockResolvedValue('authorized'),
  requestPhotoPermission: jest.fn().mockResolvedValue('authorized'),
};

// Mock react-native-vision-camera globally
jest.mock('react-native-vision-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Camera = props => React.createElement(View, props);
  Camera.getCameraPermissionStatus = jest
    .fn()
    .mockReturnValue('not-determined');
  Camera.requestCameraPermission = jest.fn().mockResolvedValue('granted');

  return {
    Camera,
    useCameraDevice: jest.fn(() => ({ id: 'back-camera' })),
    useCodeScanner: jest.fn(config => config),
  };
});
