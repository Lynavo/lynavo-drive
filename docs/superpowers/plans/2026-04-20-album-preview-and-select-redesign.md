# Album Preview and Select Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the mobile album workbench so tapping an item opens a full-screen preview (image + video), and the top-right circle becomes an always-visible multi-select toggle with a new select-all button.

**Architecture:** Split each list item into two touch zones (body = preview, circle = select). Remove `multiSelectMode` / long-press. New `AssetPreviewModal` uses horizontal `FlatList` pager. iOS bridge gains `getAssetPreviewSource` that lazy-loads full-resolution images and returns native video URLs; tmp cache is age/size-evicted at startup.

**Tech Stack:** React Native 0.84 + TypeScript strict, `react-native-video@^6` (new), native iOS (Swift + Photos framework), `@syncflow/contracts` (shared DTOs), Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-04-20-album-preview-and-select-redesign-design.md`

---

## File Map

**Create:**
- `apps/mobile/src/components/AssetPreviewModal.tsx` — modal + pager
- `apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx` — unit tests

**Modify:**
- `packages/contracts/src/types.ts` — add `AssetPreviewSourceDTO`
- `apps/mobile/ios/SyncEngine/AlbumBrowserService.swift` — add `getPreviewSource`
- `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` — expose `getAssetPreviewSource`, add cache cleanup
- `apps/mobile/ios/SyncEngine/RNBridge.swift` — add `@objc func getAssetPreviewSource`
- `apps/mobile/ios/SyncEngine/RNBridge.m` — add `RCT_EXTERN_METHOD`
- `apps/mobile/src/services/SyncEngineModule.ts` — add JS wrapper `getAssetPreviewSource`
- `apps/mobile/package.json` — add `react-native-video`
- `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx` — split touch zones, remove multi-select-mode, add select-all, wire modal
- `apps/mobile/src/screens/__tests__/AlbumWorkbenchScreen.test.tsx` — update tests
- `apps/mobile/src/i18n/locales/en/albumWorkbench.json`
- `apps/mobile/src/i18n/locales/zh-Hans/albumWorkbench.json`
- `apps/mobile/src/i18n/locales/zh-Hant/albumWorkbench.json`

---

## Task 1: Add `AssetPreviewSourceDTO` to contracts

**Files:**
- Modify: `packages/contracts/src/types.ts` (after `AlbumAssetDTO` around line 206)

- [ ] **Step 1: Add the DTO**

Edit `packages/contracts/src/types.ts`, insert after the `AlbumAssetDTO` block (after line 206):

```typescript
/** Preview source for a single album asset, fetched on demand from the album workbench */
export interface AssetPreviewSourceDTO {
  uri: string;
  mediaType: 'image' | 'video';
  error?: 'cloud_unavailable' | 'not_found';
}
```

- [ ] **Step 2: Verify export**

Ensure the file already uses `export interface` — no barrel change needed; `@syncflow/contracts` re-exports everything from `types.ts`.

- [ ] **Step 3: Build contracts**

Run: `pnpm build`
Expected: turbo builds `@syncflow/contracts` and `@syncflow/design-tokens` without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/types.ts
git commit -m "feat(contracts): Add AssetPreviewSourceDTO for album preview"
```

---

## Task 2: iOS native — image branch of `getPreviewSource`

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/AlbumBrowserService.swift`

- [ ] **Step 1: Add cache dir and image method**

Edit `AlbumBrowserService.swift`. Add inside the class after the existing `getThumbnail` method (around line 270):

```swift
// MARK: - Full-resolution Preview (lazy)

/// Returns a dictionary describing the preview source for a single asset.
/// Keys: "uri" (String), "mediaType" ("image"|"video"), optional "error"
/// ("cloud_unavailable"|"not_found").
func getPreviewSource(assetLocalId: String) -> [String: Any] {
    let fetchResult = PHAsset.fetchAssets(
        withLocalIdentifiers: [assetLocalId],
        options: nil
    )
    guard let asset = fetchResult.firstObject else {
        return ["uri": "", "mediaType": "image", "error": "not_found"]
    }

    switch asset.mediaType {
    case .image:
        return fetchImagePreview(asset: asset, assetLocalId: assetLocalId)
    case .video:
        return fetchVideoPreview(asset: asset)
    default:
        return ["uri": "", "mediaType": "image", "error": "not_found"]
    }
}

