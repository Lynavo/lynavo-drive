# Wake Bound Desktop From Shared Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow mobile to attempt same-LAN Wake-on-LAN when the user opens the bound desktop's "My Computer" shared files directory or manually taps "Sync Status" -> "Reconnect" as a LAN retry while the desktop LAN sidecar is unreachable after sleep.

**Architecture:** The desktop sidecar publishes wake metadata only while it is awake. Mobile persists that metadata with the bound desktop record, then sends Wake-on-LAN magic packets from iOS/Android before falling back to the current P2P/direct-route behavior. Wake attempts are scoped to explicit user actions: shared-files browsing may later use router-first public wake, while manual reconnect remains a LAN/VPN-LAN retry only. Upload queue semantics, passive presence recovery, sync state machine, and pairing identity remain unchanged.

**Tech Stack:** Go sidecar HTTP/TCP protocol, TypeScript contracts, React Native renderer, iOS Swift native SyncEngine, Android Kotlin native SyncEngine, Vitest, Go test, Android unit tests, standalone Swift policy tests.

---

## Phase Boundary

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-09-public-wake-design.md`: same-LAN wake for explicit user actions. It must not be described as guaranteed public-internet wake, and the Sync Status reconnect button must not be described as an external-network wake control.

Public wake from outside the LAN is possible only when the user has a network path that can deliver a magic packet into the desktop LAN. The preferred public path is router Wake-on-WAN, router directed broadcast forwarding, or a router-provided wake helper. VPN is fallback only when router wake cannot be configured; it must not become the primary public wake solution or default setup path. If the user has only one sleeping computer and no router wake/helper, VPN fallback, or relay support, there is no reliable way for SyncFlow or a cloud service to wake that computer from the public internet.

Follow-up implementation should add explicit `wake_setup_required` and `wake_unavailable` states before adding any public wake settings. Public wake settings should prioritize router host/port or router helper configuration, with VPN presented only as fallback guidance. Product copy, onboarding, and diagnostics must not make VPN look like the main public wake setup. This avoids showing an endless `waking` state when the phone is outside the LAN and no wake path exists.

Opening the mobile app, returning to foreground, or rendering an offline state is not a wake trigger. Opening `我的電腦` can start the shared-files wake sequence. Manually tapping `同步狀態` -> `重新連接` can start only a LAN/VPN-LAN retry sequence.

## Capability Model

The product behavior should be evaluated using this matrix:

| Scenario | Expected behavior | Supported by this plan |
| --- | --- | --- |
| Mobile and desktop are on the same LAN | Send Wake-on-LAN packets to cached LAN broadcast targets, then poll sidecar `/health`. | Yes |
| Mobile is outside and router Wake-on-WAN is manually configured | Future public wake target sends packet to configured public host/port. | No, follow-up primary public path |
| Mobile is outside and a router/NAS helper can send WoL | Future authenticated helper integration can request wake. | No, follow-up |
| Mobile is outside but connected to a VPN that places it inside the LAN | Treat as same-LAN if LAN health and wake traffic work. VPN is fallback only, not the main public wake setup. | Fallback only, partially through same-LAN logic |
| Mobile is outside, only one sleeping computer exists, and there is no router wake/helper, VPN fallback, or relay support | Show setup-required or unavailable; do not attempt fake cloud wake. | No explicit state in this plan; follow-up required |

## Product And Platform Constraints

- Wake-on-LAN is a best-effort LAN feature. It cannot guarantee wake on every Mac, Windows PC, network adapter, router, sleep mode, hibernate mode, or Wi-Fi power mode.
- macOS users may need System Settings -> Battery or Energy Saver -> "Wake for network access". Ethernet is more reliable than sleeping Wi-Fi.
- Windows users may need BIOS/UEFI Wake-on-LAN enabled and NIC settings such as "Allow this device to wake the computer" and "Only allow a magic packet to wake the computer". Modern Standby, hibernate, and shutdown behavior varies by device.
- Cross-subnet wake is not reliable unless the router forwards directed broadcast, provides a Wake-on-LAN helper, or the phone is connected through VPN. Router Wake-on-WAN/helper is the preferred public path; VPN is fallback. This implementation only targets same-LAN behavior.
- Public-internet wake is setup-gated and must not be promised by default. A cloud relay alone cannot wake a deeply sleeping computer behind NAT without an always-online LAN participant or router support.
- The mobile app must never depend on sidecar or mDNS responses after the desktop is asleep. It must cache wake metadata before the desktop sleeps.
- Do not publish MAC addresses in mDNS TXT records. Publish wake targets only through protocol and paired/presence responses.

## File Map

- `packages/contracts/src/enums.ts`: add `waking` shared-files reachability state.
- `packages/contracts/src/types.ts`: add `WakeTargetDTO` and `WakeCapabilityDTO`; attach `wake?: WakeCapabilityDTO | null` to `BindingStateDTO`.
- `packages/contracts/src/__tests__/exports.test.ts`: cover exported wake DTO types and the `waking` state.
- `services/sidecar-go/internal/protocol/messages.go`: add wake structs and `ServerCapabilities.Wake`.
- `services/sidecar-go/internal/wake/metadata.go`: collect LAN IPv4 interfaces, MAC addresses, broadcast addresses, and wake ports.
- `services/sidecar-go/internal/wake/metadata_test.go`: validate interface filtering and broadcast calculation.
- `services/sidecar-go/internal/server/handler_hello.go`: attach wake metadata to `HELLO_RES.serverCapabilities`.
- `services/sidecar-go/internal/server/connection_test.go`: assert HELLO response advertises wake support when metadata exists.
- `services/sidecar-go/internal/api/handlers_health.go`: expose only `wakeOnLanSupported` boolean in unauthenticated health.
- `services/sidecar-go/internal/api/presence.go`: include full wake metadata only for paired, non-revoked clients.
- `services/sidecar-go/internal/api/router_test.go`: verify health and presence wake response shape.
- `apps/mobile/ios/SyncEngine/WakeMetadata.swift`: define iOS wake metadata records shared by storage, routing, and sender code.
- `apps/mobile/ios/SyncEngine/UploadStore.swift`: persist wake metadata columns with the existing binding row.
- `apps/mobile/ios/SyncEngine/WakeOnLanService.swift`: build and send magic packets.
- `apps/mobile/ios/SyncEngine/WakeOnLanServiceTests/main.swift`: verify packet construction and target fanout with an injected sender.
- `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`: parse wake metadata from HELLO/presence, include it in binding state, and call wake before shared-files route fallback.
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt`: add pure helpers for wake metadata validation and magic packet construction.
- `apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt`: cover wake helper behavior.
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`: persist wake metadata, parse native responses, send packets, and route shared-files wake attempts.
- `apps/mobile/src/screens/SharedFilesScreen.tsx`: render `waking` reachability as the existing loading/offline status band.
- `apps/mobile/src/i18n/locales/zh-Hant/sharedFiles.json`, `zh-Hans/sharedFiles.json`, `en/sharedFiles.json`: add concise wake status copy.
- `apps/mobile/src/screens/SyncActivityScreen.tsx`: route the manual reconnect button through the native LAN retry method.
- `apps/mobile/src/screens/SyncStatusScreen.tsx`: keep offline/reconnecting display passive; do not wake on render or foreground refresh.
- `docs/operations/troubleshooting.md`, `docs/operations/mobile-diagnostics.md`, `docs/testing/beta-test-matrix.md`: document setup limits, diagnostics, and beta scenarios.

## Route Behavior

Opening "My Computer" means `browseSharedFiles(scope: "personal", path: "", accessToken)` from `apps/mobile/src/services/SyncEngineModule.ts`, which reaches iOS `SyncEngineManager.browseSharedFiles` and Android `NativeSyncEngineModule.browseSharedFiles`.

The native route resolver should follow this order:

1. Probe the current fresh LAN host quickly with `/health`.
2. If reachable, use the existing LAN route.
3. If unreachable and the request is `scope == "personal"` with `kind == "list"`, emit reachability `waking`, send Wake-on-LAN packets from persisted wake metadata, then poll `/health` for up to 25 seconds.
4. If the desktop wakes, use the existing LAN route and mark shared files `available/lan`.
5. If it does not wake, continue the existing P2P tunnel wait and cached-direct fallback behavior.
6. If all routes fail, keep current unavailable/network-error behavior.

This route behavior assumes the phone is on the same LAN. VPN may make the phone logically same-LAN, but that is a fallback path and still depends on whether the VPN/router path carries wake traffic. If mobile is on an unrelated public network, the same-LAN wake packet may never reach the desktop. A follow-up phase should first try configured router Wake-on-WAN/router helper targets, then fall back to VPN guidance, and surface `wake_setup_required` instead of showing `waking` for the full timeout when neither path exists.

## Manual Reconnect LAN Retry Behavior

The manual reconnect button in `apps/mobile/src/screens/SyncActivityScreen.tsx` should be a LAN retry, not a public wake button. The intended order is:

1. User sees the bound desktop as offline in the sync status/activity surface.
2. User taps `重新連接`.
3. JS calls a native method such as `NativeSyncEngine.retryLanReconnect({ allowWake: true })`.
4. Native code first performs the existing reconnect path: start discovery, probe the latest LAN host, and let normal trigger-sync recovery run if the desktop is already reachable.
5. If the latest LAN host is unreachable and the phone is on the same LAN, or on a VPN path that behaves like the LAN, native code enters the bounded same-LAN wake orchestration.
6. If `/health` recovers during polling, native code marks the desktop reachable and resumes the existing sync trigger path.
7. If the phone is outside the LAN with no VPN LAN path, the button does not attempt router Wake-on-WAN. Native code returns to existing offline/backoff behavior and JS keeps the current reconnect failure UI.
8. If LAN wake fails, native code returns to existing offline/backoff behavior and JS keeps the current reconnect failure UI.

`SyncStatusScreen.tsx` must not call the wake method from render, focus effects, foreground listeners, or passive offline banners. Passive offline UI may say the user can tap reconnect, but the wake packet is sent only after the tap.

## Task 1: Contracts Wake DTOs

**Files:**
- Modify: `packages/contracts/src/enums.ts`
- Modify: `packages/contracts/src/types.ts`
- Test: `packages/contracts/src/__tests__/exports.test.ts`

- [ ] **Step 1: Write the failing contracts test**

Add this compile-time assertion block to `packages/contracts/src/__tests__/exports.test.ts` near existing DTO export checks:

```ts
import type {
  BindingStateDTO,
  SharedFilesReachabilityDTO,
  WakeCapabilityDTO,
  WakeTargetDTO,
} from '../types';

