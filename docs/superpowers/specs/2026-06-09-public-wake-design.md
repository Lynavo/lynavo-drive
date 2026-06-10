# Public Wake Design

## Purpose

When the user explicitly asks mobile to access the bound desktop, or to retry LAN reconnect from Sync Status, the app should try to restore access if the desktop is asleep. The feature must feel close to remote-control software where possible, but it must not promise impossible public-internet wake behavior when the only computer is asleep and there is no router Wake-on-WAN, router helper, VPN fallback, or always-online LAN helper capable of injecting a wake packet.

## Core Decision

Wake-on-LAN is the core primitive. The product supports four capability tiers:

1. **Same-LAN wake, automatic:** mobile sends Wake-on-LAN magic packets to cached LAN broadcast targets when it is on the same LAN as the desktop.
2. **Public wake, router-first and setup-gated:** mobile can attempt wake from outside only when the user has configured a router path that can deliver a magic packet into the desktop's LAN. Primary supported paths are router Wake-on-WAN, router directed broadcast forwarding, or a router-provided wake helper.
3. **VPN fallback only:** if router Wake-on-WAN is not available or is blocked by ISP/router behavior, the fallback is to let the user connect a VPN back to the LAN and reuse the same-LAN wake flow when the VPN path supports wake traffic. VPN must not be positioned as the primary public wake solution or the default onboarding path.
4. **Public wake unavailable:** if the user has only one sleeping computer and no router Wake-on-WAN/helper, VPN fallback, or relay support, the app shows that the computer cannot be woken from the current network. The fallback is to wait for the desktop to wake normally or prevent deep sleep when remote access is required.

This is intentionally not a cloud relay design. A cloud service cannot wake a deeply sleeping private-LAN computer by itself unless something inside the LAN remains awake or the router forwards the wake traffic.

## Remote-Control Software Comparison

Remote-control tools do not bypass the network requirement. They typically rely on one or more of these conditions:

- Another online device or agent in the same LAN sends the Wake-on-LAN packet.
- The router supports Wake-on-WAN, directed broadcast, a vendor wake API, or VPN as a fallback network path.
- The target computer is not in deep sleep and still maintains enough network presence to reconnect.
- A platform-specific sleep proxy or network wake feature is available in that environment.

For SyncFlow, the reliable claim should be: "The app can wake the desktop automatically on the same network, and can wake it from outside only after router Wake-on-WAN/router helper setup is available. VPN is a fallback path when direct router wake is unavailable, not the main solution."

## Product Experience

### Entry Points

The wake flow is triggered only by explicit user actions:

1. Mobile opens the bound desktop's "My Computer" directory:

```text
browseSharedFiles(scope: "personal", path: "", accessToken)
```

2. Mobile shows the desktop as offline in "Sync Status" and the user taps "Reconnect" as a LAN retry.

Opening the mobile app, returning to foreground, or passively observing an offline state must not wake the computer by itself. This prevents accidental wakeups and keeps the behavior tied to clear user intent.

These entry points do not alter upload queue behavior, background upload, pairing identity, or sync state machine transitions.

### User-Visible States

- `available`: desktop sidecar is reachable and files can load.
- `waking`: app is sending wake packets and polling for the sidecar.
- `wake_setup_required`: mobile is outside the LAN and public wake requires router Wake-on-WAN/router helper setup; VPN can be offered as a fallback.
- `wake_unavailable`: no usable wake metadata or network path exists.
- `unavailable`: existing offline/network failure state after wake attempts and route fallback are exhausted.

Recommended zh-Hant UI copy:

- `waking`: `正在喚醒我的電腦...`
- `wake_setup_required`: `目前在外部網路。若要遠端喚醒，請先設定路由器 Wake-on-WAN，或改用 VPN 備援。`
- `wake_unavailable`: `這台電腦目前無法從此網路喚醒。`
- Failed wake result: `喚醒未成功，請確認電腦電源設定、網路或稍後再試。`