private func fetchImagePreview(asset: PHAsset, assetLocalId: String) -> [String: Any] {
    let cacheDir = Self.previewCacheDir()
    let safeId = assetLocalId
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: ":", with: "_")
    let cacheFile = cacheDir.appendingPathComponent("\(safeId).jpg")

    if FileManager.default.fileExists(atPath: cacheFile.path) {
        return ["uri": cacheFile.absoluteString, "mediaType": "image"]
    }

    let options = PHImageRequestOptions()
    options.deliveryMode = .highQualityFormat
    options.isNetworkAccessAllowed = true
    options.isSynchronous = true
    options.resizeMode = .none

    var resultData: Data?
    PHImageManager.default().requestImageDataAndOrientation(
        for: asset,
        options: options
    ) { data, _, _, _ in
        resultData = data
    }

    guard let data = resultData else {
        return ["uri": "", "mediaType": "image", "error": "cloud_unavailable"]
    }

    do {
        try data.write(to: cacheFile, options: .atomic)
        return ["uri": cacheFile.absoluteString, "mediaType": "image"]
    } catch {
        return ["uri": "", "mediaType": "image", "error": "not_found"]
    }
}

private func fetchVideoPreview(asset: PHAsset) -> [String: Any] {
    // Implemented in Task 3
    return ["uri": "", "mediaType": "video", "error": "not_found"]
}