function expectWakeTypes(
  target: WakeTargetDTO,
  wake: WakeCapabilityDTO,
  binding: BindingStateDTO,
  reachability: SharedFilesReachabilityDTO,
): void {
  expect(target.macAddress).toBe('aa:bb:cc:dd:ee:ff');
  expect(wake.targets[0]?.broadcastAddress).toBe('192.168.1.255');
  expect(binding.wake?.supported).toBe(true);
  expect(reachability.state).toBe('waking');
}

it('exports wake metadata DTOs for bound desktop wake attempts', () => {
  const target: WakeTargetDTO = {
    interfaceName: 'en0',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    ipv4Address: '192.168.1.20',
    broadcastAddress: '192.168.1.255',
    ports: [9, 7],
  };
  const wake: WakeCapabilityDTO = {
    supported: true,
    targets: [target],
    updatedAt: '2026-06-09T03:00:00.000Z',
  };
  const binding: BindingStateDTO = {
    deviceId: 'desktop-1',
    deviceName: 'Studio Mac',
    deviceAlias: 'Studio Mac',
    host: '192.168.1.20',
    port: 39393,
    connectionState: 'offline',
    pairingId: 'pair-1',
    shareEnabled: true,
    shareName: 'My Computer',
    lastBoundAt: '2026-06-09T03:00:00.000Z',
    wake,
  };
  const reachability: SharedFilesReachabilityDTO = {
    deviceId: 'desktop-1',
    state: 'waking',
    route: null,
    reason: 'wake_attempt_started',
    updatedAt: '2026-06-09T03:00:01.000Z',
  };

  expectWakeTypes(target, wake, binding, reachability);
});
```

- [ ] **Step 2: Run the contracts test and verify it fails**

Run: `pnpm --filter @syncflow/contracts test -- exports.test.ts`

Expected: TypeScript reports that `WakeCapabilityDTO`, `WakeTargetDTO`, `BindingStateDTO.wake`, or `SharedFilesReachabilityDTO.state = "waking"` is not defined.

- [ ] **Step 3: Add wake DTOs and the waking reachability state**

Change `packages/contracts/src/enums.ts`:

```ts
export type SharedFilesReachabilityState =
  | 'unknown' | 'available' | 'unavailable' | 'waking';
```

Add these interfaces before `BindingStateDTO` in `packages/contracts/src/types.ts`:

```ts
export interface WakeTargetDTO {
  interfaceName: string;
  macAddress: string;
  ipv4Address: string;
  broadcastAddress: string;
  ports: number[];
}

export interface WakeCapabilityDTO {
  supported: boolean;
  targets: WakeTargetDTO[];
  updatedAt: string;
}
```

Extend `BindingStateDTO`:

```ts
export interface BindingStateDTO {
  deviceId: string;
  deviceName: string;
  /** User-defined alias, defaults to deviceName */
  deviceAlias: string;
  host: string;
  port: number;
  connectionState: ConnectionState;
  pairingId: string;
  shareEnabled: boolean;
  shareName?: string;
  lastBoundAt: string;
  sharedFilesReachability?: SharedFilesReachabilityDTO | null;
  wake?: WakeCapabilityDTO | null;
}
```

- [ ] **Step 4: Run contracts tests**

Run: `pnpm --filter @syncflow/contracts test -- exports.test.ts`

Expected: PASS.

- [ ] **Step 5: Build contracts**

Run: `pnpm --filter @syncflow/contracts build`

Expected: package builds without TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/enums.ts packages/contracts/src/types.ts packages/contracts/src/__tests__/exports.test.ts
git commit -m "feat: add wake metadata contracts"
```

## Task 2: Sidecar Wake Metadata Provider

**Files:**
- Create: `services/sidecar-go/internal/wake/metadata.go`
- Test: `services/sidecar-go/internal/wake/metadata_test.go`
- Modify: `services/sidecar-go/internal/protocol/messages.go`

- [ ] **Step 1: Add protocol wake structs**

Add these types to `services/sidecar-go/internal/protocol/messages.go` before `ServerCapabilities`:

```go
// WakeTarget describes one LAN interface target for Wake-on-LAN packets.
type WakeTarget struct {
	InterfaceName    string `json:"interfaceName"`
	MACAddress       string `json:"macAddress"`
	IPv4Address      string `json:"ipv4Address"`
	BroadcastAddress string `json:"broadcastAddress"`
	Ports            []int  `json:"ports"`
}

// WakeCapability is advertised while the sidecar is awake and cached by mobile.
type WakeCapability struct {
	Supported bool         `json:"supported"`
	Targets   []WakeTarget `json:"targets"`
	UpdatedAt string       `json:"updatedAt"`
}
```

Extend `ServerCapabilities`:

```go
type ServerCapabilities struct {
	ShareEnabled        bool            `json:"shareEnabled"`
	ShareName           string          `json:"shareName"`
	LowDiskPauseEnabled bool            `json:"lowDiskPauseEnabled"`
	Wake                *WakeCapability `json:"wake,omitempty"`
}
```

- [ ] **Step 2: Write wake metadata tests**

Create `services/sidecar-go/internal/wake/metadata_test.go`:

