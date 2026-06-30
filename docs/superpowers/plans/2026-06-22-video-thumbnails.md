# Video Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate desktop-side video thumbnails and show them as lightweight image thumbnails in mobile "Recent Downloads" and "Remote Resources".

**Architecture:** The Go sidecar owns HTTP thumbnail URLs, path resolution, cache keys, and cache serving. Electron main listens for `video.thumbnail.request` events and generates JPEG posters into sidecar's thumbnail cache using `nativeImage.createThumbnailFromPath`. Mobile only consumes `thumbnailUrl`/`streamUrl`, renders thumbnails with `<Image>`, and falls back to file-type icons when thumbnails are unavailable.

**Tech Stack:** TypeScript contracts, Electron main + Vitest, Go sidecar + standard `go test`, React Native + Jest/@testing-library/react-native.

---

## Source Spec

- `docs/superpowers/specs/2026-06-22-video-thumbnails-design.md`

## File Structure

- Modify `packages/contracts/src/events.ts`
  - Add `SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST`.
  - Add the typed `SidecarEvent` union member.
- Modify `packages/contracts/src/__tests__/exports.test.ts`
  - Assert the new event constant is exported.
- Modify `services/sidecar-go/internal/api/router.go`
  - Add sidecar in-flight map fields for video thumbnail generation.
- Modify `services/sidecar-go/internal/api/handlers_shared.go`
  - Add `StreamURL` to `directoryFileDTO`.
  - Add video thumbnail source support.
  - Add stream URL propagation during directory listing.
  - Add video cache-miss event broadcast and polling.
- Modify `services/sidecar-go/internal/api/router_test.go`
  - Cover directory listing metadata and video thumbnail miss/hit behavior.
- Create `apps/desktop/src/main/video-thumbnail-generator.ts`
  - Handle `video.thumbnail.request`, validate paths, generate JPEG, and atomically write cache files.
- Create `apps/desktop/src/main/__tests__/video-thumbnail-generator.test.ts`
  - Unit-test payload validation, path validation, generation, temp cleanup, and ignored events.
- Modify `apps/desktop/src/main/index.ts`
  - Wire the generator into the existing `WsBridge` event callback.
- Modify `apps/mobile/src/services/desktop-local-service.ts`
  - Preserve video `thumbnailUrl`, `streamUrl`, and `previewUrl` for shared and personal directory resources.
- Modify `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`
  - Verify video URL propagation.
- Modify `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
  - Render video `thumbnailUrl` with `<Image>` and icon fallback.
- Modify `apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx`
  - Update global remote thumbnail expectations for video.
- Modify `apps/mobile/src/screens/DownloadRecordsGlobalScreen.tsx`
  - Stop using `<Video>` for list thumbnails.
- Modify `apps/mobile/src/screens/__tests__/DownloadRecordsGlobalScreen.test.tsx`
  - Verify video thumbnail image behavior and icon fallback.
- Modify `apps/mobile/src/screens/components/GlobalSyncActivityHomeSections.tsx`
  - Stop using `<Video>` for home recent-download thumbnails.
- Modify `apps/mobile/src/screens/components/__tests__/GlobalSyncActivityHomeSections.test.tsx`
  - Verify recent video records use `thumbnailUrl` images and local video paths fall back to icons.

## Task 1: Contracts Event

**Files:**
- Modify: `packages/contracts/src/events.ts`
- Modify: `packages/contracts/src/__tests__/exports.test.ts`

- [ ] **Step 1: Write the failing contracts export test**

Edit `packages/contracts/src/__tests__/exports.test.ts`.

Add `type SidecarEvent` to the existing import from `../index`:

```ts
  SIDECAR_EVENT_TYPES,
  type SidecarEvent,