static func previewCacheDir() -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("syncflow_album_previews", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -destination 'generic/platform=iOS' -configuration Debug build -quiet 2>&1 | tail -20`
Expected: Build Succeeded.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/ios/SyncEngine/AlbumBrowserService.swift
git commit -m "feat(ios): Add image branch of getPreviewSource with tmp cache"
```

---

## Task 3: iOS native — video branch of `getPreviewSource`

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/AlbumBrowserService.swift`

- [ ] **Step 1: Implement `fetchVideoPreview`**

Replace the placeholder in `AlbumBrowserService.swift`:

```swift
private func fetchVideoPreview(asset: PHAsset) -> [String: Any] {
    let options = PHVideoRequestOptions()
    options.isNetworkAccessAllowed = true
    options.deliveryMode = .automatic
    options.version = .current

    let semaphore = DispatchSemaphore(value: 0)
    var resultUrl: URL?
    let requestId = PHImageManager.default().requestAVAsset(
        forVideo: asset,
        options: options
    ) { avAsset, _, _ in
        if let urlAsset = avAsset as? AVURLAsset {
            resultUrl = urlAsset.url
        }
        semaphore.signal()
    }

    // 15-second timeout for iCloud fetches
    let timeoutResult = semaphore.wait(timeout: .now() + 15)
    if timeoutResult == .timedOut {
        PHImageManager.default().cancelImageRequest(requestId)
        return ["uri": "", "mediaType": "video", "error": "cloud_unavailable"]
    }

    guard let url = resultUrl else {
        return ["uri": "", "mediaType": "video", "error": "cloud_unavailable"]
    }
    return ["uri": url.absoluteString, "mediaType": "video"]
}
```

- [ ] **Step 2: Add AVFoundation import**

At the top of `AlbumBrowserService.swift`, ensure `import AVFoundation` is present (add if missing).

- [ ] **Step 3: Verify build**

Run: `cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -destination 'generic/platform=iOS' -configuration Debug build -quiet 2>&1 | tail -20`
Expected: Build Succeeded.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/ios/SyncEngine/AlbumBrowserService.swift
git commit -m "feat(ios): Add video branch of getPreviewSource with iCloud timeout"
```

---

## Task 4: iOS native — preview cache cleanup

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

- [ ] **Step 1: Add cleanup method**

Edit `SyncEngineManager.swift`. Add method near the existing `thumbnailCacheDir` region (~line 4278):

```swift
// MARK: - Album Preview Cache

private func cleanupPreviewCacheIfNeeded() {
    DispatchQueue.global(qos: .utility).async {
        let fm = FileManager.default
        let dir = AlbumBrowserService.previewCacheDir()
        guard let files = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: .skipsHiddenFiles
        ) else { return }

        let now = Date()
        let ttl: TimeInterval = 24 * 60 * 60
        let sizeLimit: Int64 = 500 * 1024 * 1024

        var survivors: [(URL, Date, Int64)] = []
        var totalSize: Int64 = 0

        for url in files {
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            let mtime = values?.contentModificationDate ?? .distantPast
            let size = Int64(values?.fileSize ?? 0)

            if now.timeIntervalSince(mtime) > ttl {
                try? fm.removeItem(at: url)
                continue
            }
            survivors.append((url, mtime, size))
            totalSize += size
        }

        if totalSize > sizeLimit {
            // LRU: sort by mtime asc (oldest first)
            survivors.sort { $0.1 < $1.1 }
            for (url, _, size) in survivors {
                if totalSize <= sizeLimit { break }
                try? fm.removeItem(at: url)
                totalSize -= size
            }
        }
    }
}
```

- [ ] **Step 2: Invoke at startup**

Find the `SyncEngineManager` init or a startup hook (search for existing `thumbnailCacheDir` usage / `albumBrowserService` init). Add a call to `cleanupPreviewCacheIfNeeded()` at the end of the init sequence.

If no clear startup hook exists, add a public `func startup()` and call `cleanupPreviewCacheIfNeeded()` there; ensure it is invoked from `AppDelegate.swift` on app start — but first `grep -n "SyncEngineManager.shared" apps/mobile/ios/` to locate an existing startup path. Only add the new hook if no existing one exists.

- [ ] **Step 3: Build**

Run: `cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -destination 'generic/platform=iOS' -configuration Debug build -quiet 2>&1 | tail -20`
Expected: Build Succeeded.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/ios/SyncEngine/SyncEngineManager.swift
git commit -m "feat(ios): Add preview cache cleanup (24h TTL, 500MB cap)"
```

---

## Task 5: iOS Bridge — expose `getAssetPreviewSource`

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` (add wrapper)
- Modify: `apps/mobile/ios/SyncEngine/RNBridge.swift`
- Modify: `apps/mobile/ios/SyncEngine/RNBridge.m`

- [ ] **Step 1: Add SyncEngineManager wrapper**

Append to `SyncEngineManager.swift` in the Album Browser region:

```swift
func getAssetPreviewSource(assetLocalId: String) -> [String: Any] {
    guard let service = albumBrowserService else {
        return ["uri": "", "mediaType": "image", "error": "not_found"]
    }
    return service.getPreviewSource(assetLocalId: assetLocalId)
}
```

- [ ] **Step 2: Add @objc bridge method**

Edit `RNBridge.swift`, add near `browseAlbum` (after line 284):

```swift
@objc
func getAssetPreviewSource(_ assetLocalId: NSString, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    Task {
        let result = SyncEngineManager.shared.getAssetPreviewSource(
            assetLocalId: assetLocalId as String
        )
        resolve(result)
    }
}
```

- [ ] **Step 3: Register in Objective-C bridge**

Edit `RNBridge.m`, add after the `getAlbumCollections` line (~line 28):

```objc
RCT_EXTERN_METHOD(getAssetPreviewSource:(NSString *)assetLocalId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
```

- [ ] **Step 4: Build**

Run: `cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -destination 'generic/platform=iOS' -configuration Debug build -quiet 2>&1 | tail -20`
Expected: Build Succeeded.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/SyncEngine/SyncEngineManager.swift apps/mobile/ios/SyncEngine/RNBridge.swift apps/mobile/ios/SyncEngine/RNBridge.m
git commit -m "feat(ios): Expose getAssetPreviewSource to RN bridge"
```

---

## Task 6: JS wrapper for `getAssetPreviewSource`

**Files:**
- Modify: `apps/mobile/src/services/SyncEngineModule.ts`

- [ ] **Step 1: Add import**

Edit `SyncEngineModule.ts`, extend the contracts import at the top:

```typescript
import type {
  AlbumAssetDTO,
  AssetPreviewSourceDTO,
  AutoUploadConfigDTO,
  SharedDirectoryDTO,
  AutoUploadTimeRangeMode,
} from '@syncflow/contracts';
```

- [ ] **Step 2: Add wrapper function**

Edit `SyncEngineModule.ts`, add after `getAlbumCollections` (around line 72):

```typescript
export async function getAssetPreviewSource(
  assetLocalId: string,
): Promise<AssetPreviewSourceDTO> {
  const result = await NativeSyncEngine.getAssetPreviewSource(assetLocalId);
  return result as AssetPreviewSourceDTO;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/services/SyncEngineModule.ts
git commit -m "feat(mobile): Add getAssetPreviewSource JS wrapper"
```

---

## Task 7: Install `react-native-video`

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/ios/Podfile.lock` (auto-generated)

- [ ] **Step 1: Add dependency**

Run from repo root:

```bash
pnpm --filter @syncflow/mobile add react-native-video@^6.0.0
```

- [ ] **Step 2: Pod install**

```bash
cd apps/mobile/ios && pod install && cd ../../..
```

Expected: `Installing react-native-video` appears in output; `Podfile.lock` updated.

- [ ] **Step 3: Smoke-build iOS**

```bash
cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -destination 'generic/platform=iOS' -configuration Debug build -quiet 2>&1 | tail -20
```

Expected: Build Succeeded.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json apps/mobile/ios/Podfile.lock pnpm-lock.yaml
git commit -m "chore(mobile): Add react-native-video@^6 dependency"
```

---

## Task 8: `AssetPreviewModal` — skeleton + test

**Files:**
- Create: `apps/mobile/src/components/AssetPreviewModal.tsx`
- Create: `apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx`

- [ ] **Step 1: Write failing test for render + close**

Create `apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx`:

```typescript
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import type { AlbumAssetDTO } from '@syncflow/contracts';

jest.mock('../../services/SyncEngineModule', () => ({
  getAssetPreviewSource: jest.fn().mockResolvedValue({
    uri: 'file:///tmp/test.jpg',
    mediaType: 'image',
  }),
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text: MockText } = require('react-native');
    return React.createElement(MockText, null, name);
  },
}));