```go
package wake

import (
	"net"
	"testing"
	"time"
)

func TestBroadcastAddress(t *testing.T) {
	ip := net.IPv4(192, 168, 10, 23)
	mask := net.IPv4Mask(255, 255, 255, 0)
	got := broadcastAddress(ip, mask)
	if got != "192.168.10.255" {
		t.Fatalf("broadcastAddress = %q, want 192.168.10.255", got)
	}
}

func TestMetadataFromInterfacesFiltersInvalidTargets(t *testing.T) {
	now := time.Date(2026, 6, 9, 3, 0, 0, 0, time.UTC)
	got := metadataFromInterfaceSnapshots([]interfaceSnapshot{
		{
			name:         "lo0",
			flags:        net.FlagUp | net.FlagLoopback,
			hardwareAddr: net.HardwareAddr{0, 0, 0, 0, 0, 0},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(127, 0, 0, 1), Mask: net.IPv4Mask(255, 0, 0, 0)},
			},
		},
		{
			name:         "en0",
			flags:        net.FlagUp | net.FlagMulticast,
			hardwareAddr: net.HardwareAddr{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff},
			addrs: []net.Addr{
				&net.IPNet{IP: net.IPv4(192, 168, 10, 23), Mask: net.IPv4Mask(255, 255, 255, 0)},
			},
		},
	}, now)

	if !got.Supported {
		t.Fatalf("Supported = false, want true")
	}
	if len(got.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(got.Targets))
	}
	target := got.Targets[0]
	if target.InterfaceName != "en0" {
		t.Fatalf("InterfaceName = %q, want en0", target.InterfaceName)
	}
	if target.MACAddress != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("MACAddress = %q, want aa:bb:cc:dd:ee:ff", target.MACAddress)
	}
	if target.BroadcastAddress != "192.168.10.255" {
		t.Fatalf("BroadcastAddress = %q, want 192.168.10.255", target.BroadcastAddress)
	}
	if len(target.Ports) != 2 || target.Ports[0] != 9 || target.Ports[1] != 7 {
		t.Fatalf("Ports = %#v, want [9 7]", target.Ports)
	}
}
```

- [ ] **Step 3: Run the wake tests and verify they fail**

Run: `cd services/sidecar-go && go test ./internal/wake`

Expected: FAIL because the package or functions do not exist.

- [ ] **Step 4: Implement metadata collection**

Create `services/sidecar-go/internal/wake/metadata.go`:

```go
package wake

import (
	"net"
	"strings"
	"time"

	"github.com/nicksyncflow/sidecar/internal/protocol"
)

type interfaceSnapshot struct {
	name         string
	flags        net.Flags
	hardwareAddr net.HardwareAddr
	addrs        []net.Addr
}

func Metadata() protocol.WakeCapability {
	interfaces, err := net.Interfaces()
	if err != nil {
		return protocol.WakeCapability{
			Supported: false,
			Targets:   []protocol.WakeTarget{},
			UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}
	snapshots := make([]interfaceSnapshot, 0, len(interfaces))
	for _, iface := range interfaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		snapshots = append(snapshots, interfaceSnapshot{
			name:         iface.Name,
			flags:        iface.Flags,
			hardwareAddr: iface.HardwareAddr,
			addrs:        addrs,
		})
	}
	return metadataFromInterfaceSnapshots(snapshots, time.Now().UTC())
}

func metadataFromInterfaceSnapshots(snapshots []interfaceSnapshot, now time.Time) protocol.WakeCapability {
	targets := make([]protocol.WakeTarget, 0)
	for _, snapshot := range snapshots {
		if !isUsableInterface(snapshot) {
			continue
		}
		for _, addr := range snapshot.addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ipv4 := ipNet.IP.To4()
			if ipv4 == nil || ipNet.Mask == nil {
				continue
			}
			targets = append(targets, protocol.WakeTarget{
				InterfaceName:    snapshot.name,
				MACAddress:       strings.ToLower(snapshot.hardwareAddr.String()),
				IPv4Address:      ipv4.String(),
				BroadcastAddress: broadcastAddress(ipv4, ipNet.Mask),
				Ports:            []int{9, 7},
			})
		}
	}
	return protocol.WakeCapability{
		Supported: len(targets) > 0,
		Targets:   targets,
		UpdatedAt: now.UTC().Format(time.RFC3339Nano),
	}
}

func isUsableInterface(snapshot interfaceSnapshot) bool {
	if snapshot.flags&net.FlagUp == 0 {
		return false
	}
	if snapshot.flags&net.FlagLoopback != 0 {
		return false
	}
	if len(snapshot.hardwareAddr) != 6 {
		return false
	}
	for _, b := range snapshot.hardwareAddr {
		if b != 0 {
			return true
		}
	}
	return false
}

func broadcastAddress(ip net.IP, mask net.IPMask) string {
	ipv4 := ip.To4()
	if ipv4 == nil || len(mask) != net.IPv4len {
		return ""
	}
	out := make(net.IP, net.IPv4len)
	for i := 0; i < net.IPv4len; i++ {
		out[i] = ipv4[i] | ^mask[i]
	}
	return out.String()
}
```

- [ ] **Step 5: Run wake tests**

Run: `cd services/sidecar-go && go test ./internal/wake`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/sidecar-go/internal/protocol/messages.go services/sidecar-go/internal/wake/metadata.go services/sidecar-go/internal/wake/metadata_test.go
git commit -m "feat: collect sidecar wake metadata"
```

## Task 3: Publish Wake Metadata From Sidecar

**Files:**
- Modify: `services/sidecar-go/internal/server/handler_hello.go`
- Modify: `services/sidecar-go/internal/api/handlers_health.go`
- Modify: `services/sidecar-go/internal/api/presence.go`
- Test: `services/sidecar-go/internal/server/connection_test.go`
- Test: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Write API response tests**

In `services/sidecar-go/internal/api/router_test.go`, add assertions to the existing health test or create this test using the existing router test helpers:

```go
func TestHealthAdvertisesWakeSupportWithoutTargets(t *testing.T) {
	_, handler := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	capabilities := body["capabilities"].(map[string]any)
	if _, ok := capabilities["wakeOnLanSupported"]; !ok {
		t.Fatalf("health capabilities missing wakeOnLanSupported: %#v", capabilities)
	}
	if _, leaked := capabilities["wake"]; leaked {
		t.Fatalf("health must not expose MAC wake targets")
	}
}
```

In the presence test that creates a paired device, assert:

```go
	if _, ok := body["wake"].(map[string]any); !ok {
		t.Fatalf("paired presence response missing wake metadata: %#v", body)
	}
```

- [ ] **Step 2: Run sidecar API tests and verify they fail**

Run: `cd services/sidecar-go && go test ./internal/api`

Expected: FAIL because wake fields are not present.

- [ ] **Step 3: Publish wake support in health without MAC targets**

Modify `services/sidecar-go/internal/api/handlers_health.go`:

```go
import (
	"net/http"

	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/wake"
)

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	wakeCapability := wake.Metadata()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                      true,
		"service":                 "syncflow-sidecar",
		"version":                 "0.1.0",
		"appCompatibilityVersion": protocol.AppCompatibilityVersion,
		"capabilities": map[string]any{
			"revokesPairingsOnCodeRotation": true,
			"wakeOnLanSupported":            wakeCapability.Supported,
		},
	})
}
```

- [ ] **Step 4: Include full wake metadata in paired presence**

Modify `services/sidecar-go/internal/api/presence.go` after server identity lookup:

```go
	includeWake := false
	device, deviceErr := s.store.GetPairedDevice(clientID)
	if deviceErr == nil && device != nil && device.RevokedAt == nil {
		includeWake = true
	}

	response := map[string]any{
		"ok":         true,
		"serverId":   serverID,
		"serverName": serverName,
		"shareName":  shareName,
	}
	if includeWake {
		response["wake"] = wake.Metadata()
	}
	writeJSON(w, http.StatusOK, response)
```

Add the import:

```go
	"github.com/nicksyncflow/sidecar/internal/wake"
```

Replace the existing final `writeJSON` call with the `response` map above.

- [ ] **Step 5: Include wake metadata in HELLO response**

Modify `services/sidecar-go/internal/server/handler_hello.go` imports:

```go
	"github.com/nicksyncflow/sidecar/internal/wake"