### Settings Copy

Desktop settings should explain platform prerequisites:

- macOS: enable "Wake for network access"; Ethernet is more reliable than sleeping Wi-Fi.
- Windows: enable BIOS/UEFI Wake-on-LAN and NIC magic-packet wake; Modern Standby, hibernate, and shutdown vary by device.
- Public wake: prefers router Wake-on-WAN or a router helper. VPN is only a fallback when router wake cannot be configured. The app cannot wake a sleeping computer through the public internet without a path into the LAN.

## Architecture

### Desktop Sidecar

While awake, the sidecar collects Wake-on-LAN metadata:

- interface name
- MAC address
- LAN IPv4 address
- LAN broadcast address
- candidate ports, usually UDP 9 and 7
- timestamp

The sidecar exposes full wake targets only to paired clients through protocol or paired presence responses. Unauthenticated health can expose only a boolean such as `wakeOnLanSupported`. mDNS TXT records must not include MAC addresses or wake targets.

### Mobile Cache

Mobile persists the latest wake metadata with the bound desktop record. The app must not depend on mDNS or sidecar responses after the desktop is already asleep.

The cached metadata is best-effort and may become stale if:

- the desktop changes network
- DHCP changes the LAN address
- the user changes network adapters
- the router or subnet changes

Stale metadata should never block existing route fallback.

### Wake Sender

For "My Computer", native mobile code resolves the route in this order:

1. Probe the latest LAN host with `/health`.
2. If reachable, use the existing LAN shared-files route or mark the sync status reconnect as recovered.
3. If unreachable and mobile appears to be on the same LAN, emit `waking`, send Wake-on-LAN packets to cached LAN broadcast targets, and poll `/health` for a bounded window.
4. If outside the LAN and a user-configured router public wake target exists, emit `waking`, send the magic packet to that public target, and poll existing reachable routes.
5. If router public wake is not configured but mobile is connected through a VPN that makes the LAN route usable, reuse the same-LAN wake flow as fallback.
6. If outside the LAN and no router wake or VPN fallback setup exists, emit `wake_setup_required`.
7. If wake fails, continue existing P2P/direct fallback behavior.
8. If all routes fail, keep the existing unavailable behavior.

For "Sync Status" -> "Reconnect", the button is a LAN retry only:

1. Start discovery and probe the latest LAN host with `/health`.
2. If reachable, mark reconnect as recovered and continue the existing sync trigger path.
3. If unreachable and mobile appears to be on the same LAN, emit `waking`, send Wake-on-LAN packets to cached LAN broadcast targets, and poll `/health` for a bounded window.
4. If mobile is connected through a VPN that makes the LAN route usable, treat it as the same LAN retry path.
5. If mobile is outside the LAN and no VPN LAN path exists, do not attempt router Wake-on-WAN from the reconnect button. Keep the existing offline/backoff behavior and direct the user to "My Computer" or wake setup surfaces when public wake is needed.

### Public Wake Target

Public wake is optional and must be setup-gated. The product should support these target types conceptually:

- `router_wan_udp`: user provides public host or DDNS name and UDP port that the router forwards to a wake-capable destination.
- `router_helper`: future extension for routers/NAS devices with authenticated wake APIs.
- `vpn_fallback`: no special public wake endpoint is stored; once the VPN places mobile inside the LAN, the same LAN wake flow is reused if the VPN/router path supports wake traffic.

The app should not automatically open router ports through UPnP/NAT-PMP in the first version. Manual setup is safer and easier to explain.

## Security And Privacy

- MAC addresses and broadcast targets are privacy-sensitive network metadata.
- Do not expose full wake targets through unauthenticated health or mDNS.
- Only paired clients can receive and persist wake metadata.
- Public wake setup must be opt-in. The app should not create public network exposure automatically.
- Wake-on-LAN magic packets are not authentication. They only wake a NIC that is already configured to respond.
- Public wake attempts should be rate-limited and bounded, for example one wake attempt sequence per "My Computer" open. LAN reconnect retries should be separately bounded and must not use public Wake-on-WAN targets.