```

Add this test inside the existing `describe('desktop-local product exports', ...)` block:

```ts
  it('exports the video thumbnail request event type', () => {
    expect(SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST).toBe(
      'video.thumbnail.request',
    );

    const event: SidecarEvent = {
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-1',
        sourcePath: '/tmp/source.mov',
        cachePath: '/tmp/thumbnail-cache/aa/cache.jpg',
        sourceVersion: '1024-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    };

    expect(event.payload.maxEdge).toBe(256);
  });
```

- [ ] **Step 2: Run the contracts test to verify it fails**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test -- exports
```

Expected: FAIL because `VIDEO_THUMBNAIL_REQUEST` is not defined on `SIDECAR_EVENT_TYPES`.

- [ ] **Step 3: Add the event constant and typed union**

Edit `packages/contracts/src/events.ts`.

Add the constant:

```ts
export const SIDECAR_EVENT_TYPES = {
  DEVICE_STATE_CHANGED: 'device.state.changed',
  DASHBOARD_UPDATED: 'dashboard.updated',
  DEVICE_MANAGEMENT_UPDATED: 'device.management.updated',
  SHARED_RESOURCES_UPDATED: 'shared.resources.updated',
  ACCESS_RECORDS_UPDATED: 'access.records.updated',
  VIDEO_THUMBNAIL_REQUEST: 'video.thumbnail.request',
} as const;
```

Add the union member to `SidecarEvent`:

```ts
  | {
      type: typeof SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST;
      payload: {
        requestId: string;
        sourcePath: string;
        cachePath: string;
        sourceVersion: string;
        maxEdge: number;
        quality: number;
      };
    }
```

- [ ] **Step 4: Run contracts tests and typecheck**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test -- exports
pnpm --filter @lynavo-drive/contracts typecheck
```

Expected: PASS.

- [ ] **Step 5: Build contracts**

Run:

```bash
pnpm --filter @lynavo-drive/contracts build
```

Expected: PASS and `packages/contracts/dist` updates.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/events.ts packages/contracts/src/__tests__/exports.test.ts packages/contracts/dist
git commit -m "feat: add video thumbnail sidecar event"
```

## Task 2: Sidecar Directory Listing Metadata

**Files:**
- Modify: `services/sidecar-go/internal/api/handlers_shared.go`
- Modify: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Write failing tests for video listing URLs**

Edit `services/sidecar-go/internal/api/router_test.go`. Add these tests near the existing personal thumbnail/list tests.

```go
func TestPersonalListReturnsVideoThumbnailAndStreamURLs(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "clip.mov"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "archive.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write unsupported video: %v", err)
	}

	resp := authorizedPersonalGET(t, srv, "/personal/list")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("personal list status=%d, want 200", resp.StatusCode)
	}

	var body struct {
		Files []struct {
			Name         string  `json:"name"`
			Type         string  `json:"type"`
			ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
			StreamURL    *string `json:"streamUrl,omitempty"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode personal list: %v", err)
	}

	files := map[string]struct {
		Type         string
		ThumbnailURL *string
		StreamURL    *string
	}{}
	for _, file := range body.Files {
		files[file.Name] = struct {
			Type         string
			ThumbnailURL *string
			StreamURL    *string
		}{Type: file.Type, ThumbnailURL: file.ThumbnailURL, StreamURL: file.StreamURL}
	}

	clip := files["clip.mov"]
	if clip.Type != "video" {
		t.Fatalf("clip.mov type=%q, want video", clip.Type)
	}
	if clip.StreamURL == nil || !strings.HasPrefix(*clip.StreamURL, "/personal/stream/clip.mov") {
		t.Fatalf("clip.mov streamUrl=%v, want personal stream URL", clip.StreamURL)
	}
	if clip.ThumbnailURL == nil || !strings.HasPrefix(*clip.ThumbnailURL, "/personal/thumbnail/clip.mov?v=") {
		t.Fatalf("clip.mov thumbnailUrl=%v, want versioned personal thumbnail URL", clip.ThumbnailURL)
	}

	archive := files["archive.mkv"]
	if archive.Type != "video" {
		t.Fatalf("archive.mkv type=%q, want video", archive.Type)
	}
	if archive.StreamURL == nil || !strings.HasPrefix(*archive.StreamURL, "/personal/stream/archive.mkv") {
		t.Fatalf("archive.mkv streamUrl=%v, want personal stream URL", archive.StreamURL)
	}
	if archive.ThumbnailURL != nil {
		t.Fatalf("archive.mkv thumbnailUrl=%q, want omitted", *archive.ThumbnailURL)
	}

	if got := regularFilesUnder(t, filepath.Join(cfg.DataDir, "thumbnail-cache")); len(got) != 0 {
		t.Fatalf("personal list generated thumbnail cache files: %+v", got)
	}
}
```

Add a shared-directory equivalent:

```go
func TestSharedListReturnsVideoThumbnailAndStreamURLs(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	if err := os.MkdirAll(cfg.SharedDir(), 0o755); err != nil {
		t.Fatalf("mkdir shared: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.SharedDir(), "walkthrough.mp4"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	resp, err := http.Get(srv.URL + "/shared/list")
	if err != nil {
		t.Fatalf("GET shared list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("shared list status=%d, want 200", resp.StatusCode)
	}

	var body struct {
		Files []struct {
			Name         string  `json:"name"`
			Type         string  `json:"type"`
			ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
			StreamURL    *string `json:"streamUrl,omitempty"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode shared list: %v", err)
	}

	if len(body.Files) != 1 {
		t.Fatalf("files=%d, want 1", len(body.Files))
	}
	file := body.Files[0]
	if file.Type != "video" {
		t.Fatalf("type=%q, want video", file.Type)
	}
	if file.StreamURL == nil || *file.StreamURL != "/shared/stream/walkthrough.mp4" {
		t.Fatalf("streamUrl=%v, want shared stream URL", file.StreamURL)
	}
	if file.ThumbnailURL == nil || !strings.HasPrefix(*file.ThumbnailURL, "/shared/thumbnail/walkthrough.mp4?v=") {
		t.Fatalf("thumbnailUrl=%v, want versioned shared thumbnail URL", file.ThumbnailURL)
	}
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
(cd services/sidecar-go && go test ./internal/api -run 'TestPersonalListReturnsVideoThumbnailAndStreamURLs|TestSharedListReturnsVideoThumbnailAndStreamURLs' -count=1)
```

Expected: FAIL because video files do not include `thumbnailUrl`/`streamUrl`.

- [ ] **Step 3: Add `StreamURL` and video thumbnail helpers**

Edit `services/sidecar-go/internal/api/handlers_shared.go`.

Change `directoryFileDTO`:

```go
type directoryFileDTO struct {
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	Type         string  `json:"type"`
	Size         int64   `json:"size"`
	ModifiedAt   string  `json:"modifiedAt"`
	ThumbnailURL *string `json:"thumbnailUrl,omitempty"`
	StreamURL    *string `json:"streamUrl,omitempty"`
	IsDirectory  bool    `json:"isDirectory,omitempty"`
}
```

Add the helper near `isSupportedDirectoryThumbnailSource`:

```go
func isSupportedVideoThumbnailSource(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".mov", ".m4v", ".webm":
		return true
	default:
		return false
	}
}
```

- [ ] **Step 4: Thread stream prefixes through directory listing**

Change `listSharedDir`:

```go
func (s *Server) listSharedDir(w http.ResponseWriter, relPath string) {
	if !s.ensureStorageDirsForRequest(w, "shared.list") {
		return
	}

	s.listDirectory(w, relPath, s.resolveSharedPath, "", "/shared/thumbnail/", "/shared/stream/", false)
}
```

Change `listDirectory` signature:

```go
func (s *Server) listDirectory(
	w http.ResponseWriter,
	relPath string,
	resolvePath func(string) (string, error),
	scope string,
	thumbnailPrefix string,
	streamPrefix string,
	versionedSupportedThumbnails bool,
) bool {
```

Update the personal caller in `services/sidecar-go/internal/api/handlers_personal.go` to pass `"/personal/thumbnail/"` and `"/personal/stream/"`:

```go
s.listDirectory(w, relPath, s.resolvePersonalPath, "personal", "/personal/thumbnail/", "/personal/stream/", true)
```

- [ ] **Step 5: Populate video URLs without generating cache files**

Inside the `for _, e := range entries` loop in `listDirectory`, replace thumbnail URL assembly with:

```go
var thumbURL *string
var streamURL *string
if !entryInfo.IsDir() {
	if fileType == "image" && thumbnailPrefix != "" {
		if !versionedSupportedThumbnails {
			u := thumbnailPrefix + filePath
			thumbURL = &u
		} else if isSupportedDirectoryThumbnailSource(e.Name()) {
			u := thumbnailPrefix + filePath + "?v=" + directoryThumbnailSourceVersion(entryInfo)
			thumbURL = &u
		}
	}
	if fileType == "video" {
		if streamPrefix != "" {
			u := streamPrefix + filePath
			streamURL = &u
		}
		if thumbnailPrefix != "" && isSupportedVideoThumbnailSource(e.Name()) {
			u := thumbnailPrefix + filePath + "?v=" + directoryThumbnailSourceVersion(entryInfo)
			thumbURL = &u
		}
	}
}
```

Include `StreamURL` in the append:

```go
files = append(files, directoryFileDTO{
	Name:         e.Name(),
	Path:         filePath,
	Type:         fileType,
	Size:         entryInfo.Size(),
	ModifiedAt:   entryInfo.ModTime().UTC().Format(time.RFC3339),
	ThumbnailURL: thumbURL,
	StreamURL:    streamURL,
	IsDirectory:  entryInfo.IsDir(),
})
```

- [ ] **Step 6: Run targeted sidecar listing tests**

Run:

```bash
(cd services/sidecar-go && go test ./internal/api -run 'TestPersonalListReturnsVideoThumbnailAndStreamURLs|TestSharedListReturnsVideoThumbnailAndStreamURLs|TestPersonalListReturnsVersionedThumbnailURLOnlyForSupportedImages' -count=1)
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/sidecar-go/internal/api/handlers_shared.go services/sidecar-go/internal/api/handlers_personal.go services/sidecar-go/internal/api/router_test.go
git commit -m "feat: expose video thumbnail metadata from sidecar lists"
```

## Task 3: Sidecar Video Thumbnail Cache Miss Flow

**Files:**
- Modify: `services/sidecar-go/internal/api/router.go`
- Modify: `services/sidecar-go/internal/api/handlers_shared.go`
- Modify: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Add failing tests for cache miss event and cache hit serving**

Edit `services/sidecar-go/internal/api/router_test.go`. Add:

```go
func TestPersonalVideoThumbnailBroadcastsRequestAndServesGeneratedCache(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal: %v", err)
	}
	videoPath := filepath.Join(cfg.PersonalDir(), "clip.mov")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/events/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial events stream: %v", err)
	}
	defer conn.Close()

	respCh := make(chan *http.Response, 1)
	errCh := make(chan error, 1)
	go func() {
		req, err := http.NewRequest(http.MethodGet, srv.URL+withPersonalClientQuery("/personal/thumbnail/clip.mov"), nil)
		if err != nil {
			errCh <- err
			return
		}
		req.Header.Set("Authorization", "Bearer dev-account-token")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			errCh <- err
			return
		}
		respCh <- resp
	}()

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read event: %v", err)
	}

	var event struct {
		Type    string `json:"type"`
		Payload struct {
			RequestID     string `json:"requestId"`
			SourcePath    string `json:"sourcePath"`
			CachePath     string `json:"cachePath"`
			SourceVersion string `json:"sourceVersion"`
			MaxEdge       int    `json:"maxEdge"`
			Quality       int    `json:"quality"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(msg, &event); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	if event.Type != "video.thumbnail.request" {
		t.Fatalf("event type=%q, want video.thumbnail.request", event.Type)
	}
	if event.Payload.SourcePath != videoPath {
		t.Fatalf("sourcePath=%q, want %q", event.Payload.SourcePath, videoPath)
	}
	if event.Payload.CachePath == "" || !strings.HasPrefix(event.Payload.CachePath, filepath.Join(cfg.DataDir, "thumbnail-cache")) {
		t.Fatalf("cachePath=%q, want path under thumbnail-cache", event.Payload.CachePath)
	}
	if event.Payload.MaxEdge != directoryThumbnailMaxEdge || event.Payload.Quality != directoryThumbnailJPEGQuality {
		t.Fatalf("maxEdge/quality=%d/%d, want %d/%d", event.Payload.MaxEdge, event.Payload.Quality, directoryThumbnailMaxEdge, directoryThumbnailJPEGQuality)
	}

	if err := os.MkdirAll(filepath.Dir(event.Payload.CachePath), 0o755); err != nil {
		t.Fatalf("mkdir cache dir: %v", err)
	}
	writeJPEGFixture(t, event.Payload.CachePath, 64, 48)

	select {
	case err := <-errCh:
		t.Fatalf("thumbnail request failed: %v", err)
	case resp := <-respCh:
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("thumbnail status=%d, want 200", resp.StatusCode)
		}
		if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/jpeg") {
			t.Fatalf("content-type=%q, want image/jpeg", contentType)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("thumbnail request timed out")
	}
}
```

Add a no-client fallback test:

```go
func TestPersonalVideoThumbnailReturnsNotFoundWhenCacheIsNotGenerated(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	if err := os.MkdirAll(cfg.PersonalDir(), 0o755); err != nil {
		t.Fatalf("mkdir personal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.PersonalDir(), "clip.mov"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	start := time.Now()
	resp := authorizedPersonalGET(t, srv, "/personal/thumbnail/clip.mov")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("thumbnail status=%d, want 404", resp.StatusCode)
	}
	if time.Since(start) < 250*time.Millisecond {
		t.Fatalf("thumbnail returned too quickly; expected polling path")
	}
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
(cd services/sidecar-go && go test ./internal/api -run 'TestPersonalVideoThumbnailBroadcastsRequestAndServesGeneratedCache|TestPersonalVideoThumbnailReturnsNotFoundWhenCacheIsNotGenerated' -count=1)
```

Expected: FAIL because video thumbnail requests return 404 without broadcasting events.

- [ ] **Step 3: Add server in-flight state**

Edit `services/sidecar-go/internal/api/router.go`.

Add `sync` to imports if it is not already present.

Add fields to `Server`:

```go
videoThumbnailMu       sync.Mutex
videoThumbnailInflight map[string]*videoThumbnailInflight
```

Initialize the map in `NewServer`:

```go
videoThumbnailInflight: make(map[string]*videoThumbnailInflight),
```

- [ ] **Step 4: Add video thumbnail coordinator and request helper**

Edit `services/sidecar-go/internal/api/handlers_shared.go`. Add `github.com/nicksyncflow/sidecar/internal/events` to imports.

Add these types and helpers near the thumbnail functions:

```go
const (
	videoThumbnailPollInterval = 100 * time.Millisecond
	videoThumbnailPollTimeout  = 3 * time.Second
)

type videoThumbnailInflight struct {
	done chan struct{}
}

func (s *Server) requestVideoThumbnail(
	r *http.Request,
	resolved string,
	info os.FileInfo,
	cachePath string,
) bool {
	s.videoThumbnailMu.Lock()
	if existing := s.videoThumbnailInflight[cachePath]; existing != nil {
		done := existing.done
		s.videoThumbnailMu.Unlock()
		select {
		case <-done:
			return fileExists(cachePath)
		case <-r.Context().Done():
			return false
		}
	}

	inflight := &videoThumbnailInflight{done: make(chan struct{})}
	s.videoThumbnailInflight[cachePath] = inflight
	s.videoThumbnailMu.Unlock()

	defer func() {
		s.videoThumbnailMu.Lock()
		if s.videoThumbnailInflight[cachePath] == inflight {
			delete(s.videoThumbnailInflight, cachePath)
		}
		close(inflight.done)
		s.videoThumbnailMu.Unlock()
	}()

	requestID := fmt.Sprintf("%x", sha256.Sum256([]byte(cachePath+"\x00"+time.Now().UTC().Format(time.RFC3339Nano))))[:16]
	s.hub.Broadcast(events.Event{
		Type: "video.thumbnail.request",
		Payload: map[string]any{
			"requestId":     requestID,
			"sourcePath":    resolved,
			"cachePath":     cachePath,
			"sourceVersion": directoryThumbnailSourceVersion(info),
			"maxEdge":       directoryThumbnailMaxEdge,
			"quality":       directoryThumbnailJPEGQuality,
		},
	})

	deadline := time.NewTimer(videoThumbnailPollTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(videoThumbnailPollInterval)
	defer ticker.Stop()

	for {
		if validCachedThumbnailFile(cachePath) {
			return true
		}
		select {
		case <-r.Context().Done():
			return false
		case <-deadline.C:
			return validCachedThumbnailFile(cachePath)
		case <-ticker.C:
		}
	}
}

func validCachedThumbnailFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}
```

- [ ] **Step 5: Route video thumbnail requests through Electron flow**

Replace the start of `serveCachedThumbnailForResolvedFile` with:

```go
isImageThumbnail := isSupportedDirectoryThumbnailSource(info.Name())
isVideoThumbnail := isSupportedVideoThumbnailSource(info.Name())
if !isImageThumbnail && !isVideoThumbnail {
	writeError(w, http.StatusNotFound, "thumbnail not available for this file type")
	return
}

cachePath := s.directoryThumbnailCachePath(resolved, info)
if validCachedThumbnailFile(cachePath) {
	serveCachedThumbnailFile(w, r, cachePath)
	return
}

if isVideoThumbnail {
	if err := acquireThumbnailSlot(r, s.thumbnailLimiter); err != nil {
		writeError(w, http.StatusServiceUnavailable, "thumbnail request cancelled")
		return
	}
	defer releaseThumbnailSlot(s.thumbnailLimiter)

	if validCachedThumbnailFile(cachePath) {
		serveCachedThumbnailFile(w, r, cachePath)
		return
	}

	if s.requestVideoThumbnail(r, resolved, info, cachePath) {
		pruneDirectoryThumbnailCache(filepath.Join(s.config.DataDir, "thumbnail-cache"), directoryThumbnailMaxCacheSize)
		serveCachedThumbnailFile(w, r, cachePath)
		return
	}

	writeError(w, http.StatusNotFound, "thumbnail not available for this file")
	return
}
```

Leave the existing image generation path below this block, but switch its cache existence checks to `validCachedThumbnailFile(cachePath)`.

- [ ] **Step 6: Run sidecar thumbnail tests**

Run:

```bash
(cd services/sidecar-go && go test ./internal/api -run 'TestPersonalVideoThumbnailBroadcastsRequestAndServesGeneratedCache|TestPersonalVideoThumbnailReturnsNotFoundWhenCacheIsNotGenerated|TestPersonalThumbnailGeneratesSmallCachedJPEG|TestPersonalThumbnailReturnsNotFoundForUnsupportedImages' -count=1)
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/sidecar-go/internal/api/router.go services/sidecar-go/internal/api/handlers_shared.go services/sidecar-go/internal/api/router_test.go
git commit -m "feat: request desktop-generated video thumbnails from sidecar"
```

## Task 4: Electron Video Thumbnail Generator

**Files:**
- Create: `apps/desktop/src/main/video-thumbnail-generator.ts`
- Create: `apps/desktop/src/main/__tests__/video-thumbnail-generator.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write failing desktop generator tests**

Create `apps/desktop/src/main/__tests__/video-thumbnail-generator.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIDECAR_EVENT_TYPES } from '@lynavo-drive/contracts';

const electronMockState = vi.hoisted(() => {
  const thumbnail = {
    isEmpty: vi.fn(() => false),
    toJPEG: vi.fn(() => Buffer.from('jpeg-bytes')),
  };
  return {
    userDataPath: '',
    thumbnail,
    createThumbnailFromPath: vi.fn(async () => thumbnail),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return electronMockState.userDataPath;
      return tmpdir();
    }),
  },
  nativeImage: {
    createThumbnailFromPath: electronMockState.createThumbnailFromPath,
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('video-thumbnail-generator', () => {
  beforeEach(() => {
    rmSync(electronMockState.userDataPath, { recursive: true, force: true });
    electronMockState.userDataPath = mkdtempSync(join(tmpdir(), 'vividrop-video-thumb-'));
    vi.clearAllMocks();
    electronMockState.thumbnail.isEmpty.mockReturnValue(false);
    electronMockState.thumbnail.toJPEG.mockReturnValue(Buffer.from('jpeg-bytes'));
  });

  it('ignores non-video-thumbnail events', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const handler = createVideoThumbnailEventHandler();

    await handler({ type: 'transfer.active.changed', payload: { isActive: true } });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it('generates a jpeg into the sidecar thumbnail cache', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'cache.jpg');
    writeFileSync(sourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-1',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).toHaveBeenCalledWith(sourcePath, {
      width: 256,
      height: 256,
    });
    expect(readFileSync(cachePath).toString()).toBe('jpeg-bytes');
  });

  it('rejects cache paths outside the thumbnail cache root', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    const outsidePath = resolve(root, '..', 'outside.jpg');
    writeFileSync(sourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-2',
        sourcePath,
        cachePath: outsidePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(outsidePath)).toBe(false);
  });

  it('removes temp files when thumbnail generation fails', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'broken.mov');
    const cacheDir = join(root, 'thumbnail-cache', 'bb');
    const cachePath = join(cacheDir, 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    electronMockState.createThumbnailFromPath.mockRejectedValueOnce(new Error('decode failed'));

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-3',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(existsSync(cachePath)).toBe(false);
    rmSync(cacheDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the desktop test to verify failure**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- video-thumbnail-generator
```

Expected: FAIL because `video-thumbnail-generator.ts` does not exist.

- [ ] **Step 3: Implement the generator module**

Create `apps/desktop/src/main/video-thumbnail-generator.ts`:

```ts
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { app, nativeImage } from 'electron';
import log from 'electron-log';
import { SIDECAR_EVENT_TYPES, type SidecarEvent } from '@lynavo-drive/contracts';

type VideoThumbnailRequestPayload = Extract<
  SidecarEvent,
  { type: typeof SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST }
>['payload'];

const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export function sidecarThumbnailCacheRoot(): string {
  return join(app.getPath('userData'), 'thumbnail-cache');
}

export function createVideoThumbnailEventHandler(
  cacheRoot: string = sidecarThumbnailCacheRoot(),
): (event: SidecarEvent) => Promise<void> {
  return async (event) => {
    if (event.type !== SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST) {
      return;
    }

    await generateVideoThumbnail(event.payload, cacheRoot);
  };
}

async function generateVideoThumbnail(
  payload: VideoThumbnailRequestPayload,
  cacheRoot: string,
): Promise<void> {
  try {
    const sourcePath = validateSourcePath(payload.sourcePath);
    const cachePath = validateCachePath(payload.cachePath, cacheRoot);
    const maxEdge = clampInteger(payload.maxEdge, 1, 1024, 256);
    const quality = clampInteger(payload.quality, 1, 100, 80);

    mkdirSync(dirname(cachePath), { recursive: true });
    const image = await nativeImage.createThumbnailFromPath(sourcePath, {
      width: maxEdge,
      height: maxEdge,
    });
    if (image.isEmpty()) {
      throw new Error('empty thumbnail');
    }

    const tmpPath = join(dirname(cachePath), `.video-thumbnail-${process.pid}-${Date.now()}.jpg`);
    try {
      writeFileSync(tmpPath, image.toJPEG(quality));
      renameSync(tmpPath, cachePath);
    } catch (err) {
      rmSync(tmpPath, { force: true });
      throw err;
    }
    log.info(`[video-thumbnail] generated requestId=${payload.requestId} cachePath=${cachePath}`);
  } catch (err) {
    log.warn(`[video-thumbnail] failed requestId=${payload.requestId}`, err);
  }
}

function validateSourcePath(value: string): string {
  if (!isAbsolute(value)) {
    throw new Error('sourcePath must be absolute');
  }
  const resolved = resolve(value);
  if (!SUPPORTED_VIDEO_EXTENSIONS.has(extname(resolved).toLowerCase())) {
    throw new Error('unsupported video extension');
  }
  const info = statSync(resolved);
  if (!info.isFile()) {
    throw new Error('sourcePath must be a file');
  }
  return resolved;
}

function validateCachePath(value: string, cacheRoot: string): string {
  if (!isAbsolute(value)) {
    throw new Error('cachePath must be absolute');
  }
  const resolvedCachePath = resolve(value);
  const resolvedCacheRoot = resolve(cacheRoot);
  if (extname(resolvedCachePath).toLowerCase() !== '.jpg') {
    throw new Error('cachePath must be a jpg');
  }
  if (
    resolvedCachePath !== resolvedCacheRoot &&
    !resolvedCachePath.startsWith(resolvedCacheRoot + sep)
  ) {
    throw new Error('cachePath must be inside thumbnail cache root');
  }
  if (existsSync(resolvedCachePath)) {
    const info = statSync(resolvedCachePath);
    if (!info.isFile()) {
      throw new Error('cachePath exists and is not a file');
    }
  }
  return resolvedCachePath;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
```

- [ ] **Step 4: Wire generator into main process**

Edit `apps/desktop/src/main/index.ts`.

Add import:

```ts
import { createVideoThumbnailEventHandler } from './video-thumbnail-generator';
```

Create the handler before `wsBridge = new WsBridge(...)`:

```ts
  const handleVideoThumbnailEvent = createVideoThumbnailEventHandler();
```

Replace the current callback:

```ts
  wsBridge = new WsBridge(
    () => mainWindow,
    (event) => {
      powerSaveCoordinator?.handleSidecarEvent(event);
      void handleVideoThumbnailEvent(event);
    },
  );
```

- [ ] **Step 5: Run desktop tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- video-thumbnail-generator ws-bridge
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/video-thumbnail-generator.ts apps/desktop/src/main/__tests__/video-thumbnail-generator.test.ts apps/desktop/src/main/index.ts
git commit -m "feat: generate video thumbnails in desktop main"
```

## Task 5: Mobile Resource URL Mapping

**Files:**
- Modify: `apps/mobile/src/services/desktop-local-service.ts`
- Modify: `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`

- [ ] **Step 1: Write failing mobile service expectations**

Edit the existing `lists global remote access from the desktop personal directory root` test in `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`.

In the mocked `walkthrough.mov` file, add:

```ts
thumbnailUrl:
  'http://192.168.1.100:39394/personal/thumbnail/walkthrough.mov?v=4096-1780000',
streamUrl:
  'http://192.168.1.100:39394/personal/stream/walkthrough.mov',
```

In the expected `walkthrough.mov` resource, add:

```ts
thumbnailUrl:
  'http://192.168.1.100:39394/personal/thumbnail/walkthrough.mov?v=4096-1780000',
previewUrl: 'http://192.168.1.100:39394/personal/stream/walkthrough.mov',
streamUrl: 'http://192.168.1.100:39394/personal/stream/walkthrough.mov',
```

Add the same expected `previewUrl`/`streamUrl` to `clip.mov`:

```ts
previewUrl: 'http://127.0.0.1:39394/personal/stream/clip.mov',
streamUrl: 'http://127.0.0.1:39394/personal/stream/clip.mov',
```

- [ ] **Step 2: Run the mobile service test to verify failure**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service
```

Expected: FAIL because `personalDirectoryFileToSharedResource` currently preserves only image `thumbnailUrl` and drops video stream URLs.

- [ ] **Step 3: Reuse directory preview URL mapping for personal directory resources**

Edit `apps/mobile/src/services/desktop-local-service.ts`.

Replace `personalDirectoryFileToSharedResource` with:

```ts
function personalDirectoryFileToSharedResource(
  file: DirectoryFileDTO,
): GlobalRemoteAccessResource {
  return {
    resourceId: personalDirectoryResourceId(file.path),
    desktopDeviceId: PERSONAL_DIRECTORY_DESKTOP_ID,
    kind: file.isDirectory ? 'shared_folder' : 'shared_file',
    displayName: file.name,
    status: 'available',
    fileSize: file.size,
    mediaType: file.type,
    addedAt: file.modifiedAt,
    downloadCount: 0,
    ...directoryFilePreviewUrls(file),
  };
}
```

- [ ] **Step 4: Run mobile service tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/services/desktop-local-service.ts apps/mobile/src/services/__tests__/desktop-local-service.test.ts
git commit -m "feat: preserve video preview urls from desktop directories"
```

## Task 6: Mobile Remote Resource Thumbnails

**Files:**
- Modify: `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx`

- [ ] **Step 1: Update the failing remote resource thumbnail test**

Edit `apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx`.

In the test currently asserting video keeps the icon, add a `thumbnailUrl` to `beta.mov`:

```ts
thumbnailUrl:
  'http://192.168.1.100:39394/personal/thumbnail/beta.mov?v=2048-1780000',
streamUrl: 'http://192.168.1.100:39394/personal/stream/beta.mov',
```

Change assertions from video icon to two image thumbnails:

```ts
const thumbnails = getAllByTestId('remote-resource-thumbnail-image');
expect(thumbnails).toHaveLength(2);
expect(queryByTestId('remote-resource-icon-photo')).toBeNull();
expect(queryByTestId('remote-resource-icon-video')).toBeNull();
```

Add a fallback test for video thumbnail errors:

```ts
it('falls back to the video file type icon when a global remote video thumbnail fails', async () => {
  mockListGlobalRemoteAccessResources.mockResolvedValueOnce([
    {
      resourceId: 'personal-dir:broken.mov',
      desktopDeviceId: 'desktop-device-id',
      displayName: 'broken.mov',
      kind: 'shared_file',
      fileSize: 2048,
      mediaType: 'video',
      status: 'available',
      addedAt: '2026-06-16T08:00:00.000Z',
      downloadCount: 0,
      thumbnailUrl:
        'http://192.168.1.100:39394/personal/thumbnail/broken.mov?v=2048-1780000',
      streamUrl: 'http://192.168.1.100:39394/personal/stream/broken.mov',
    },
  ]);

  const { getByTestId, getByText, queryByTestId } = render(
    <TestErrorBoundary>
      <RemoteAccessGlobalScreen />
    </TestErrorBoundary>,
  );

  await waitFor(() => {
    expect(getByText('broken.mov')).toBeTruthy();
    expect(getByTestId('remote-resource-thumbnail-image')).toBeTruthy();
  });

  fireEvent(getByTestId('remote-resource-thumbnail-image'), 'error');

  await waitFor(() => {
    expect(queryByTestId('remote-resource-thumbnail-image')).toBeNull();
    expect(getByTestId('remote-resource-icon-video')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the screen test to verify failure**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- SharedFilesDownloadGate
```

Expected: FAIL because `RemoteResourceVisual` only uses thumbnails for images.

- [ ] **Step 3: Render thumbnails for image and video resources**

Edit `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`.

Change `RemoteResourceVisual` thumbnail selection:

```tsx
  const supportsThumbnail = isImage(item) || isVideoFile(item.mediaType, item.displayName);
  const thumbnailUrl =
    supportsThumbnail && !thumbnailFailed ? item.thumbnailUrl?.trim() : undefined;
```

Keep the existing `<Image testID="remote-resource-thumbnail-image" ... />` block and fallback icon unchanged.

- [ ] **Step 4: Run the remote resource tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- SharedFilesDownloadGate
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx
git commit -m "feat: show video thumbnails in remote resources"
```

## Task 7: Mobile Recent Download Thumbnails

**Files:**
- Modify: `apps/mobile/src/screens/DownloadRecordsGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/__tests__/DownloadRecordsGlobalScreen.test.tsx`
- Modify: `apps/mobile/src/screens/components/GlobalSyncActivityHomeSections.tsx`
- Modify: `apps/mobile/src/screens/components/__tests__/GlobalSyncActivityHomeSections.test.tsx`

- [ ] **Step 1: Write failing tests for global download records**

Edit `apps/mobile/src/screens/__tests__/DownloadRecordsGlobalScreen.test.tsx`. Add a test after the existing records render tests:

```tsx
it('renders video record thumbnails as images and falls back to icon without thumbnailUrl', async () => {
  (listDownloadRecords as jest.Mock).mockResolvedValueOnce([
    {
      id: 'video-with-thumb',
      filename: 'clip.mov',
      mediaType: 'video',
      size: 2048,
      completedAt: '2026-06-17T08:00:00.000Z',
      thumbnailUrl:
        'http://192.168.1.100:39394/personal/thumbnail/clip.mov?v=2048-1780000',
      streamUrl: 'http://192.168.1.100:39394/personal/stream/clip.mov',
      source: 'global_remote',
      sourceResourceId: 'personal-dir:clip.mov',
    },
    {
      id: 'video-no-thumb',
      filename: 'fallback.mov',
      mediaType: 'video',
      size: 4096,
      completedAt: '2026-06-17T08:01:00.000Z',
      streamUrl: 'http://192.168.1.100:39394/personal/stream/fallback.mov',
      source: 'global_remote',
      sourceResourceId: 'personal-dir:fallback.mov',
    },
  ]);

  const { getByTestId, getByText, queryByTestId } = render(
    <DownloadRecordsGlobalScreen />,
  );

  await waitFor(() => {
    expect(getByText('clip.mov')).toBeTruthy();
    expect(getByText('fallback.mov')).toBeTruthy();
  });

  expect(getByTestId('download-record-thumbnail-video-with-thumb')).toBeTruthy();
  expect(queryByTestId('download-record-thumbnail-video-no-thumb')).toBeNull();
  expect(getByText('preview-video')).toBeTruthy();
});
```

This test relies on the existing `react-native-video` mock. It should fail before implementation because the video-with-thumbnail path renders `Video` rather than `Image`.

- [ ] **Step 2: Write failing home recent downloads test**

Edit `apps/mobile/src/screens/components/__tests__/GlobalSyncActivityHomeSections.test.tsx`.

Replace the video record in `renders recent image and video thumbnails from available preview sources` with a video `thumbnailUrl`:

```ts
{
  recordId: 'rec-video',
  filename: 'Client-Handoff.mov',
  mediaType: 'video',
  completedAt: '2026-06-17T08:31:00.000Z',
  thumbnailUrl: 'http://127.0.0.1:39394/thumbnail/video.jpg',
  streamUrl: 'http://127.0.0.1:39394/stream/video.mov',
},
```

Change expectations:

```ts
const imageSources = tree!.root
  .findAllByType(Image)
  .map(node => node.props.source);
const videoNodes = tree!.root.findAllByProps({
  testID: 'recent-download-thumbnail-video',
});
expect(imageSources).toContainEqual({
  uri: 'http://127.0.0.1:39394/preview/image.png',
});
expect(imageSources).toContainEqual({
  uri: 'http://127.0.0.1:39394/thumbnail/video.jpg',
});
expect(videoNodes).toHaveLength(0);
```

Add a second test for local video fallback:

```tsx
it('does not render local video paths as recent download thumbnails', () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <RecentDownloadsSection
        records={[
          {
            recordId: 'rec-video',
            filename: 'Local-Only.mov',
            mediaType: 'video',
            completedAt: '2026-06-17T08:31:00.000Z',
            localPath: '/var/mobile/Containers/Data/clip.mov',
          },
        ]}
        placeholders={placeholders}
        t={tMock}
        onPressViewAll={jest.fn()}
        variant="globalPreview"
      />,
    );
  });

  expect(
    tree!.root.findAllByProps({ testID: 'recent-download-thumbnail-video' }),
  ).toHaveLength(0);
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
});
```

- [ ] **Step 3: Run recent download tests to verify failure**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- DownloadRecordsGlobalScreen GlobalSyncActivityHomeSections
```

Expected: FAIL because list thumbnail code still uses `<Video>` for video preview URIs.

- [ ] **Step 4: Update `DownloadRecordPreviewThumbnail`**

Edit `apps/mobile/src/screens/DownloadRecordsGlobalScreen.tsx`.

Replace the thumbnail URI logic in `DownloadRecordPreviewThumbnail` with separate thumbnail-only handling:

```tsx
  const thumbnailUri = readNonEmptyUri(record.thumbnailUrl);

  if (thumbnailUri && !thumbnailFailed && (kind === 'photo' || kind === 'video')) {
    return (
      <Image
        testID={`download-record-thumbnail-${record.id}`}
        source={{ uri: thumbnailUri }}
        style={styles.previewMedia}
        resizeMode="cover"
        onError={() => setThumbnailFailed(true)}
      />
    );
  }

  if (!thumbnailUri && kind === 'photo') {
    const photoUri = getDownloadRecordThumbnailUri(record);
    if (photoUri && !thumbnailFailed) {
      return (
        <Image
          testID={`download-record-thumbnail-${record.id}`}
          source={{ uri: photoUri }}
          style={styles.previewMedia}
          resizeMode="cover"
          onError={() => setThumbnailFailed(true)}
        />
      );
    }
  }
```

Remove the `<Video testID={`download-record-thumbnail-${record.id}`} ... />` branch entirely. Leave the final fallback:

```tsx
  return <GlobalMediaPreviewIcon type={kind} />;
```

- [ ] **Step 5: Update home recent download thumbnail source logic**

Edit `apps/mobile/src/screens/components/GlobalSyncActivityHomeSections.tsx`.

Change `getRecentDownloadThumbnailSource` so video items only return image thumbnails when `thumbnailUrl` exists:

```ts
  const thumbnailUrl = readNonEmptyUri(record.thumbnailUrl);
  if (thumbnailUrl) {
    return { uri: thumbnailUrl, renderer: 'image' };
  }

  if (previewType === 'video') {
    return undefined;
  }

  const mediaUri =
    readNonEmptyUri(record.previewUrl) ??
    readNonEmptyUri(record.streamUrl) ??
    readLocalPathUri(record.localPath);
  if (!mediaUri) {
    return undefined;
  }

  return {
    uri: mediaUri,
    renderer: 'image',
  };
```

Remove the `<Video testID="recent-download-thumbnail-video" ... />` rendering branch from `RecentDownloadThumbnail`. Keep the `<Image testID="recent-download-thumbnail-image" ... />` branch and icon fallback.

- [ ] **Step 6: Run recent download tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- DownloadRecordsGlobalScreen GlobalSyncActivityHomeSections
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/DownloadRecordsGlobalScreen.tsx apps/mobile/src/screens/__tests__/DownloadRecordsGlobalScreen.test.tsx apps/mobile/src/screens/components/GlobalSyncActivityHomeSections.tsx apps/mobile/src/screens/components/__tests__/GlobalSyncActivityHomeSections.test.tsx
git commit -m "feat: render recent video thumbnails as images"
```

## Task 8: Cross-Package Verification

**Files:**
- No source edits expected unless a verification failure identifies a targeted issue.

- [ ] **Step 1: Run targeted sidecar tests**

Run:

```bash
(cd services/sidecar-go && go test ./internal/api ./internal/events)
```

Expected: PASS.

- [ ] **Step 2: Run targeted desktop tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- video-thumbnail-generator ws-bridge
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run targeted mobile tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service SharedFilesDownloadGate DownloadRecordsGlobalScreen GlobalSyncActivityHomeSections
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run shared package build after contracts changes**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Run full typecheck and tests if time allows**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: PASS. If full tests are too slow, record the exact targeted commands from Steps 1-4 and the reason full suite was deferred.

- [ ] **Step 6: Manual smoke check**

Run desktop dev locally:

```bash
pnpm --filter @lynavo-drive/desktop dev
```

From a paired mobile app or simulator:

1. Open Remote Resources.
2. Browse a personal/shared directory containing `clip.mov`.
3. Confirm the first load may show the video icon.
4. Wait for the thumbnail request to complete.
5. Reopen or refresh the list.
6. Confirm the video item displays a still image thumbnail.
7. Tap the item and confirm playback still uses the video stream.

- [ ] **Step 7: Final self-review**

Check the diff for these constraints:

```bash
git diff --stat
git diff -- packages/contracts/src/events.ts services/sidecar-go/internal/api apps/desktop/src/main apps/mobile/src/services apps/mobile/src/screens
```

Confirm:

- DTO types are still imported from `@lynavo-drive/contracts`.
- Renderer does not access filesystem, sidecar, or SQLite directly.
- Queue semantics, sync status transitions, upload concurrency, access-record semantics, and persistence schemas are unchanged except existing thumbnail/stream metadata propagation.
- `video.thumbnail.request` uses dot-notation.
- Mobile list cells do not render `<Video>` as thumbnails.

- [ ] **Step 8: Commit verification fixes or final integration commit**

If verification required small fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize video thumbnail integration"
```

If no fixes were needed, do not create an empty commit.

## Risks And Watchpoints

- `nativeImage.createThumbnailFromPath` support varies by OS and codec. Keep supported extensions conservative.
- Sidecar returns `404` for poster failure by design. Mobile must treat that as normal fallback, not an error state.
- Cache path validation in Electron must use `app.getPath('userData')/thumbnail-cache` and path resolution with platform separators.
- The first cold request can time out while Electron is generating. This is acceptable because the next image load can hit cache.
- Avoid modifying sync queue, uploader, history aggregation, or account/permission gates.