```

After `caps := protocol.ServerCapabilities{ LowDiskPauseEnabled: true }`, set:

```go
	wakeCapability := wake.Metadata()
	caps.Wake = &wakeCapability
```

This exposes targets through the TCP protocol response used by paired and newly pairing mobile clients.

- [ ] **Step 6: Run sidecar tests**

Run: `cd services/sidecar-go && go test ./internal/api ./internal/server ./internal/protocol ./internal/wake`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/sidecar-go/internal/api/handlers_health.go services/sidecar-go/internal/api/presence.go services/sidecar-go/internal/server/handler_hello.go services/sidecar-go/internal/api/router_test.go services/sidecar-go/internal/server/connection_test.go
git commit -m "feat: publish wake metadata to paired mobile clients"
```

## Task 4: Persist Wake Metadata On iOS

**Files:**
- Create: `apps/mobile/ios/SyncEngine/WakeMetadata.swift`
- Modify: `apps/mobile/ios/SyncEngine/UploadStore.swift`
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

- [ ] **Step 1: Add iOS wake model structs**

Create `apps/mobile/ios/SyncEngine/WakeMetadata.swift`:

```swift
import Foundation

struct WakeTargetRecord: Codable {
    let interfaceName: String
    let macAddress: String
    let ipv4Address: String
    let broadcastAddress: String
    let ports: [Int]
}

struct WakeCapabilityRecord: Codable {
    let supported: Bool
    let targets: [WakeTargetRecord]
    let updatedAt: String
}
```

Extend `BindingRecord`:

```swift
struct BindingRecord {
    let deviceId: String
    var deviceName: String
    var deviceAlias: String?
    let deviceType: String
    var host: String
    let port: Int
    let pairingId: String
    let pairingTokenKeychainRef: String
    var shareName: String?
    let lastBoundAt: String
    var wake: WakeCapabilityRecord?
}
```

- [ ] **Step 2: Persist wake JSON with binding**

In the migration section that uses `addColumnIfMissing`, add:

```swift
try addColumnIfMissing(table: "binding", column: "wake_metadata_json", definition: "TEXT")
```

Update `getBinding()` SQL to select `wake_metadata_json`, decode it with:

```swift
let wake: WakeCapabilityRecord?
if let rawWake = row["wake_metadata_json"] as? String,
   let wakeData = rawWake.data(using: .utf8) {
    wake = try? JSONDecoder().decode(WakeCapabilityRecord.self, from: wakeData)
} else {
    wake = nil
}
```

Pass `wake: wake` to `BindingRecord`.

Update `saveBinding(_:)` to insert the `wake_metadata_json` column:

```swift
let wakeJSON: String?
if let wake = binding.wake,
   let data = try? JSONEncoder().encode(wake) {
    wakeJSON = String(data: data, encoding: .utf8)
} else {
    wakeJSON = nil
}
```

Use:

```swift
INSERT OR REPLACE INTO binding (id, device_id, device_name, device_alias, device_type, host, port, pairing_id, pairing_token_keychain_ref, share_name, last_bound_at, wake_metadata_json)
VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
```

and append `.textOrNull(wakeJSON)` to the bindings array.

- [ ] **Step 3: Add parser helper in SyncEngineManager**

Add to `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`:

```swift
private func wakeCapability(from value: Any?) -> WakeCapabilityRecord? {
    guard let dict = value as? [String: Any] else { return nil }
    let supported = dict["supported"] as? Bool ?? false
    let updatedAt = dict["updatedAt"] as? String ?? diagnosticsTimestamp()
    let targetsRaw = dict["targets"] as? [[String: Any]] ?? []
    let targets = targetsRaw.compactMap { raw -> WakeTargetRecord? in
        guard
            let interfaceName = raw["interfaceName"] as? String,
            let macAddress = raw["macAddress"] as? String,
            let ipv4Address = raw["ipv4Address"] as? String,
            let broadcastAddress = raw["broadcastAddress"] as? String
        else {
            return nil
        }
        return WakeTargetRecord(
            interfaceName: interfaceName,
            macAddress: macAddress,
            ipv4Address: ipv4Address,
            broadcastAddress: broadcastAddress,
            ports: raw["ports"] as? [Int] ?? [9, 7]
        )
    }
    return WakeCapabilityRecord(supported: supported && !targets.isEmpty, targets: targets, updatedAt: updatedAt)
}
```

- [ ] **Step 4: Attach wake to binding state payload**

In `bindingStatePayload`, add:

```swift
if let wake = binding.wake,
   let data = try? JSONEncoder().encode(wake),
   let object = try? JSONSerialization.jsonObject(with: data) {
    payload["wake"] = object
} else {
    payload["wake"] = NSNull()
}
```

- [ ] **Step 5: Save wake from HELLO and presence**

Where `BindingRecord` is constructed from HELLO and pair responses, pass:

```swift
wake: wakeCapability(from: helloResponse["serverCapabilities"].flatMap { ($0 as? [String: Any])?["wake"] })
```

Where presence heartbeat decodes a successful response, persist any new metadata:

```swift
if let wake = wakeCapability(from: response["wake"]),
   var current = uploadStore?.getBinding(),
   current.deviceId == binding.deviceId {
    current.wake = wake
    try? uploadStore?.saveBinding(current)
    syncDiagnosticsLog("Wake", "updated wake metadata targets=\(wake.targets.count) updatedAt=\(wake.updatedAt)")
}
```

- [ ] **Step 6: Compile iOS native code**

Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`

Expected: PASS for JS/TS bridge types. Then run the existing iOS build command used in this repo, such as `pnpm release --profile cn-review --targets ios --dry-run` for command validation or the local Xcode simulator build when available.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/ios/SyncEngine/WakeMetadata.swift apps/mobile/ios/SyncEngine/UploadStore.swift apps/mobile/ios/SyncEngine/SyncEngineManager.swift
git commit -m "feat: persist iOS wake metadata"
```

## Task 5: Implement iOS Wake-on-LAN Sender

**Files:**
- Create: `apps/mobile/ios/SyncEngine/WakeOnLanService.swift`
- Test: `apps/mobile/ios/SyncEngine/WakeOnLanServiceTests/main.swift`
- Modify: iOS project file if needed so `WakeMetadata.swift` and `WakeOnLanService.swift` are included in the app target.

- [ ] **Step 1: Write packet tests**

Create `apps/mobile/ios/SyncEngine/WakeOnLanServiceTests/main.swift`:

```swift
import Foundation

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fatalError(message)
    }
}

let packet = try WakeOnLanService.magicPacket(macAddress: "aa:bb:cc:dd:ee:ff")
assert(packet.count == 102, "magic packet must be 102 bytes")
assert(Array(packet.prefix(6)) == Array(repeating: 0xff, count: 6), "magic packet prefix must be ff x 6")
let mac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff].map(UInt8.init)
for index in 0..<16 {
    let start = 6 + index * 6
    assert(Array(packet[start..<(start + 6)]) == mac, "magic packet repeat \(index) mismatch")
}

let sender = CapturingWakePacketSender()
let service = WakeOnLanService(sender: sender)
let wake = WakeCapabilityRecord(
    supported: true,
    targets: [
        WakeTargetRecord(
            interfaceName: "en0",
            macAddress: "aa:bb:cc:dd:ee:ff",
            ipv4Address: "192.168.1.20",
            broadcastAddress: "192.168.1.255",
            ports: [9, 7]
        )
    ],
    updatedAt: "2026-06-09T03:00:00.000Z"
)
let result = try service.send(wake: wake)
assert(result.sentPackets == 4, "send should target directed and limited broadcast for ports 9 and 7")
assert(sender.destinations.contains("192.168.1.255:9"), "missing directed broadcast port 9")
assert(sender.destinations.contains("255.255.255.255:7"), "missing limited broadcast port 7")

print("WakeOnLanServiceTests passed")
```

- [ ] **Step 2: Run the standalone test and verify it fails**

Run from `apps/mobile/ios/SyncEngine` with the same pattern used by existing standalone Swift tests:

