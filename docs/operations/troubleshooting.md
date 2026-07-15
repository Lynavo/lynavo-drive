# Lynavo Drive Troubleshooting Guide

This document gives new contributors a unified troubleshooting entry point. Use
layered diagnosis before guessing.

## 1. Identify The Layer First

When an issue appears, first decide which layer it belongs to:

1. **desktop / sidecar layer**
   - Desktop is not listening or broadcasting, Windows firewall blocks it,
     Bonjour runtime is missing, a local package will not open, or sharing
     detection is wrong.
2. **mobile discovery / binding layer**
   - Device not found, connection failure, or recovery after app restart.
3. **mobile queue / export layer**
   - Many queued items but no upload, slow iCloud download, or incorrect list
     state.
4. **transport layer**
   - `FILE_ACK timeout`, reconnect, resume, or hash mismatch.
5. **statistics / UI layer**
   - Today/yesterday mismatch, abnormal completion time display, or detail
     pagination/sorting issues.

## 2. Collect These Materials First

### 2.1 Desktop / sidecar

Prioritize:

1. Desktop diagnostics package.
2. Current DMG / NSIS package or running app version.
3. `desktop-main.log`
4. `sidecar.db`

### 2.2 Mobile

Prioritize:

1. Mobile diagnostics zip.
2. App version / build.
3. Whether the app was foreground or background at the time.
4. Whether iCloud assets were involved.

## 3. Common Issue Diagnosis Paths

## 3.1 App Shows Connection Failure, Then Recovers After Restart

Check first:

1. Whether the sidecar is healthy.
2. Whether logs show successful `HELLO_REQ / AUTH_REQ`.
3. Whether it really entered `SYNC_BEGIN`.
4. Whether mobile diagnostics still show many pending items.

Likely causes:

- The app main loop did not continue from the local pending queue.
- Authentication succeeded but the real sync round did not start.
- The UI settled on connection failed instead of waiting for next round.

Consider these only when the above does not fit:

- The sidecar is truly unreachable.
- Pairing expired or became invalid.
- Desktop ports are not listening.

## 3.2 Many Queued Items, But `queueCount=1` Or Upload Stops After One File

This is a typical mobile queue issue.

Check:

1. Whether mobile `queue.json` still has many pending items.
2. The `sync session started ... queueCount=` value in sidecar logs.
3. Whether the next file starts immediately after one file completes.

Likely causes:

- The app did not build the real upload set from the pending queue.
- It only used assets newly scanned in the current round.

## 3.3 UI Shows Disconnected, But Upload Continues

Separate two questions:

1. Was there a real `FILE_ACK timeout` or short reconnect?
2. Did reconnect recover within seconds, and did the file continue completing?

If it was short automatic recovery:

- Treat it as a real short reconnect with overly severe UI wording.
- It should read as reconnecting, not final failure.

## 3.4 LAN Transfer Interrupts After Computer Sleep

First determine whether sleep caused a normal network interruption:

1. Desktop logs show no sidecar crash or app quit before interruption.
2. Mobile diagnostics still retain the pending queue.
3. After wake, the same desktop can be discovered again.
4. After wake, the flow enters `HELLO / AUTH / SYNC_BEGIN` again.

Handling:

- Recommend enabling "prevent computer sleep while syncing" in desktop
  settings.
- During transfer, desktop prevents display sleep and restores system standby
  settings after the task ends.
- If the computer has slept, the LAN connection breaks. After wake and network
  recovery, mobile should retain completed files and automatically continue the
  unfinished queue.
- If recovery does not happen after wake, first check the mobile pending queue,
  whether `SYNC_BEGIN` was sent again, and whether desktop `39593 / 39594` are
  still listening.

LAN Wake-on-LAN checks:

- Current wake is a best-effort LAN feature triggered only by explicit user
  action: opening the `My Computer` root directory, or pressing `Reconnect` from
  sync status/activity.
- App launch, foreground return, or merely showing offline should not trigger
  wake.
- `Reconnect` is LAN / VPN-LAN retry, not a public Wake-on-WAN button.
- When phone and computer are not on the same LAN, same-LAN WoL is not expected
  to work unless VPN effectively places the phone into that LAN and wake packets
  can reach it.
- OSS builds do not provide router helpers, third-party wake helpers, public
  relay wake, or peer proxy wake.
- With only one sleeping computer and no LAN/VPN-LAN reachable path, mobile
  cannot wake a computer behind NAT from nowhere.
- On macOS, confirm `Wake for network access`; Ethernet is usually more stable
  than Wi-Fi during sleep.
- On Windows, confirm BIOS/UEFI WoL, NIC `Allow this device to wake the
computer`, and `Only allow a magic packet to wake the computer`; Modern
  Standby, hibernate, and power-off behavior vary by model.
- Paired mobile caches wake metadata sent by the sidecar while the desktop is
  awake. If the desktop changes network, DHCP, NIC, or router, metadata can
  expire. After failure, the app should still return to the existing P2P/direct
  fallback.

For troubleshooting, check first:

1. While desktop is awake, whether paired `HELLO` / presence includes
   `wake.supported=true` and usable targets.