import { AssetPreviewModal } from '../AssetPreviewModal';

const assets: AlbumAssetDTO[] = [
  {
    assetLocalId: 'a1',
    filename: 'IMG_0001.JPG',
    mediaType: 'image',
    fileSize: 1024,
    creationDate: '2026-04-01T00:00:00Z',
    thumbnailUri: 'file:///tmp/a1.jpg',
    isTransferred: false,
    isQueued: false,
  },
  {
    assetLocalId: 'a2',
    filename: 'VID_0002.MOV',
    mediaType: 'video',
    fileSize: 2048,
    creationDate: '2026-04-02T00:00:00Z',
    thumbnailUri: 'file:///tmp/a2.jpg',
    isTransferred: true,
    isQueued: false,
  },
];

describe('AssetPreviewModal', () => {
  it('renders header with current index/total and filename', async () => {
    const onClose = jest.fn();
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AssetPreviewModal
          visible
          assets={assets}
          initialIndex={0}
          onClose={onClose}
        />,
      );
    });
    const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
    expect(texts).toEqual(expect.arrayContaining(['1 / 2']));
    expect(texts.some((t: unknown) => typeof t === 'string' && t.includes('IMG_0001'))).toBe(true);
  });

  it('calls onClose when close button pressed', async () => {
    const onClose = jest.fn();
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AssetPreviewModal
          visible
          assets={assets}
          initialIndex={0}
          onClose={onClose}
        />,
      );
    });
    const closeButton = tree!.root.findAllByType(TouchableOpacity)[0];
    await ReactTestRenderer.act(async () => {
      closeButton.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @syncflow/mobile test -- AssetPreviewModal.test.tsx`
Expected: FAIL with "Cannot find module '../AssetPreviewModal'".

- [ ] **Step 3: Create minimal component**

Create `apps/mobile/src/components/AssetPreviewModal.tsx`:

```tsx
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Dimensions,
} from 'react-native';
import type { AlbumAssetDTO } from '@syncflow/contracts';
import { Icon } from './Icon';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface AssetPreviewModalProps {
  visible: boolean;
  assets: AlbumAssetDTO[];
  initialIndex: number;
  onClose: () => void;
}

export const AssetPreviewModal: React.FC<AssetPreviewModalProps> = ({
  visible,
  assets,
  initialIndex,
  onClose,
}) => {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const current = assets[activeIndex];

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.counter}>
            {activeIndex + 1} / {assets.length}
          </Text>
          <Text style={styles.filename} numberOfLines={1}>
            {current?.filename ?? ''}
          </Text>
        </View>
        <FlatList
          data={assets}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          keyExtractor={item => item.assetLocalId}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={event => {
            const newIndex = Math.round(
              event.nativeEvent.contentOffset.x / SCREEN_WIDTH,
            );
            setActiveIndex(newIndex);
          }}
          renderItem={() => <View style={{ width: SCREEN_WIDTH }} />}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
    gap: 12,
  },
  closeBtn: { padding: 4 },
  counter: { color: '#fff', fontSize: 14, minWidth: 60 },
  filename: { color: '#fff', fontSize: 13, flex: 1 },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @syncflow/mobile test -- AssetPreviewModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/AssetPreviewModal.tsx apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx
git commit -m "feat(mobile): Add AssetPreviewModal skeleton with pager header"
```

---

## Task 9: `AssetPreviewModal` — image rendering + loading/error

**Files:**
- Modify: `apps/mobile/src/components/AssetPreviewModal.tsx`
- Modify: `apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx`

- [ ] **Step 1: Add test for loading → image render**

Append to `AssetPreviewModal.test.tsx`:

```typescript
import { Image, ActivityIndicator } from 'react-native';
import { getAssetPreviewSource } from '../../services/SyncEngineModule';

it('shows ActivityIndicator while loading, then Image when resolved', async () => {
  (getAssetPreviewSource as jest.Mock).mockResolvedValueOnce({
    uri: 'file:///tmp/full.jpg',
    mediaType: 'image',
  });

  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AssetPreviewModal
        visible
        assets={assets}
        initialIndex={0}
        onClose={() => {}}
      />,
    );
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  const images = tree!.root.findAllByType(Image);
  expect(images.length).toBeGreaterThan(0);
  expect(images[0].props.source).toEqual({ uri: 'file:///tmp/full.jpg' });
});