```bash
swiftc WakeMetadata.swift SyncEngineError.swift WakeOnLanService.swift WakeOnLanServiceTests/main.swift -o /tmp/WakeOnLanServiceTests && /tmp/WakeOnLanServiceTests
```

Expected: FAIL because `WakeOnLanService.swift` does not exist.

- [ ] **Step 3: Implement WakeOnLanService**

Create `apps/mobile/ios/SyncEngine/WakeOnLanService.swift`:

```swift
import Foundation
import Darwin

struct WakeOnLanAttemptResult {
    let sentPackets: Int
    let targetCount: Int
}

protocol WakePacketSending {
    func send(packet: Data, host: String, port: Int) throws
}

final class UDPSocketWakePacketSender: WakePacketSending {
    func send(packet: Data, host: String, port: Int) throws {
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else {
            throw SyncEngineError.networkError("Unable to open wake UDP socket")
        }
        defer { close(fd) }

        var enabled: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &enabled, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = UInt16(port).bigEndian
        guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else {
            throw SyncEngineError.networkError("Invalid wake broadcast address")
        }

        let sent = packet.withUnsafeBytes { rawBuffer -> Int in
            guard let base = rawBuffer.baseAddress else { return -1 }
            return withUnsafePointer(to: &addr) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                    sendto(fd, base, packet.count, 0, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        if sent != packet.count {
            throw SyncEngineError.networkError("Wake packet send failed")
        }
    }
}

final class CapturingWakePacketSender: WakePacketSending {
    private(set) var destinations: [String] = []

    func send(packet: Data, host: String, port: Int) throws {
        destinations.append("\(host):\(port)")
    }
}

final class WakeOnLanService {
    private let sender: WakePacketSending

    init(sender: WakePacketSending = UDPSocketWakePacketSender()) {
        self.sender = sender
    }

    static func magicPacket(macAddress: String) throws -> Data {
        let parts = macAddress
            .split(separator: ":")
            .map(String.init)
        guard parts.count == 6 else {
            throw SyncEngineError.networkError("Invalid wake MAC address")
        }
        let macBytes = try parts.map { part -> UInt8 in
            guard let byte = UInt8(part, radix: 16) else {
                throw SyncEngineError.networkError("Invalid wake MAC address")
            }
            return byte
        }
        var packet = Data(repeating: 0xff, count: 6)
        for _ in 0..<16 {
            packet.append(contentsOf: macBytes)
        }
        return packet
    }

    func send(wake: WakeCapabilityRecord) throws -> WakeOnLanAttemptResult {
        guard wake.supported else {
            return WakeOnLanAttemptResult(sentPackets: 0, targetCount: 0)
        }
        var sent = 0
        var uniqueDestinations = Set<String>()
        for target in wake.targets {
            let packet = try Self.magicPacket(macAddress: target.macAddress)
            let hosts = [target.broadcastAddress, "255.255.255.255"]
            for host in hosts where !host.isEmpty {
                for port in target.ports where port > 0 && port <= 65535 {
                    let key = "\(host):\(port):\(target.macAddress)"
                    if uniqueDestinations.insert(key).inserted {
                        try sender.send(packet: packet, host: host, port: port)
                        sent += 1
                    }
                }
            }
        }
        return WakeOnLanAttemptResult(sentPackets: sent, targetCount: wake.targets.count)
    }
}
```

- [ ] **Step 4: Run iOS wake tests**

Run:

```bash
cd apps/mobile/ios/SyncEngine
swiftc WakeMetadata.swift SyncEngineError.swift WakeOnLanService.swift WakeOnLanServiceTests/main.swift -o /tmp/WakeOnLanServiceTests && /tmp/WakeOnLanServiceTests
```

Expected: PASS and prints `WakeOnLanServiceTests passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/SyncEngine/WakeOnLanService.swift apps/mobile/ios/SyncEngine/WakeOnLanServiceTests/main.swift
git commit -m "feat: add iOS wake-on-lan sender"
```

## Task 6: Integrate Wake Attempts Into iOS Shared Files Route

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

- [ ] **Step 1: Add wake attempt helper**

Add to `SyncEngineManager`:

```swift
private func emitSharedFilesWaking(reason: String) {
    updateSharedFilesReachability(.waking, route: nil, reason: reason)
}

private func attemptWakeForSharedFilesIfNeeded(
    binding: BindingRecord,
    requestedScope: SharedDirectoryScope,
    requestedPath: String,
    reason: String
) async -> Bool {
    guard requestedScope == .personal, requestedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty else {
        return false
    }
    guard let wake = binding.wake, wake.supported, !wake.targets.isEmpty else {
        syncDiagnosticsLog("Wake", "wake metadata missing for shared files reason=\(reason)")
        return false
    }

    emitSharedFilesWaking(reason: "wake_attempt_started")
    do {
        let result = try WakeOnLanService().send(wake: wake)
        syncDiagnosticsLog("Wake", "wake packets sent packets=\(result.sentPackets) targets=\(result.targetCount)")
    } catch {
        syncDiagnosticsLog("Wake", "wake packet send failed error=\(error)")
        return false
    }

    let deadline = Date().addingTimeInterval(25)
    while Date() < deadline {
        if let host = freshSharedFilesLANHost(for: binding),
           await canReachSharedFilesLANHost(host, timeout: 1.2) {
            syncDiagnosticsLog("Wake", "desktop woke via fresh LAN host=\(host)")
            return true
        }
        let fallbackHost = fallbackDirectSharedFilesHost(for: binding, excluding: nil)
        if let host = fallbackHost,
           SharedFilesRoutePolicy.isPrivateLANIPv4(host),
           await canReachSharedFilesLANHost(host, timeout: 1.2) {
            syncDiagnosticsLog("Wake", "desktop woke via cached LAN host=\(host)")
            return true
        }
        try? await Task.sleep(nanoseconds: 1_000_000_000)
    }
    syncDiagnosticsLog("Wake", "wake probe timed out reason=\(reason)")
    return false
}
```

- [ ] **Step 2: Pass scope and path into route preparation**

Change the signature:

```swift
private func prepareSharedFilesRoute(
    reason: String,
    requestedScope: SharedDirectoryScope? = nil,
    requestedPath: String = ""
) async -> (host: String, isTunnel: Bool)
```

In `browseSharedFiles`, call:

```swift
var route = await prepareSharedFilesRoute(
    reason: "browse_shared_files",
    requestedScope: scope,
    requestedPath: path
)
```

Leave download and preview calls on the default arguments so wake is triggered by browsing the "My Computer" entry, not background preview/download retries.

- [ ] **Step 3: Invoke wake after direct LAN probes fail and before P2P wait**

Inside `prepareSharedFilesRoute`, after the cached direct LAN probe block and before `waitForP2PTunnelActive`, add:

```swift
if let requestedScope,
   await attemptWakeForSharedFilesIfNeeded(
       binding: binding,
       requestedScope: requestedScope,
       requestedPath: requestedPath,
       reason: reason
   ),
   let lanHost = await reachableSharedFilesLANHost(for: binding) {
    sharedFilesService.sidecarHost = lanHost
    sharedFilesService.useTunnelRoute = false
    applySharedFilesLANRoute(host: lanHost, reason: "wake_attempt_succeeded")
    return (lanHost, false)
}
```

- [ ] **Step 4: Compile and run focused iOS route tests**

Run:

```bash
cd apps/mobile/ios/SyncEngine
swiftc SharedFilesRoutePolicy.swift SharedFilesRoutePolicyTests/main.swift -o /tmp/SharedFilesRoutePolicyTests && /tmp/SharedFilesRoutePolicyTests
```

Expected: PASS. Then run the local iOS simulator build if Xcode is available.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/ios/SyncEngine/SyncEngineManager.swift
git commit -m "feat: wake desktop before iOS shared files fallback"
```

## Task 7: Persist And Send Wake On Android

**Files:**
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt`
- Modify: `apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`

- [ ] **Step 1: Write Android primitive tests**