2. Mobile diagnostics `bindingState.wake`, or Android diagnostics
   `wakeSupported` / `wakeTargetCount`.
3. If shared-files entry metadata is missing, whether `engine.log` has
   `wake skipped reason=<reason> metadata_missing_or_unusable`.
4. If `Reconnect` metadata is missing, whether `engine.log` has
   `wake skipped reason=manual_lan_reconnect metadata_missing_or_unusable`.
5. For direct same-LAN wake, whether logs show `wake packets sent packets=<n>`;
   on success, `wake LAN reachable host=<ip>` / `wake recovered LAN host`; on
   failure, `wake polling exhausted` / `wake probe timed out`.
6. Whether older or summary logs show `wake packets sent`,
   `wake recovered LAN host`, or `wake polling exhausted`.
7. Whether `/health` recovers after wake and `39593 / 39594` become reachable
   again.
8. Whether an external-network scenario without VPN-LAN was mistaken for a
   supported scenario.

### 3.4.1 `My Computer` Or `Reconnect` Did Not Wake The Desktop

Do not immediately treat this as an app regression. Wake-on-LAN is affected by
OS, network adapter, sleep state, router, and subnet limits. Troubleshoot in
this order:

1. Reconnect once while desktop is awake to confirm mobile can cache wake
   metadata. If `wake skipped reason=<reason> metadata_missing_or_unusable`
   appears, mobile has no usable targets.
2. Confirm phone and desktop are on the same LAN. For VPN, it must behave as
   VPN-LAN and allow wake packets into the target LAN.
3. On macOS, first confirm `Wake for network access`; on Windows, first confirm
   BIOS/UEFI and NIC magic packet wake.
4. Confirm mobile diagnostics show `wake packets sent packets=<n>`.
5. If `wake polling exhausted` / `wake probe timed out` appears, `/health` did
   not recover within the bounded time after the packet was sent. Check platform
   WoL settings, router broadcast behavior, sleep mode, and
   `http://<desktop-lan-ip>:39594/health`.

## 3.5 Discovery Shows Device, But Connection Fails

Check first:

1. Whether the sidecar is really listening on `39593 / 39594`.
2. Whether the local machine has leftover `dns-sd` Bonjour broadcast orphan
   processes.
3. Whether mobile selected IPv4 or `fe80::` IPv6.
4. On Windows, whether `Lynavo Drive Sidecar TCP / Lynavo Drive Sidecar HTTP /
Lynavo Drive mDNS UDP` firewall rules are effective and `Bonjour Service` is
   running.

Historically common causes:

- Leftover `dns-sd` caused stale online status.
- Older paths preferred `fe80::` link-local IPv6.
- Windows firewall allow rules were missing or overridden by policy, especially
  `39594/TCP` sidecar HTTP `/health` needed by Android fallback.
- Bonjour for Windows was not installed or running, leaving only compatible
  broadcast or failed discovery.

## 3.6 Same-Day Statistics Differ Between App And Desktop

Compare totals first:

1. Whether total file count matches.
2. Whether total bytes match.

If totals match but buckets differ:

- First suspect inconsistent history bucketing semantics.
- The current correct rule is sidecar/desktop completion day.

## 3.7 iCloud Assets Appear Stuck

Confirm first:

1. Whether the queue item is marked `iCloud`.
2. Whether the current state is `cloud_downloading / preparing`.
3. Whether it has not already entered real upload with no network flow.

iCloud issues usually block at export, not TCP transfer.

## 4. Key Log Keywords

### 4.1 Normal Sync Entry

- `startSync`
- `scan result`
- `pending assets`
- `TCP connected`
- `auth successful`
- `sync session started`
- `FILE_INIT_REQ`

### 4.2 Typical Exceptions

- `FILE_ACK timeout`
- `ACK_WAIT_FAILED`
- `backoff_waiting`
- `reconnecting in`
- `file already completed, skipping`
- `Network is down`
- `EOF`

## 5. Which Side To Suspect

### 5.1 Suspect Sidecar First

When:

1. `39593 / 39594` are not listening at all.
2. `desktop-main.log` clearly reports sidecar startup failure.
3. Multiple devices are affected at the same time.
4. The sidecar itself does not start after DMG installation.
5. Bonjour runtime or firewall rules are not ready on Windows.

### 5.2 Suspect Mobile First

When:

1. `HELLO / AUTH` succeeds but `SYNC_BEGIN` does not happen.
2. The queue is large but `queueCount` is abnormally small.
3. Header state remains after switching files.
4. Restarting the app recovers.

### 5.3 Suspect UI First

When:

1. Statistics totals match, but a page displays inconsistent values.
2. Transfer is still progressing, but copy says it failed.
3. Sorting, pagination, scrolling, or similar presentation is abnormal.

## 6. Minimum Troubleshooting Order

For each field issue, use this order:

1. Check versions: whether desktop build and mobile build align.
2. Inspect desktop diagnostics.
3. Inspect mobile diagnostics.
4. Check whether `SYNC_BEGIN` happened.
5. Check whether the real queue source is the pending queue.
6. Then decide whether to fix sidecar, mobile state machine, or UI mapping.
