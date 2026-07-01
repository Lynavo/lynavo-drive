import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const androidModule = readFileSync(
  resolve(
    root,
    'apps/mobile/android/app/src/main/java/com/lynavo/drive/mobile/sync/NativeSyncEngineModule.kt',
  ),
  'utf8',
);

const requiredReactMethods = [
  'getClientId',
  'getKnownDeviceIds',
  'getAssetPreviewSource',
  'uploadDiagnosticsArchive',
];

for (const method of requiredReactMethods) {
  assert.match(
    androidModule,
    new RegExp(`@ReactMethod\\s+fun\\s+${method}\\s*\\(`),
    `Android NativeSyncEngine must expose ${method}, matching the iOS bridge surface used by JS`,
  );
}

assert.match(
  androidModule,
  /PermissionAwareActivity/,
  'requestPhotoPermission should prompt through React Native PermissionAwareActivity',
);
assert.match(
  androidModule,
  /READ_MEDIA_VISUAL_USER_SELECTED/,
  'Android 14+ selected-photos permission should map to the same limited state iOS exposes',
);
assert.match(
  androidModule,
  /state == "limited"[\s\S]*"limited"/,
  'getPhotoAuthorizationStatus should preserve the limited state instead of flattening it to denied',
);

assert.match(
  androidModule,
  /PREF_AUTO_UPLOAD_STATE/,
  'Android auto-upload config should persist state like iOS AutoUploadConfigStore',
);
assert.match(
  androidModule,
  /persistAutoUploadInterruptedState/,
  'pauseAutoUpload should persist interrupted state',
);
assert.match(
  androidModule,
  /persistAutoUploadDisabledState/,
  'disableAutoUpload should persist disabled state',
);
assert.match(
  androidModule,
  /persistAutoUploadActiveState/,
  'resumeAutoUpload should persist active state',
);