Add to `AndroidSyncPrimitivesTest.kt`:

```kotlin
@Test
fun wakeMagicPacketRepeatsMacSixteenTimes() {
  val packet = AndroidSyncPrimitives.wakeMagicPacket("aa:bb:cc:dd:ee:ff")
  assertEquals(102, packet.size)
  assertEquals(List(6) { 0xff.toByte() }, packet.take(6))
  val mac = listOf(0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff).map { it.toByte() }
  repeat(16) { index ->
    assertEquals(mac, packet.slice((6 + index * 6) until (12 + index * 6)))
  }
}

@Test
fun wakeMetadataRejectsEmptyTargets() {
  val json = JSONObject("""{"supported":true,"targets":[],"updatedAt":"2026-06-09T03:00:00.000Z"}""")
  assertFalse(AndroidSyncPrimitives.hasUsableWakeMetadata(json))
}
```

- [ ] **Step 2: Run Android unit tests and verify they fail**

Run:

```bash
cd apps/mobile/android
./gradlew testDebugUnitTest --tests com.vividrop.mobile.china.sync.AndroidSyncPrimitivesTest
```

Expected: FAIL because the helper functions do not exist.

- [ ] **Step 3: Add Android wake helpers**

Add to `AndroidSyncPrimitives.kt`:

```kotlin
fun wakeMagicPacket(macAddress: String): ByteArray {
  val macBytes = macAddress
    .split(":")
    .map { it.toInt(16).toByte() }
  require(macBytes.size == 6) { "Invalid wake MAC address" }
  return ByteArray(6 + 16 * 6) { index ->
    if (index < 6) 0xff.toByte() else macBytes[(index - 6) % 6]
  }
}

fun hasUsableWakeMetadata(json: JSONObject?): Boolean {
  if (json == null || !json.optBoolean("supported", false)) return false
  return json.optJSONArray("targets")?.length() ?: 0 > 0
}
```

- [ ] **Step 4: Extend StoredBinding**

In `NativeSyncEngineModule.kt`, add `wake: JSONObject?` to `StoredBinding`:

```kotlin
val wake: JSONObject?,
```

In `toWritableMap()`:

```kotlin
if (wake == null) {
  putNull("wake")
} else {
  putMap("wake", wake.toWritableMap())
}
```

In `toJson()` and `toDiagnosticsJson()`:

```kotlin
put("wake", wake ?: JSONObject.NULL)
```

In `fromJson()`:

```kotlin
wake = json.optJSONObject("wake"),
```

When constructing `StoredBinding` from HELLO responses, use:

```kotlin
wake = helloResponse.optJSONObject("serverCapabilities")?.optJSONObject("wake"),
```

When presence succeeds and the response includes `wake`, save a copy:

```kotlin
response.optJSONObject("wake")?.let { wake ->
  val current = loadBinding()
  if (current != null && current.deviceId == binding.deviceId) {
    saveBinding(current.copy(wake = wake))
    recordDiagnosticsLog("Wake", "updated wake metadata targets=${wake.optJSONArray("targets")?.length() ?: 0}")
  }
}
```

- [ ] **Step 5: Add Android packet sender**

Add to `NativeSyncEngineModule.kt`:

```kotlin
private fun sendWakePackets(wake: JSONObject): Int {
  val targets = wake.optJSONArray("targets") ?: return 0
  var sent = 0
  val destinations = mutableSetOf<String>()
  DatagramSocket().use { socket ->
    socket.broadcast = true
    for (targetIndex in 0 until targets.length()) {
      val target = targets.optJSONObject(targetIndex) ?: continue
      val mac = target.optString("macAddress")
      val packet = AndroidSyncPrimitives.wakeMagicPacket(mac)
      val ports = target.optJSONArray("ports") ?: JSONArray().put(9).put(7)
      val hosts = listOf(target.optString("broadcastAddress"), "255.255.255.255").filter { it.isNotBlank() }
      for (host in hosts) {
        for (portIndex in 0 until ports.length()) {
          val port = ports.optInt(portIndex)
          if (port <= 0 || port > 65535) continue
          val key = "$host:$port:$mac"
          if (!destinations.add(key)) continue
          val datagram = DatagramPacket(packet, packet.size, InetAddress.getByName(host), port)
          socket.send(datagram)
          sent += 1
        }
      }
    }
  }
  return sent
}
```

Add imports:

```kotlin
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
```

- [ ] **Step 6: Route wake attempts before Android shared-files fallback**

Add:

```kotlin
private fun shouldWakeForSharedFiles(scope: String, kind: String, path: String): Boolean =
  scope.trim().equals("personal", ignoreCase = true) &&
    kind == "list" &&
    path.trim().trim('/').isBlank()

private fun attemptWakeForSharedFiles(binding: StoredBinding, reason: String): Boolean {
  val wake = binding.wake
  if (!AndroidSyncPrimitives.hasUsableWakeMetadata(wake)) {
    recordDiagnosticsLog("Wake", "wake metadata missing for shared files reason=$reason")
    return false
  }
  updateSharedFilesReachability(
    deviceId = binding.deviceId,
    state = "waking",
    route = null,
    reason = "wake_attempt_started",
  )
  val sent = try {
    sendWakePackets(wake!!)
  } catch (error: Throwable) {
    recordDiagnosticsLog("Wake", "wake packet send failed error=${error.message ?: error.javaClass.simpleName}")
    return false
  }
  recordDiagnosticsLog("Wake", "wake packets sent packets=$sent")
  val deadline = SystemClock.elapsedRealtime() + 25_000
  while (SystemClock.elapsedRealtime() < deadline) {
    if (probeBindingReachability(binding)) {
      recordDiagnosticsLog("Wake", "desktop woke via host=${binding.host}")
      return true
    }
    Thread.sleep(1_000)
  }
  recordDiagnosticsLog("Wake", "wake probe timed out reason=$reason")
  return false
}
```

In `resolveSharedFileRoute`, before `waitForP2PTunnelActive`, add:

```kotlin
if (shouldWakeForSharedFiles(scope, kind, path) && attemptWakeForSharedFiles(binding, reason)) {
  val directDecision = AndroidSyncPrimitives.decideSharedFilesRoute(
    isTunnelActive = false,
    tunnelPort = null,
    hasTunnelCredentials = false,
    directHost = binding.host,
    directPort = DEFAULT_SIDECAR_HTTP_PORT,
  )
  updateSharedFilesReachability(
    deviceId = binding.deviceId,
    state = "available",
    route = "lan",
    reason = "wake_attempt_succeeded",
  )
  return sharedFileRoute(scope, kind, path, requestAccessToken, directDecision, initialSnapshot)
}
```

- [ ] **Step 7: Run Android tests and build**

Run:

```bash
cd apps/mobile/android
./gradlew testDebugUnitTest --tests com.vividrop.mobile.china.sync.AndroidSyncPrimitivesTest
./gradlew assembleDebug
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt
git commit -m "feat: wake desktop before Android shared files fallback"
```

## Task 8: Shared Files UI Wake Status

**Files:**
- Modify: `apps/mobile/src/screens/SharedFilesScreen.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/sharedFiles.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/sharedFiles.json`
- Modify: `apps/mobile/src/i18n/locales/en/sharedFiles.json`
- Test: `apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx`

- [ ] **Step 1: Write UI test**

In `SharedFilesDownloadGate.test.tsx`, add a test next to existing `onSharedFilesReachabilityChanged` cases:

```tsx
it('shows waking status when native reports a wake attempt', async () => {
  const { getByText } = render(<SharedFilesScreen />);

  act(() => {
    nativeListeners.get('onSharedFilesReachabilityChanged')?.({
      deviceId: 'desktop-1',
      state: 'waking',
      route: null,
      reason: 'wake_attempt_started',
      updatedAt: '2026-06-09T03:00:00.000Z',
    });
  });

  expect(getByText('正在喚醒我的電腦')).toBeTruthy();
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
pnpm --filter @syncflow/mobile test -- SharedFilesDownloadGate.test.tsx
```