## Recommended Approach

### Approach A: Same-LAN Only

This is the safest first implementation. It improves the common home/office Wi-Fi case and has a clear support boundary. It does not satisfy router-first public wake; VPN may reuse this path only as fallback when it makes the phone logically same-LAN and wake traffic works.

### Approach B: Same-LAN Plus Router Public Wake

This is the recommended product direction. Implement same-LAN wake first, then add manual router Wake-on-WAN settings and an extension point for router helpers. VPN remains fallback guidance, not the primary public wake product path.

### Approach C: Cloud Relay

This does not solve the user's constraint because the user has no always-online device inside the LAN. A cloud relay can coordinate but cannot inject a magic packet into a sleeping computer's private LAN without router support or an online LAN agent.

Recommendation: build Approach B in phases, with Approach A as the first shippable milestone and VPN documented as fallback.

## Phased Delivery

### Phase 1: Same-LAN Wake

- Collect wake metadata in sidecar while awake.
- Persist metadata on mobile.
- Trigger wake when "My Computer" is opened and LAN health probe fails.
- Trigger same-LAN wake when the user manually taps "Sync Status" -> "Reconnect" as a LAN retry and the normal LAN reconnect probe fails.
- Poll for sidecar recovery.
- Show `waking`, then fall back to existing offline/P2P behavior.

### Phase 2: Capability States And Diagnostics

- Add `wake_setup_required` and `wake_unavailable` states.
- Add diagnostics showing whether wake metadata exists, whether mobile appears same-LAN, and whether public wake is configured.
- Add troubleshooting docs and beta test matrix entries.

### Phase 3: Manual Router Public Wake Setup

- Add mobile/desktop settings for public wake mode.
- Support manual router host/port configuration as the primary public wake path.
- Add VPN fallback guidance for users whose router or ISP cannot support Wake-on-WAN.
- Validate public target format and rate-limit attempts.
- Do not automate router port opening.

### Phase 4: Optional LAN Helper Integrations

Only if product demand justifies it, support authenticated router/NAS helper integrations. This is outside the first implementation because it adds vendor-specific behavior and support cost.

## Success Criteria

- Same-LAN wake attempts happen automatically when the user opens "My Computer" and the desktop is asleep.
- Same-LAN wake attempts happen when the user taps "Sync Status" -> "Reconnect" while the desktop is offline, but this button remains a LAN/VPN-LAN retry and does not perform public Wake-on-WAN.
- App launch, foreground refresh, and passive offline display do not trigger wake.
- The app never promises public wake when there is no router wake/helper path, VPN fallback, or relay path.
- Public-network users see a clear setup-required state instead of a misleading spinner.
- Wake attempts never mutate upload queue order, pairing identity, history, or sync state machine semantics.
- MAC addresses are not exposed through mDNS or unauthenticated health.
- Existing shared-files fallback behavior remains intact after failed wake.

## Non-Goals

- No cloud-only wake for a single sleeping private-LAN computer.
- No always-online SyncFlow relay requirement.
- No automatic UPnP/NAT-PMP router port creation in the first version.
- No guarantee that every Mac, Windows PC, sleep mode, Wi-Fi adapter, or router can wake.
- No passive wake on app launch, foreground refresh, or offline status display alone.
- No wake attempts for normal upload queue processing unless a separate design is approved.

## Implementation Plan Relationship

The existing implementation plan at `docs/superpowers/plans/2026-06-09-wake-bound-desktop.md` should remain focused on Phase 1 same-LAN wake for two explicit entry points: opening "My Computer" and manually tapping "Sync Status" -> "Reconnect" as a LAN retry. Before implementation, it should be amended to include the capability states from Phase 2 so the product can represent "outside LAN and setup required" without pretending the wake attempt is possible.