it('shows error text when preview source returns cloud_unavailable', async () => {
  (getAssetPreviewSource as jest.Mock).mockResolvedValueOnce({
    uri: '',
    mediaType: 'video',
    error: 'cloud_unavailable',
  });
  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AssetPreviewModal
        visible
        assets={assets}
        initialIndex={0}
        onClose={() => {}}
      />,
    );
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
  expect(
    texts.some((t: unknown) => typeof t === 'string' && t.toLowerCase().includes('icloud')),
  ).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @syncflow/mobile test -- AssetPreviewModal.test.tsx`
Expected: FAIL — the new tests cannot find Image / error text.

- [ ] **Step 3: Implement preview page component**

Edit `AssetPreviewModal.tsx`. Add new component above the main export:

```tsx
import { Image, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { getAssetPreviewSource } from '../services/SyncEngineModule';
import type { AssetPreviewSourceDTO } from '@syncflow/contracts';
import { useTranslation } from 'react-i18next';

interface PreviewPageProps {
  asset: AlbumAssetDTO;
  isActive: boolean;
}

const PreviewPage: React.FC<PreviewPageProps> = ({ asset, isActive }) => {
  const { t } = useTranslation();
  const [source, setSource] = useState<AssetPreviewSourceDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAssetPreviewSource(asset.assetLocalId)
      .then(result => {
        if (!cancelled) {
          setSource(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSource({ uri: '', mediaType: asset.mediaType, error: 'not_found' });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.assetLocalId, asset.mediaType]);

  if (loading) {
    return (
      <View style={pageStyles.page}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (source?.error) {
    const key =
      source.error === 'cloud_unavailable'
        ? 'albumWorkbench.preview.cloudUnavailable'
        : 'albumWorkbench.preview.notFound';
    return (
      <View style={pageStyles.page}>
        <Text style={pageStyles.errorText}>{t(key)}</Text>
      </View>
    );
  }

  if (source?.mediaType === 'image') {
    return (
      <View style={pageStyles.page}>
        <Image
          source={{ uri: source.uri }}
          style={pageStyles.media}
          resizeMode="contain"
        />
      </View>
    );
  }

  // Video branch implemented in Task 10
  return <View style={pageStyles.page} />;
};

const pageStyles = StyleSheet.create({
  page: {
    width: SCREEN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: { width: SCREEN_WIDTH, height: '100%' },
  errorText: { color: '#f87171', fontSize: 14 },
});
```

Update the `FlatList` `renderItem` in the main component:

```tsx
renderItem={({ item, index }) => (
  <PreviewPage asset={item} isActive={index === activeIndex} />
)}
```

- [ ] **Step 4: Add i18n fallback for tests**

The test file needs `react-i18next` mock. Add at top of test file (below existing mocks):

```typescript
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'albumWorkbench.preview.cloudUnavailable')
        return 'iCloud 影片未下載，無法預覽';
      if (key === 'albumWorkbench.preview.notFound') return '素材找不到';
      return key;
    },
  }),
}));
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @syncflow/mobile test -- AssetPreviewModal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/AssetPreviewModal.tsx apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx
git commit -m "feat(mobile): Render image previews with loading/error states"
```

---

## Task 10: `AssetPreviewModal` — video rendering

**Files:**
- Modify: `apps/mobile/src/components/AssetPreviewModal.tsx`
- Modify: `apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx`

- [ ] **Step 1: Add test for video render and pause behavior**

Append to `AssetPreviewModal.test.tsx`:

```typescript
it('renders Video with paused=true when not active', async () => {
  (getAssetPreviewSource as jest.Mock)
    .mockResolvedValueOnce({
      uri: 'file:///tmp/a1.jpg',
      mediaType: 'image',
    })
    .mockResolvedValueOnce({
      uri: 'file:///tmp/a2.mov',
      mediaType: 'video',
    });

  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AssetPreviewModal
        visible
        assets={assets}
        initialIndex={0}
        onClose={() => {}}
      />,
    );
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  const videos = tree!.root.findAllByType('Video' as unknown as React.ComponentType);
  // video at index 1 should exist (rendered by FlatList) and be paused since activeIndex=0
  const video = videos.find(v => v.props.source?.uri === 'file:///tmp/a2.mov');
  expect(video).toBeDefined();
  expect(video?.props.paused).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @syncflow/mobile test -- AssetPreviewModal.test.tsx`
Expected: FAIL — video source is null for video branch.

- [ ] **Step 3: Implement video branch**

Edit `AssetPreviewModal.tsx`:

At the top of the file, import Video:

```typescript
import Video from 'react-native-video';
```

Replace the video stub inside `PreviewPage`:

```tsx
if (source?.mediaType === 'video') {
  return (
    <View style={pageStyles.page}>
      <Video
        source={{ uri: source.uri }}
        style={pageStyles.media}
        controls
        paused={!isActive}
        resizeMode="contain"
      />
    </View>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @syncflow/mobile test -- AssetPreviewModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/AssetPreviewModal.tsx apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx
git commit -m "feat(mobile): Render video previews with pause-when-not-active"
```

---

## Task 11: `AlbumWorkbenchScreen` — split item touch zones (grid + list)

**Files:**
- Modify: `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`

- [ ] **Step 1: Add state for preview**

Edit `AlbumWorkbenchScreen.tsx`, in the state section near `selectedIds` (~line 175), add:

```typescript
const [previewVisible, setPreviewVisible] = useState(false);
const [previewIndex, setPreviewIndex] = useState(0);
```

- [ ] **Step 2: Add preview open handler**

Add near `handleToggleSelect` (~line 435):

```typescript
const handleOpenPreview = useCallback((assetLocalId: string) => {
  const idx = filteredSortedAssets.findIndex(
    a => a.assetLocalId === assetLocalId,
  );
  if (idx < 0) return;
  setPreviewIndex(idx);
  setPreviewVisible(true);
}, [filteredSortedAssets]);
```

Note: `filteredSortedAssets` is the array currently fed to the FlatList. Grep for the actual variable name in the file (line ~1361 `data={...}`) and use that exact name.

- [ ] **Step 3: Refactor `renderGridItem`**

Replace the existing `renderGridItem` body (~line 805–862):

```tsx
const renderGridItem = useCallback(
  ({ item }: ListRenderItemInfo<AlbumAssetDTO>) => {
    const isSelected = selectedIds.has(item.assetLocalId);
    return (
      <TouchableOpacity
        style={styles.gridItem}
        activeOpacity={0.7}
        onPress={() => handleOpenPreview(item.assetLocalId)}
      >
        <Image
          source={{ uri: item.thumbnailUri }}
          style={styles.gridThumbnail}
          resizeMode="cover"
        />
        {item.isTransferred && (
          <View style={styles.transferredOverlay}>
            <Icon name="checkmark-circle" size={24} color="#fff" />
          </View>
        )}
        {item.isQueued && !item.isTransferred && (
          <View style={styles.queuedBadge}>
            <Text style={styles.queuedBadgeText}>
              {t('albumWorkbench.badges.queued')}
            </Text>
          </View>
        )}
        {item.mediaType === 'video' && (
          <View style={styles.videoIndicator}>
            <Icon name="play-circle-outline" size={16} color="#fff" />
          </View>
        )}
        {/* Selection circle — always visible for non-transferred items */}
        {!item.isTransferred && (
          <TouchableOpacity
            style={[
              styles.selectionCircle,
              isSelected && styles.selectionCircleActive,
            ]}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            onPress={() => handleToggleSelect(item.assetLocalId)}
          >
            {isSelected && <Icon name="checkmark" size={14} color="#fff" />}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  },
  [selectedIds, handleToggleSelect, handleOpenPreview, t],
);
```

- [ ] **Step 4: Refactor `renderListItem`**

Replace the existing `renderListItem` body (~line 865–929):

```tsx
const renderListItem = useCallback(
  ({ item }: ListRenderItemInfo<AlbumAssetDTO>) => {
    const isSelected = selectedIds.has(item.assetLocalId);
    return (
      <TouchableOpacity
        style={[styles.listRow, isSelected && styles.listRowSelected]}
        activeOpacity={0.7}
        onPress={() => handleOpenPreview(item.assetLocalId)}
      >
        <Image
          source={{ uri: item.thumbnailUri }}
          style={styles.listThumbnail}
          resizeMode="cover"
        />
        <View style={styles.listInfo}>
          <Text style={styles.listFileName} numberOfLines={1}>
            {item.filename}
          </Text>
          <View style={styles.listMeta}>
            <Text style={styles.listFileSize}>
              {formatBytes(item.fileSize)}
            </Text>
            <Text style={styles.listFileType}>
              {item.mediaType === 'video'
                ? t('albumWorkbench.mediaTypes.video')
                : t('albumWorkbench.mediaTypes.photo')}
            </Text>
            {item.isTransferred && (
              <View style={styles.listTransferredBadge}>
                <Icon name="checkmark" size={10} color="#22c55e" />
                <Text style={styles.listTransferredText}>
                  {t('albumWorkbench.badges.transferred')}
                </Text>
              </View>
            )}
            {item.isQueued && !item.isTransferred && (
              <Text style={styles.listQueuedText}>
                {t('albumWorkbench.badges.queued')}
              </Text>
            )}
          </View>
        </View>
        {!item.isTransferred && (
          <TouchableOpacity
            style={[
              styles.listCheckbox,
              isSelected && styles.listCheckboxActive,
            ]}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            onPress={() => handleToggleSelect(item.assetLocalId)}
          >
            {isSelected && <Icon name="checkmark" size={14} color="#fff" />}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  },
  [selectedIds, handleToggleSelect, handleOpenPreview, t],
);
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/AlbumWorkbenchScreen.tsx
git commit -m "refactor(mobile): Split album item touch zones — body=preview, circle=select"
```

---

## Task 12: `AlbumWorkbenchScreen` — remove `multiSelectMode`

**Files:**
- Modify: `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`

- [ ] **Step 1: Delete state**

Grep for `multiSelectMode` in the file and remove all occurrences:
- `useState` declaration
- `setMultiSelectMode(...)` calls (inside `handleToggleSelect`, `handleUnifiedFilterPress`, etc.)

- [ ] **Step 2: Delete `handleLongPress`**

Remove the `handleLongPress` callback (~line 437–444) and its usages in any grid/list item. After Task 11 these usages should already be gone, but verify.

- [ ] **Step 3: Simplify `handleToggleSelect`**

Replace with:

```typescript
const handleToggleSelect = useCallback((assetLocalId: string) => {
  setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(assetLocalId)) {
      next.delete(assetLocalId);
    } else {
      next.add(assetLocalId);
    }
    return next;
  });
}, []);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/AlbumWorkbenchScreen.tsx
git commit -m "refactor(mobile): Remove multiSelectMode state (circle is now always visible)"
```

---

## Task 13: `AlbumWorkbenchScreen` — select-all / deselect-all button

**Files:**
- Modify: `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`

- [ ] **Step 1: Compute selectable set**

Near the stats card render logic (search for `stats?.totalCount` ~line 781 / `stats` block), add a derived value before the return:

```typescript
const selectableIds = useMemo(
  () => filteredSortedAssets
    .filter(a => !a.isTransferred)
    .map(a => a.assetLocalId),
  [filteredSortedAssets],
);
const allSelectableSelected =
  selectableIds.length > 0 &&
  selectableIds.every(id => selectedIds.has(id));
```

(Use the actual variable name for the filtered+sorted list; see Task 11 Step 2 note.)

- [ ] **Step 2: Add toggle handler**

Near `handleToggleSelect`:

```typescript
const handleToggleSelectAll = useCallback(() => {
  if (allSelectableSelected) {
    setSelectedIds(new Set());
  } else {
    setSelectedIds(new Set(selectableIds));
  }
}, [allSelectableSelected, selectableIds]);
```

- [ ] **Step 3: Add button in stats card**

Locate the stats card JSX (~line 1196 where `selectedIds.size` is rendered). Add a `TouchableOpacity` next to the selected count display:

```tsx
{selectableIds.length > 0 && (
  <TouchableOpacity
    onPress={handleToggleSelectAll}
    style={styles.selectAllBtn}
  >
    <Text style={styles.selectAllBtnText}>
      {allSelectableSelected
        ? t('albumWorkbench.deselectAll')
        : t('albumWorkbench.selectAll')}
    </Text>
  </TouchableOpacity>
)}
```

Add styles (append to the `StyleSheet.create` block):

```typescript
selectAllBtn: {
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 6,
  backgroundColor: 'rgba(255,255,255,0.08)',
},
selectAllBtnText: {
  color: '#93c5fd',
  fontSize: 12,
  fontWeight: '500',
},
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/AlbumWorkbenchScreen.tsx
git commit -m "feat(mobile): Add select-all / deselect-all button for filtered results"
```

---

## Task 14: `AlbumWorkbenchScreen` — mount `AssetPreviewModal`

**Files:**
- Modify: `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`

- [ ] **Step 1: Import modal**

At top of file:

```typescript
import { AssetPreviewModal } from '../components/AssetPreviewModal';
```

- [ ] **Step 2: Render modal in the screen**

At the end of the JSX tree, just before the closing fragment/view of the root, add:

```tsx
<AssetPreviewModal
  visible={previewVisible}
  assets={filteredSortedAssets}
  initialIndex={previewIndex}
  onClose={() => setPreviewVisible(false)}
/>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/AlbumWorkbenchScreen.tsx
git commit -m "feat(mobile): Mount AssetPreviewModal in AlbumWorkbenchScreen"
```

---

## Task 15: Update `AlbumWorkbenchScreen.test.tsx`

**Files:**
- Modify: `apps/mobile/src/screens/__tests__/AlbumWorkbenchScreen.test.tsx`

- [ ] **Step 1: Mock new dependencies**

Add to existing `jest.mock('../../services/SyncEngineModule', ...)` (~line 38):

```typescript
getAssetPreviewSource: jest.fn().mockResolvedValue({
  uri: 'file:///tmp/x.jpg',
  mediaType: 'image',
}),
```

Add at top level:

```typescript
jest.mock('react-native-video', () => 'Video');
```

- [ ] **Step 2: Remove long-press tests**

Search for `onLongPress`, `handleLongPress`, `multiSelectMode`, `longPress` in the test file and delete those test cases.

- [ ] **Step 3: Add test — tapping item opens preview**

Add a new `it` block:

```typescript
it('opens preview modal when item body is tapped', async () => {
  mockedBrowseAlbum.mockResolvedValue([
    {
      assetLocalId: 'a1',
      filename: 'IMG.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-01T00:00:00Z',
      thumbnailUri: 'file:///tmp/a1.jpg',
      isTransferred: false,
      isQueued: false,
    },
  ]);
  mockedGetAlbumStats.mockResolvedValue({ totalCount: 1, transferredCount: 0, queuedCount: 0 });
  mockedGetAutoUploadConfig.mockResolvedValue({ enabled: false, timeRangeMode: 'all', state: 'idle' });
  mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  // Find item body TouchableOpacity by thumbnail source
  // (find first touchable whose child Image has our test uri)
  // — exact probe depends on tree; use test renderer tooling to locate
});
```

(Note: exercise of finding the element in the tree is kept intentionally concrete in Step 4 below if test harness conventions differ — follow existing patterns in the file.)

- [ ] **Step 4: Add test — tapping circle toggles selection**

```typescript
it('toggles selection when the top-right circle is tapped', async () => {
  // similar setup as above; assert that pressing the second TouchableOpacity
  // (the circle) flips the selected count visible in the stats card
});
```

(If existing file has a clear probe pattern — e.g. looking up `TouchableOpacity` instances by style or by surrounding text — mirror it.)

- [ ] **Step 5: Run mobile tests**

Run: `pnpm --filter @syncflow/mobile test`
Expected: PASS (all old + new tests).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/__tests__/AlbumWorkbenchScreen.test.tsx
git commit -m "test(mobile): Update album workbench tests for preview + circle-select"
```

---

## Task 16: i18n keys in 3 locales

**Files:**
- Modify: `apps/mobile/src/i18n/locales/en/albumWorkbench.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/albumWorkbench.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/albumWorkbench.json`

- [ ] **Step 1: Update zh-Hant (primary)**

Add top-level keys to `zh-Hant/albumWorkbench.json`:

```json
"selectAll": "全選",
"deselectAll": "取消全選",
"preview": {
  "close": "關閉",
  "loading": "載入中…",
  "cloudUnavailable": "iCloud 影片未下載，無法預覽",
  "notFound": "素材找不到",
  "indexOfTotal": "{{index}} / {{total}}"
}
```

- [ ] **Step 2: Update zh-Hans (simplified)**

```json
"selectAll": "全选",
"deselectAll": "取消全选",
"preview": {
  "close": "关闭",
  "loading": "加载中…",
  "cloudUnavailable": "iCloud 视频未下载，无法预览",
  "notFound": "素材找不到",
  "indexOfTotal": "{{index}} / {{total}}"
}
```

- [ ] **Step 3: Update en**

```json
"selectAll": "Select all",
"deselectAll": "Deselect all",
"preview": {
  "close": "Close",
  "loading": "Loading…",
  "cloudUnavailable": "iCloud video not downloaded; cannot preview",
  "notFound": "Asset not found",
  "indexOfTotal": "{{index}} / {{total}}"
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @syncflow/mobile test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/i18n/locales
git commit -m "i18n(mobile): Add preview + select-all strings in en / zh-Hans / zh-Hant"
```

---

## Task 17: Final validation gate

**Files:** (no changes — pure verification)

- [ ] **Step 1: Full typecheck**

```bash
pnpm --filter @syncflow/mobile exec tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Full test run**

```bash
pnpm --filter @syncflow/mobile test
```
Expected: All passing.

- [ ] **Step 3: Build contracts**

```bash
pnpm build
```
Expected: All workspace builds green.

- [ ] **Step 4: iOS smoke build**

```bash
cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -destination 'generic/platform=iOS' -configuration Debug build -quiet 2>&1 | tail -20
```
Expected: Build Succeeded.

- [ ] **Step 5: Manual smoke checklist (operator)**

Document in the final commit message. Device checks:
- Open album workbench → grid and list both show top-right empty circle on non-transferred items
- Transferred items show green check overlay, no circle
- Tap item body → fullscreen preview opens, shows correct index/total and filename
- Swipe left/right → index updates; only current page's video plays, others paused
- Tap circle (grid and list) → item selected; tap again → deselected
- Select multiple circles → stats card shows N; upload button enabled; triggers upload
- Tap "Select all" → all non-transferred in current filter selected; label flips to "Deselect all"
- Filter tab change → selection clears
- Preview iCloud video that is not downloaded → shows "iCloud video not downloaded" error within 15s

- [ ] **Step 6: Final validation commit (if any doc touch-up)**

If only verifications succeeded, no commit needed. Otherwise:

```bash
git commit -m "chore(mobile): Verify album preview feature passes all gates"
```