Expected: FAIL because `waking` is not mapped.

- [ ] **Step 3: Add waking status type and mapping**

In `SharedFilesScreen.tsx`, extend:

```ts
type SharedFilesConnectionStatus =
  | 'lan'
  | 'p2p'
  | 'relay'
  | 'waking'
  | 'unavailable'
  | 'offline';
```

In the helper that maps `SharedFilesReachabilityDTO` to UI status, add:

```ts
if (state.state === 'waking') return 'waking';
```

In the connection status label lookup, use:

```ts
t(`sharedFiles.connectionStatus.${sharedFilesConnectionStatus}`)
```

so the new key is picked up with the existing status view.

- [ ] **Step 4: Add localized copy**

Update `apps/mobile/src/i18n/locales/zh-Hant/sharedFiles.json`:

```json
"connectionStatus": {
  "lan": "區域網路在線",
  "p2p": "P2P 在線",
  "relay": "中繼在線",
  "waking": "正在喚醒我的電腦",
  "unavailable": "電腦端不可達",
  "offline": "離線"
}
```

Update `zh-Hans`:

```json
"waking": "正在唤醒我的电脑"
```

Update `en`:

```json
"waking": "Waking My Computer"
```

- [ ] **Step 5: Run mobile UI tests and typecheck**

Run:

```bash
pnpm --filter @syncflow/mobile test -- SharedFilesDownloadGate.test.tsx
pnpm --filter @syncflow/mobile exec tsc --noEmit
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/SharedFilesScreen.tsx apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx apps/mobile/src/i18n/locales/zh-Hant/sharedFiles.json apps/mobile/src/i18n/locales/zh-Hans/sharedFiles.json apps/mobile/src/i18n/locales/en/sharedFiles.json
git commit -m "feat: show shared files wake status"
```

## Task 9: Sync Status LAN Retry Wake Trigger

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`
- Modify: `apps/mobile/src/screens/SyncActivityScreen.tsx`
- Modify: `apps/mobile/src/screens/SyncStatusScreen.tsx`
- Test: `apps/mobile/src/screens/__tests__/SyncActivityScreen.test.tsx`

- [ ] **Step 1: Add JS test for explicit LAN retry wake**

In `apps/mobile/src/screens/__tests__/SyncActivityScreen.test.tsx`, add a test next to the existing offline reconnect button coverage. If the file does not already mock `retryLanReconnect`, add it to the `NativeSyncEngine` mock:

```tsx
const retryLanReconnect = vi.fn().mockResolvedValue({ recovered: false });

NativeModules.NativeSyncEngine = {
  ...NativeModules.NativeSyncEngine,
  startDiscovery: vi.fn().mockResolvedValue(undefined),
  triggerSync: vi.fn().mockResolvedValue(undefined),
  retryLanReconnect,
};

