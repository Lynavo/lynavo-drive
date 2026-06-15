import { NativeModules } from 'react-native';

// Mock react-native-google-signin
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({
      data: { idToken: 'mock-google-id-token' },
    }),
  },
}));

// Mock AppleAuthModule NativeModule
NativeModules.AppleAuthModule = {
  login: jest.fn().mockResolvedValue({
    identityToken: 'mock-apple-id-token',
    authorizationCode: 'mock-auth-code',
    fullName: 'Test User',
  }),
};

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Mock NativeSyncEngine NativeModule
NativeModules.NativeSyncEngine = {
  pairDevice: jest.fn(),
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