it('uses the explicit LAN retry path when reconnect is tapped', async () => {
  const { getByText } = render(<SyncActivityScreen />);

  fireEvent.press(getByText('重新連接'));

  await waitFor(() => {
    expect(retryLanReconnect).toHaveBeenCalledWith({ allowWake: true });
  });
  expect(NativeModules.NativeSyncEngine.startDiscovery).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the JS test and verify it fails**

Run:

```bash
pnpm --filter @syncflow/mobile test -- SyncActivityScreen.test.tsx
```

Expected: FAIL because the reconnect button still calls `startDiscovery` and `triggerSync` directly.

- [ ] **Step 3: Add iOS LAN retry native method**

In `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`, add a bridge method callable as `NativeSyncEngine.retryLanReconnect({ allowWake: true })`. The method first runs the existing discovery/reconnect path; only if the LAN health probe is unreachable and `allowWake == true` does it call the same-LAN wake sender. It must not read or send configured router public wake targets.

```swift
@objc(retryLanReconnect:resolver:rejecter:)
func retryLanReconnect(
    options: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
) {
    Task {
        let allowWake = options["allowWake"] as? Bool ?? false
        do {
            startDiscovery()
            guard let binding = uploadStore?.getBinding() else {
                resolve(["recovered": false, "wakeAttempted": false])
                return
            }

            if await canReachSharedFilesLANHost(binding.host, timeout: 1.2) {
                triggerSync()
                resolve(["recovered": true, "wakeAttempted": false])
                return
            }

            var woke = false
            if allowWake {
                woke = await attemptWakeForBoundDesktop(binding: binding, reason: "lan_reconnect")
            }
            if woke {
                triggerSync()
            }
            resolve(["recovered": woke, "wakeAttempted": allowWake])
        } catch {
            reject("LAN_RETRY_FAILED", "Failed to retry LAN reconnect", error)
        }
    }
}
```

If Task 6 kept the helper named `attemptWakeForSharedFilesIfNeeded`, extract the packet send and polling body into:

```swift
private func attemptWakeForBoundDesktop(binding: BindingRecord, reason: String) async -> Bool
```

Then make `attemptWakeForSharedFilesIfNeeded(...)` call that helper after it verifies `scope == .personal` and empty path.

- [ ] **Step 4: Add Android LAN retry native method**

In `NativeSyncEngineModule.kt`, add a React method:

```kotlin
@ReactMethod
fun retryLanReconnect(options: ReadableMap, promise: Promise) {
  executor.execute {
    try {
      val allowWake = options.getBoolean("allowWake")
      startDiscoveryInternal()
      val binding = loadBinding()
      if (binding == null) {
        promise.resolve(Arguments.createMap().apply {
          putBoolean("recovered", false)
          putBoolean("wakeAttempted", false)
        })
        return@execute
      }
      if (probeBindingReachability(binding)) {
        triggerSyncInternal()
        promise.resolve(Arguments.createMap().apply {
          putBoolean("recovered", true)
          putBoolean("wakeAttempted", false)
        })
        return@execute
      }
      val woke = allowWake && attemptWakeForBoundDesktop(binding, "lan_reconnect")
      if (woke) triggerSyncInternal()
      promise.resolve(Arguments.createMap().apply {
        putBoolean("recovered", woke)
        putBoolean("wakeAttempted", allowWake)
      })
    } catch (error: Throwable) {
      promise.reject("LAN_RETRY_FAILED", "Failed to retry LAN reconnect", error)
    }
  }
}
```

This method must not load or send router public wake targets. If Task 7 kept the helper named `attemptWakeForSharedFiles`, extract the same-LAN packet send and polling body into:

```kotlin
private fun attemptWakeForBoundDesktop(binding: StoredBinding, reason: String): Boolean
```

Then make `attemptWakeForSharedFiles(binding, reason)` delegate to that helper after the shared-files route guard passes.

- [ ] **Step 5: Update the reconnect button to use the LAN retry method**

In `apps/mobile/src/screens/SyncActivityScreen.tsx`, replace the body of `handleReconnect` with:

```tsx
const handleReconnect = useCallback(async () => {
  try {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return;
    if (NativeSyncEngine.retryLanReconnect) {
      await NativeSyncEngine.retryLanReconnect({ allowWake: true });
      return;
    }
    await NativeSyncEngine.startDiscovery();
    NativeSyncEngine.triggerSync?.().catch((e: Error) => {
      console.warn('[SyncActivity] triggerSync failed:', e);
    });
  } catch (e) {
    console.warn('[SyncActivity] reconnect error:', e);
    Alert.alert(
      t('syncActivity.dialogs.reconnectFailed.title'),
      t('syncActivity.dialogs.reconnectFailed.body'),
    );
  }
}, [t]);
```

The fallback keeps older native builds usable during rollout, but the primary path is the LAN retry method. This button does not invoke public Wake-on-WAN.

- [ ] **Step 6: Keep Sync Status passive**

Review `apps/mobile/src/screens/SyncStatusScreen.tsx` and confirm no render branch, focus effect, foreground listener, or reconnect banner effect calls `NativeSyncEngine.retryLanReconnect`. If a passive effect currently calls `startDiscovery` automatically on offline status, keep it as discovery-only and do not pass `allowWake: true`.

Add this comment near the offline/reconnecting banner action wiring:

```tsx
// LAN retry wake is intentionally tied to the explicit reconnect button, not passive offline rendering.
```

- [ ] **Step 7: Run mobile verification**

Run:

```bash
pnpm --filter @syncflow/mobile test -- SyncActivityScreen.test.tsx
pnpm --filter @syncflow/mobile exec tsc --noEmit
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/ios/SyncEngine/SyncEngineManager.swift apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt apps/mobile/src/screens/SyncActivityScreen.tsx apps/mobile/src/screens/SyncStatusScreen.tsx apps/mobile/src/screens/__tests__/SyncActivityScreen.test.tsx
git commit -m "feat: retry LAN wake from sync status reconnect"
```

## Task 10: Diagnostics, Docs, And Beta Matrix

**Files:**
- Modify: `docs/operations/troubleshooting.md`
- Modify: `docs/operations/mobile-diagnostics.md`
- Modify: `docs/testing/beta-test-matrix.md`

- [ ] **Step 1: Add diagnostic log expectations**

In `docs/operations/mobile-diagnostics.md`, add a "Wake-on-LAN explicit recovery" section:

```md
### Wake-on-LAN explicit recovery

When the user opens My Computer or taps Sync Status -> Reconnect on the same LAN/VPN-LAN and the desktop LAN sidecar is unreachable, mobile logs these `Wake` diagnostics:

- `wake metadata missing for shared files`: the bound desktop has no cached wake targets.
- `wake metadata missing for lan_reconnect`: the LAN reconnect button was tapped, but the bound desktop has no cached wake targets.
- `wake packets sent packets=<n>`: mobile sent magic packets to directed and limited broadcast destinations.
- `desktop woke via host=<ip>`: `/health` became reachable during wake polling.
- `wake probe timed out`: mobile did not observe sidecar recovery within the bounded polling window.

These logs do not imply upload queue changes. Wake attempts only affect shared-files route selection or explicit LAN reconnect recovery.
```

- [ ] **Step 2: Add troubleshooting guidance**

In `docs/operations/troubleshooting.md`, add:

```md
### My Computer or LAN reconnect does not wake after desktop sleep

Wake-on-LAN is best effort. Check these items before treating it as an app regression:

- macOS: enable Wake for network access and test on Ethernet when possible.
- Windows: enable Wake-on-LAN in BIOS/UEFI and NIC power management, including magic-packet wake.
- Keep phone and desktop on the same LAN. Cross-subnet wake needs router support for directed broadcast.
- Confirm mobile diagnostics include `wake packets sent` after opening My Computer or tapping Reconnect on the same LAN/VPN-LAN. If metadata is missing, reconnect while the desktop is awake so mobile can cache wake targets.
- Confirm `/health` reaches `http://<desktop-lan-ip>:39394/health` while the desktop is awake.
```

- [ ] **Step 3: Add beta test scenarios**

In `docs/testing/beta-test-matrix.md`, add rows:

```md
| Shared files wake | macOS sleep -> mobile opens My Computer | Enable Wake for network access, bind mobile, let Mac sleep, open My Computer | Mac wakes or mobile shows unavailable after bounded wake attempt; diagnostics show packets sent and probe result |
| Shared files wake | Windows sleep -> mobile opens My Computer | Enable BIOS/NIC WoL, bind mobile, let PC sleep, open My Computer | PC wakes or mobile shows unavailable after bounded wake attempt; diagnostics show packets sent and probe result |
| Sync status LAN reconnect wake | macOS/Windows sleep -> mobile shows offline -> user taps Reconnect | Enable platform WoL settings, bind mobile, let desktop sleep, open Sync Status, tap Reconnect on the same LAN or VPN-LAN | Desktop wakes or mobile remains offline after bounded LAN wake attempt; diagnostics include `lan_reconnect` reason |
| Passive offline display | macOS/Windows sleep -> mobile app opens and shows offline | Bind mobile, let desktop sleep, open mobile app without tapping Reconnect or My Computer | No wake packets are sent; desktop remains asleep until explicit user action |
| Shared files wake | Unsupported WoL path | Disable NIC wake or use network that blocks broadcast | Mobile does not hang; existing P2P/direct fallback and unavailable UI remain usable |
```

- [ ] **Step 4: Commit docs**

```bash
git add docs/operations/troubleshooting.md docs/operations/mobile-diagnostics.md docs/testing/beta-test-matrix.md
git commit -m "docs: add explicit wake recovery diagnostics"
```

## Task 11: End-To-End Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full sidecar tests**

Run:

```bash
cd services/sidecar-go
go test ./...
```

Expected: PASS.

- [ ] **Step 2: Build shared packages**

Run:

```bash
pnpm build
```

Expected: contracts and design tokens build successfully.

- [ ] **Step 3: Run mobile TypeScript verification**

Run:

```bash
pnpm --filter @syncflow/mobile exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run Android verification**

Run:

```bash
cd apps/mobile/android
./gradlew testDebugUnitTest --tests com.vividrop.mobile.china.sync.AndroidSyncPrimitivesTest
./gradlew assembleDebug
```

Expected: PASS.

- [ ] **Step 5: Run iOS focused verification**

Run:

```bash
cd apps/mobile/ios/SyncEngine
swiftc WakeMetadata.swift SyncEngineError.swift WakeOnLanService.swift WakeOnLanServiceTests/main.swift -o /tmp/WakeOnLanServiceTests && /tmp/WakeOnLanServiceTests
swiftc SharedFilesRoutePolicy.swift SharedFilesRoutePolicyTests/main.swift -o /tmp/SharedFilesRoutePolicyTests && /tmp/SharedFilesRoutePolicyTests
```

Expected: both standalone tests pass. Then run the normal local iOS simulator or archive build used for the target release profile.

- [ ] **Step 6: Manual macOS wake test**

1. Pair mobile with macOS desktop while both are awake.
2. Confirm mobile diagnostics later include cached wake metadata with at least one target.
3. Let macOS sleep.
4. Open mobile `我的電腦`.
5. Expected: UI shows `正在喚醒我的電腦`, desktop wakes if platform settings allow it, and files load via LAN.
6. If the desktop does not wake, expected fallback is bounded wait followed by existing unavailable/P2P behavior.

- [ ] **Step 7: Manual Windows wake test**

1. Enable BIOS/UEFI and NIC magic-packet wake.
2. Pair mobile with Windows desktop while both are awake.
3. Let Windows sleep.
4. Open mobile `我的電腦`.
5. Expected: UI shows `正在喚醒我的電腦`, Windows wakes if platform settings allow it, and files load via LAN.
6. If the desktop does not wake, expected fallback is bounded wait followed by existing unavailable/P2P behavior.

- [ ] **Step 8: Manual reconnect wake test**

1. Pair mobile with macOS or Windows desktop while both are awake.
2. Confirm mobile diagnostics later include cached wake metadata with at least one target.
3. Let the desktop sleep.
4. Open mobile sync status/activity while the desktop is offline.
5. Do not tap reconnect yet.
6. Expected: desktop remains asleep and diagnostics do not show a new wake packet sequence.
7. Tap `重新連接`.
8. Expected: UI enters reconnect/waking feedback, desktop wakes if platform settings allow it, and sync resumes through the existing trigger-sync path.
9. If the desktop does not wake, expected fallback is bounded wait followed by existing offline/backoff behavior.

- [ ] **Step 9: Pollution review**

Review the diff and confirm:

- No renderer code directly accesses sidecar, filesystem, or SQLite.
- No upload queue item can be deleted, reordered, skipped, or manually selected by this change.
- No sync state machine transition changes outside shared-files route wake attempts or explicit LAN reconnect wake attempts.
- DTO additions are imported from `@syncflow/contracts` where TypeScript code consumes them.
- Sidecar event names remain dot-notation.
- mDNS TXT records do not contain MAC addresses or wake targets.

- [ ] **Step 10: Final commit**

```bash
git status --short
git log --oneline -10
```

Expected: only intentional implementation commits are present and the worktree is clean except for user-owned unrelated changes.
