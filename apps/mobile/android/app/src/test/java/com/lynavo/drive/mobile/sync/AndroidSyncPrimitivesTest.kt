package com.lynavo.drive.mobile.demo.sync

import java.util.zip.ZipFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSyncPrimitivesTest {
  @Test
  fun publicDownloadResultKeepsSavedLocationWhenContentUriIsHidden() {
    val result = AndroidSyncPrimitives.publicDownloadResult(
      exposeContentUri = false,
      contentUri = "content://downloads/public_downloads/42",
      savedLocation = "Download/Lynavo Drive",
    )

    assertNull(result.localPath)
    assertEquals("Download/Lynavo Drive", result.savedLocation)
  }

  @Test
  fun sharedFilesRouteUsesDirectLanHost() {
    val route = AndroidSyncPrimitives.decideSharedFilesRoute(
      directHost = " 172.20.10.3 ",
      directPort = 39594,
    )

    assertEquals(AndroidSharedFilesRouteMode.DIRECT_LAN, route.mode)
    assertEquals("172.20.10.3", route.host)
    assertEquals(39594, route.port)
  }

  @Test
  fun sharedFileDownloadRetrySkipsLocalSaveAndNonRetryableHttpFailures() {
    assertTrue(
      AndroidSyncPrimitives.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure = false,
        httpStatusCode = null,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure = true,
        httpStatusCode = null,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure = false,
        httpStatusCode = 408,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure = false,
        httpStatusCode = 429,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure = false,
        httpStatusCode = 503,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRetrySharedFileDownloadFailure(
        isLocalSaveFailure = false,
        httpStatusCode = 404,
      ),
    )
  }

  @Test
  fun autoUploadResetOnlyRunsWhenPairingSwitchesDesktop() {
    assertTrue(
      AndroidSyncPrimitives.shouldResetAutoUploadAfterPairing(
        previousDeviceId = "desktop-a",
        nextDeviceId = "desktop-b",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResetAutoUploadAfterPairing(
        previousDeviceId = "desktop-a",
        nextDeviceId = "desktop-a",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResetAutoUploadAfterPairing(
        previousDeviceId = null,
        nextDeviceId = "desktop-b",
      ),
    )
  }

  @Test
  fun pairingTokenForKnownDeviceUsesCachedTokenForPreviousDesktop() {
    val token = AndroidSyncPrimitives.pairingTokenForKnownDevice(
      requestedDeviceId = " desktop-a ",
      currentBindingDeviceId = "desktop-b",
      currentBindingPairingToken = "token-b",
      cachedTokens = mapOf("desktop-a" to "token-a"),
    )

    assertEquals("token-a", token)
  }

  @Test
  fun pairingTokenForKnownDeviceFallsBackToCurrentBindingForLegacyState() {
    val token = AndroidSyncPrimitives.pairingTokenForKnownDevice(
      requestedDeviceId = "desktop-b",
      currentBindingDeviceId = " desktop-b ",
      currentBindingPairingToken = " token-b ",
      cachedTokens = emptyMap(),
    )

    assertEquals("token-b", token)
  }

  @Test
  fun knownDevicePairingTokensAfterRemovalDropsOnlyRequestedDevice() {
    val tokens = AndroidSyncPrimitives.knownDevicePairingTokensAfterRemoval(
      cachedTokens = mapOf(
        "desktop-a" to "token-a",
        "desktop-b" to "token-b",
      ),
      deviceId = " desktop-a ",
    )

    assertEquals(mapOf("desktop-b" to "token-b"), tokens)
  }

  @Test
  fun buildWakeOnLanMagicPacketRepeatsMacSixteenTimesAfterSyncStream() {
    val packet = AndroidSyncPrimitives.buildWakeOnLanMagicPacket("aa:bb:cc:dd:ee:ff")

    assertEquals(102, packet.size)
    assertTrue(packet.take(6).all { it == 0xff.toByte() })
    val mac = byteArrayOf(
      0xaa.toByte(),
      0xbb.toByte(),
      0xcc.toByte(),
      0xdd.toByte(),
      0xee.toByte(),
      0xff.toByte(),
    )
    for (index in 0 until 16) {
      val offset = 6 + index * 6
      assertTrue(mac.contentEquals(packet.copyOfRange(offset, offset + 6)))
    }
  }

  @Test
  fun pairingControlConnectionRunsOnlyForIdleConnectedCurrentBinding() {
    assertTrue(
      AndroidSyncPrimitives.shouldMaintainPairingControlConnection(
        connectionState = "connected",
        syncInProgress = false,
        bindingDeviceId = "desktop-1",
        bindingPairingToken = "token-1",
        activeControlDeviceId = null,
        activeControlPairingToken = null,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldMaintainPairingControlConnection(
        connectionState = "connected",
        syncInProgress = false,
        bindingDeviceId = "desktop-1",
        bindingPairingToken = "token-1",
        activeControlDeviceId = "desktop-1",
        activeControlPairingToken = "token-1",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldMaintainPairingControlConnection(
        connectionState = "connected",
        syncInProgress = true,
        bindingDeviceId = "desktop-1",
        bindingPairingToken = "token-1",
        activeControlDeviceId = "desktop-1",
        activeControlPairingToken = "token-1",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldMaintainPairingControlConnection(
        connectionState = "offline",
        syncInProgress = false,
        bindingDeviceId = "desktop-1",
        bindingPairingToken = "token-1",
        activeControlDeviceId = null,
        activeControlPairingToken = null,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldMaintainPairingControlConnection(
        connectionState = "connected",
        syncInProgress = false,
        bindingDeviceId = "desktop-1",
        bindingPairingToken = "token-1",
        activeControlDeviceId = "desktop-2",
        activeControlPairingToken = "token-1",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldMaintainPairingControlConnection(
        connectionState = "connected",
        syncInProgress = false,
        bindingDeviceId = "desktop-1",
        bindingPairingToken = "token-1",
        activeControlDeviceId = "desktop-1",
        activeControlPairingToken = "token-2",
      ),
    )
  }

  @Test
  fun scheduledPairingControlRestartRequiresCurrentGenerationAndBindingIdentity() {
    assertTrue(
      AndroidSyncPrimitives.shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent = true,
        currentDeviceId = "desktop-1",
        currentPairingToken = "token-1",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "token-1",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent = false,
        currentDeviceId = "desktop-1",
        currentPairingToken = "token-1",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "token-1",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRunScheduledPairingControlRestart(
        scheduledGenerationMatchesCurrent = true,
        currentDeviceId = "desktop-1",
        currentPairingToken = "token-2",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "token-1",
      ),
    )
  }

  @Test
  fun validWakeTargetsRequireMacBroadcastAndPort() {
    val targets = listOf(
      AndroidWakeTarget(
        interfaceName = "wlan0",
        macAddress = "aa:bb:cc:dd:ee:ff",
        ipv4Address = "192.168.1.20",
        broadcastAddress = "192.168.1.255",
        ports = listOf(9, 7),
      ),
      AndroidWakeTarget(
        interfaceName = "rmnet0",
        macAddress = "00:00:00:00:00:00",
        ipv4Address = "10.0.0.4",
        broadcastAddress = "10.0.0.255",
        ports = listOf(9),
      ),
      AndroidWakeTarget(
        interfaceName = "wlan1",
        macAddress = "aa-bb-cc-dd-ee-11",
        ipv4Address = "192.168.2.20",
        broadcastAddress = " ",
        ports = listOf(9),
      ),
      AndroidWakeTarget(
        interfaceName = "wlan2",
        macAddress = "aa-bb-cc-dd-ee-22",
        ipv4Address = "192.168.3.20",
        broadcastAddress = "192.168.3.255",
        ports = listOf(0, 70_000),
      ),
    )

    val valid = AndroidSyncPrimitives.validWakeTargets(targets)

    assertEquals(1, valid.size)
    assertEquals("wlan0", valid.single().interfaceName)
  }

  @Test
  fun wakePacketDestinationsIncludeBroadcastLimitedBroadcastAndHostIp() {
    val target = AndroidWakeTarget(
      interfaceName = "wlan0",
      macAddress = "aa:bb:cc:dd:ee:ff",
      ipv4Address = "192.168.1.20",
      broadcastAddress = "192.168.1.255",
      ports = listOf(9, 7, 9, 70_000),
    )

    val destinations = AndroidSyncPrimitives.wakePacketDestinations(target)

    assertEquals(
      listOf(
        AndroidWakePacketDestination("192.168.1.255", 9),
        AndroidWakePacketDestination("192.168.1.255", 7),
        AndroidWakePacketDestination("255.255.255.255", 9),
        AndroidWakePacketDestination("255.255.255.255", 7),
        AndroidWakePacketDestination("192.168.1.20", 9),
        AndroidWakePacketDestination("192.168.1.20", 7),
      ),
      destinations,
    )
  }

  @Test
  fun parseWakeCapabilityReadsTargetsFromServerMetadata() {
    val capability = AndroidSyncPrimitives.parseWakeCapability(
      mapOf(
        "supported" to true,
        "updatedAt" to "2026-06-09T03:00:00.000Z",
        "targets" to listOf(
          mapOf(
            "interfaceName" to "wlan0",
            "macAddress" to "aa:bb:cc:dd:ee:ff",
            "ipv4Address" to "192.168.1.20",
            "broadcastAddress" to "192.168.1.255",
            "ports" to listOf(9, 7),
          ),
        ),
      ),
    )

    requireNotNull(capability)
    assertTrue(capability.supported)
    assertTrue(capability.hasUsableTargets)
    assertEquals("2026-06-09T03:00:00.000Z", capability.updatedAt)
    assertEquals("192.168.1.255", capability.targets.single().broadcastAddress)
    assertEquals(listOf(9, 7), capability.targets.single().ports)
  }

  @Test
  fun parseWakeCapabilityIgnoresPublicTargetFromServerMetadata() {
    val capability = AndroidSyncPrimitives.parseWakeCapability(
      mapOf(
        "supported" to true,
        "updatedAt" to "2026-06-09T03:00:00.000Z",
        "targets" to listOf(
          mapOf(
            "interfaceName" to "wlan0",
            "macAddress" to "aa:bb:cc:dd:ee:ff",
            "ipv4Address" to "192.168.1.20",
            "broadcastAddress" to "192.168.1.255",
            "ports" to listOf(9),
          )
        ),
        "publicTarget" to mapOf(
          "kind" to "router_wan_udp",
          "host" to "my-ddns.org",
          "port" to 9,
          "enabled" to true,
          "updatedAt" to "2026-06-09T03:00:00.000Z",
        )
      )
    )
    requireNotNull(capability)
    assertTrue(capability.supported)
    assertTrue(capability.hasUsableTargets)
    assertEquals("192.168.1.255", capability.targets.single().broadcastAddress)
  }

  @Test
  fun mergeWakeCapabilityKeepsLanWakeTargetsOnly() {
    val existing = AndroidWakeCapability(
      supported = true,
      targets = emptyList(),
      updatedAt = "2026-06-11T00:00:00Z"
    )
    val serverNew = AndroidWakeCapability(
      supported = true,
      targets = listOf(
        AndroidWakeTarget("eth0", "00:11:22:33:44:55", "192.168.1.10", "192.168.1.255", listOf(9))
      ),
      updatedAt = "2026-06-11T01:00:00Z"
    )
    val merged = AndroidSyncPrimitives.mergeWakeCapability(serverNew, existing)
    requireNotNull(merged)
    assertEquals("2026-06-11T01:00:00Z", merged.updatedAt)
    assertEquals(1, merged.targets.size)
    assertEquals("192.168.1.255", merged.targets.single().broadcastAddress)
  }

  @Test
  fun wakeAttemptIsScopedToPersonalRootListingOnly() {
    assertTrue(
      AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
        scope = "personal",
        path = "",
        operation = "list",
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
        scope = " personal ",
        path = " / ",
        operation = " list ",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
        scope = "team",
        path = "",
        operation = "list",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
        scope = "personal",
        path = "Photos",
        operation = "list",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
        scope = "personal",
        path = "Photos/image.jpg",
        operation = "download",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
        scope = "personal",
        path = "Photos/image.jpg",
        operation = "preview",
      ),
    )
  }

  @Test
  fun sharedFilesLanWakeFollowsWakeGate() {
    assertTrue(AndroidSyncPrimitives.shouldAttemptLanWake(allowWake = true))
    assertFalse(AndroidSyncPrimitives.shouldAttemptLanWake(allowWake = false))
  }

  @Test
  fun fullWakeConfirmationRequiresResumeAfterWakeAttempt() {
    assertTrue(
      AndroidSyncPrimitives.isFullWakeConfirmed(
        lastResumeAt = "2026-06-11T03:50:01Z",
        wakeAttemptStartedAt = "2026-06-11T03:50:00Z",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.isFullWakeConfirmed(
        lastResumeAt = "2026-06-11T03:49:59Z",
        wakeAttemptStartedAt = "2026-06-11T03:50:00Z",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.isFullWakeConfirmed(
        lastResumeAt = "",
        wakeAttemptStartedAt = "2026-06-11T03:50:00Z",
      ),
    )
  }

  @Test
  fun normalizePairingConnectionCodeAllowsKnownDeviceReconnectWithoutCode() {
    val code = AndroidSyncPrimitives.normalizePairingConnectionCode("  ")

    assertEquals("", code)
  }

  @Test
  fun normalizePairingConnectionCodeRejectsPartialManualCode() {
    assertThrows(IllegalArgumentException::class.java) {
      AndroidSyncPrimitives.normalizePairingConnectionCode("123")
    }
  }

  @Test
  fun shouldUseStoredPairingTokenOnlyWhenNoCodeIsProvided() {
    assertTrue(AndroidSyncPrimitives.shouldUseStoredPairingToken(""))
    assertTrue(AndroidSyncPrimitives.shouldUseStoredPairingToken("  "))
    assertFalse(AndroidSyncPrimitives.shouldUseStoredPairingToken("123456"))
  }

  @Test
  fun shouldStartAutoUploadRoundOnlyWhenAutoUploadBecomesActive() {
    assertTrue(
      AndroidSyncPrimitives.shouldStartAutoUploadRound(
        previousEnabled = false,
        previousState = "disabled",
        nextEnabled = true,
        nextState = "active",
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldStartAutoUploadRound(
        previousEnabled = true,
        previousState = "interrupted",
        nextEnabled = true,
        nextState = "active",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldStartAutoUploadRound(
        previousEnabled = true,
        previousState = "active",
        nextEnabled = true,
        nextState = "active",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldStartAutoUploadRound(
        previousEnabled = true,
        previousState = "active",
        nextEnabled = false,
        nextState = "disabled",
      ),
    )
  }

  @Test
  fun shouldContinueAutoUploadRoundStopsAutoItemsAfterDisable() {
    assertFalse(
      AndroidSyncPrimitives.shouldContinueAutoUploadRound(
        roundReason = "auto_upload_resume",
        itemSource = "auto",
        autoUploadState = "disabled",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldContinueAutoUploadRound(
        roundReason = "auto_upload_resume",
        itemSource = "auto",
        autoUploadState = "interrupted",
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldContinueAutoUploadRound(
        roundReason = "auto_upload_resume",
        itemSource = "auto",
        autoUploadState = "active",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldContinueAutoUploadRound(
        roundReason = "legacy_upload",
        itemSource = "legacy",
        autoUploadState = "disabled",
      ),
    )
  }

  @Test
  fun buildClientHelloPayloadFieldsIncludesStableDeviceIdAndCompatibilityVersion() {
    val fields = AndroidSyncPrimitives.buildClientHelloPayloadFields(
      clientId = "android-client-1",
      clientName = "Android CDY-TN20",
      clientPlatform = "android",
      appVersion = "0.1.0",
      appState = "active",
      stableDeviceId = "stable-device-1",
      clientIp = "192.168.10.239",
      pairingToken = "token-1",
    )

    assertEquals("android-client-1", fields["clientId"])
    assertEquals("Android CDY-TN20", fields["clientName"])
    assertEquals("android", fields["clientPlatform"])
    assertEquals("0.1.0", fields["appVersion"])
    assertEquals("active", fields["appState"])
    assertEquals(APP_COMPATIBILITY_VERSION, fields["appCompatibilityVersion"])
    assertEquals("stable-device-1", fields["stableDeviceId"])
    assertEquals("192.168.10.239", fields["clientIp"])
    assertEquals("token-1", fields["pairingToken"])
    assertFalse(fields.containsKey("deviceAlias"))
  }

  @Test
  fun fallbackHelloUsesPairingTokenOnlyForCurrentBindingHost() {
    assertEquals(
      "token-1",
      AndroidSyncPrimitives.pairingTokenForFallbackHello(
        probeHost = " 172.16.20.108 ",
        bindingHost = "172.16.20.108",
        pairingToken = " token-1 ",
      ),
    )
    assertEquals(
      null,
      AndroidSyncPrimitives.pairingTokenForFallbackHello(
        probeHost = "172.16.20.109",
        bindingHost = "172.16.20.108",
        pairingToken = "token-1",
      ),
    )
    assertEquals(
      null,
      AndroidSyncPrimitives.pairingTokenForFallbackHello(
        probeHost = "172.16.20.108",
        bindingHost = "172.16.20.108",
        pairingToken = " ",
      ),
    )
  }

  @Test
  fun syncSocketReadTimeoutAllowsLongerUploadAckGapsThanControlConnections() {
    assertTrue(AndroidSyncPrimitives.syncSocketReadTimeoutMs(5_000) >= 45_000)
  }

  @Test
  fun uploadAckWaitSkipsPingFrames() {
    assertFalse(AndroidSyncPrimitives.isTerminalUploadAckWaitFrame(0x000F))
    assertTrue(AndroidSyncPrimitives.isTerminalUploadAckWaitFrame(0x000A))
    assertTrue(AndroidSyncPrimitives.isTerminalUploadAckWaitFrame(0x0011))
  }

  @Test
  fun requireCompatibleDesktopAppVersionRejectsMismatch() {
    AndroidSyncPrimitives.requireCompatibleDesktopAppVersion(
      serverCompatibilityVersion = APP_COMPATIBILITY_VERSION,
    )

    assertThrows(IllegalArgumentException::class.java) {
      AndroidSyncPrimitives.requireCompatibleDesktopAppVersion(
        serverCompatibilityVersion = APP_COMPATIBILITY_VERSION + 1,
      )
    }
  }

  @Test
  fun deriveBindingConnectionStateFromProbeMarksStaleLiveStateOffline() {
    assertEquals(
      "offline",
      AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
        currentState = "connected",
        reachable = false,
      ),
    )
    assertEquals(
      "offline",
      AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
        currentState = "bound",
        reachable = false,
      ),
    )
    assertEquals(
      "connected",
      AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
        currentState = "bound",
        reachable = true,
      ),
    )
    assertEquals(
      "offline",
      AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
        currentState = "offline",
        reachable = true,
      ),
    )
  }

  @Test
  fun directLanReachabilityDoesNotReconnectWithoutPresenceConfirmedPairing() {
    assertFalse(
      AndroidSyncPrimitives.shouldUseDirectLanReconnect(
        healthReachable = true,
        presenceConfirmed = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldUseDirectLanReconnect(
        healthReachable = false,
        presenceConfirmed = true,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldUseDirectLanReconnect(
        healthReachable = true,
        presenceConfirmed = true,
      ),
    )
  }

  @Test
  fun shouldProbeBindingConnectionStateSkipsProbeDuringActiveSync() {
    assertTrue(
      AndroidSyncPrimitives.shouldProbeBindingConnectionState(
        currentState = "connected",
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldProbeBindingConnectionState(
        currentState = "connected",
        syncInProgress = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldProbeBindingConnectionState(
        currentState = "offline",
        syncInProgress = false,
      ),
    )
  }

  @Test
  fun shouldRequestNearbyWifiPermissionOnlyOnAndroid13PlusWhenMissing() {
    assertFalse(
      AndroidSyncPrimitives.shouldRequestNearbyWifiPermission(
        sdkInt = 32,
        permissionGranted = false,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRequestNearbyWifiPermission(
        sdkInt = 33,
        permissionGranted = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRequestNearbyWifiPermission(
        sdkInt = 33,
        permissionGranted = true,
      ),
    )
  }

  @Test
  fun nearbyWifiPermissionStatusMatchesRuntimePromptRequirement() {
    assertEquals(
      "granted",
      AndroidSyncPrimitives.nearbyWifiPermissionStatus(
        sdkInt = 32,
        permissionGranted = false,
      ),
    )
    assertEquals(
      "required",
      AndroidSyncPrimitives.nearbyWifiPermissionStatus(
        sdkInt = 33,
        permissionGranted = false,
      ),
    )
    assertEquals(
      "granted",
      AndroidSyncPrimitives.nearbyWifiPermissionStatus(
        sdkInt = 33,
        permissionGranted = true,
      ),
    )
  }

  @Test
  fun buildPresenceHeartbeatUrlUsesSidecarHttpPresenceEndpoint() {
    assertEquals(
      "http://192.168.10.237:39594/presence/client-123",
      AndroidSyncPrimitives.buildPresenceHeartbeatUrl(
        host = "192.168.10.237",
        port = 39594,
        clientId = "client-123",
      ),
    )

    assertEquals(
      "http://[fe80::1%wlan0]:39594/presence/client-123",
      AndroidSyncPrimitives.buildPresenceHeartbeatUrl(
        host = "fe80::1%wlan0",
        port = 39594,
        clientId = "client-123",
      ),
    )
  }

  @Test
  fun presenceResponseMustMatchBoundDesktopIdentity() {
    assertTrue(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = " desktop-1 ",
        responseServerId = "desktop-1",
        responsePaired = true,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = " desktop-1 ",
        responseServerId = "desktop-1",
        responsePaired = null,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = "desktop-1",
        responseServerId = "other-desktop",
        responsePaired = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = "desktop-1",
        responseServerId = null,
        responsePaired = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = "desktop-1",
        responseServerId = "desktop-1",
        responsePaired = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = "desktop-1",
        responseServerId = "desktop-1",
        responsePaired = true,
        responseDesktopAvailable = false,
      ),
    )
  }

  @Test
  fun desktopUnavailableOfflineReasonKeepsPresenceRetryEligible() {
    assertTrue(
      AndroidSyncPrimitives.shouldRetryPresenceHeartbeatWhileOffline(
        "presence_heartbeat_timer_desktop_unavailable",
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRetryPresenceHeartbeatWhileOffline(
        " presence_recovery_failed_desktop_unavailable ",
      ),
    )
  }

  @Test
  fun nonDesktopUnavailableOfflineReasonDoesNotKeepPresenceRetryEligible() {
    assertFalse(
      AndroidSyncPrimitives.shouldRetryPresenceHeartbeatWhileOffline(
        "presence_heartbeat_timer_unpaired",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRetryPresenceHeartbeatWhileOffline(
        "presence_heartbeat_timer_server_mismatch",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRetryPresenceHeartbeatWhileOffline(
        "presence_recovery_exhausted",
      ),
    )
    assertFalse(AndroidSyncPrimitives.shouldRetryPresenceHeartbeatWhileOffline(""))
  }

  @Test
  fun pairingInvalidationAllowsPairedFalseOnlyFromMatchingDesktopIdentity() {
    assertTrue(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = " desktop-1 ",
        responseServerId = "desktop-1",
        responsePaired = false,
        persistedBindingExists = true,
        persistedPairingToken = "token-1",
        authRejected = false,
      ),
    )
  }

  @Test
  fun pairingInvalidationRejectsPairedFalseFromMismatchedDesktopIdentity() {
    assertFalse(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = "desktop-1",
        responseServerId = "desktop-2",
        responsePaired = false,
        persistedBindingExists = true,
        persistedPairingToken = "token-1",
        authRejected = false,
      ),
    )
  }

  @Test
  fun pairingInvalidationDetectsMissingPersistedBindingToken() {
    assertTrue(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = null,
        responseServerId = null,
        responsePaired = null,
        persistedBindingExists = true,
        persistedPairingToken = " ",
        authRejected = false,
      ),
    )
  }

  @Test
  fun pairingInvalidationAllowsExplicitAuthRejected() {
    assertTrue(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = "desktop-1",
        responseServerId = "desktop-1",
        responsePaired = null,
        persistedBindingExists = true,
        persistedPairingToken = "token-1",
        authRejected = true,
      ),
    )
  }

  @Test
  fun pairingInvalidationRequiresMatchingDesktopIdentityForAuthRejected() {
    assertFalse(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = "desktop-1",
        responseServerId = null,
        responsePaired = null,
        persistedBindingExists = true,
        persistedPairingToken = "token-1",
        authRejected = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = "desktop-1",
        responseServerId = "desktop-2",
        responsePaired = null,
        persistedBindingExists = true,
        persistedPairingToken = "token-1",
        authRejected = true,
      ),
    )
  }

  @Test
  fun pairingInvalidationIgnoresGenericOfflineInputs() {
    assertFalse(
      AndroidSyncPrimitives.shouldInvalidateCurrentPairing(
        expectedDeviceId = null,
        responseServerId = null,
        responsePaired = null,
        persistedBindingExists = false,
        persistedPairingToken = null,
        authRejected = false,
      ),
    )
  }

  @Test
  fun pairingInvalidationClearRequiresCurrentBindingToMatchExpectedBinding() {
    assertTrue(
      AndroidSyncPrimitives.shouldClearCurrentBindingForPairingInvalidation(
        currentDeviceId = "desktop-1",
        currentPairingToken = "token-1",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "token-1",
        existingInvalidationReason = null,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldClearCurrentBindingForPairingInvalidation(
        currentDeviceId = "desktop-2",
        currentPairingToken = "token-2",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "token-1",
        existingInvalidationReason = null,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldClearCurrentBindingForPairingInvalidation(
        currentDeviceId = "desktop-1",
        currentPairingToken = "new-token",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = null,
        existingInvalidationReason = null,
      ),
    )
  }

  @Test
  fun pairingInvalidationClearIsIdempotentAfterBindingAlreadyCleared() {
    assertFalse(
      AndroidSyncPrimitives.shouldClearCurrentBindingForPairingInvalidation(
        currentDeviceId = null,
        currentPairingToken = null,
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "token-1",
        existingInvalidationReason = "presence_unpaired",
      ),
    )
  }

  @Test
  fun pairingInvalidationStorageMutationRequiresCurrentBindingToStillMatchExpectedBinding() {
    assertFalse(
      AndroidSyncPrimitives.shouldApplyPairingInvalidationStorageMutation(
        currentDeviceId = "desktop-1",
        currentPairingToken = "new-token",
        expectedDeviceId = "desktop-1",
        expectedPairingToken = "old-token",
        existingInvalidationReason = null,
      ),
    )
  }

  @Test
  fun pairingInvalidationControlReasonsRequireRePairing() {
    assertTrue(AndroidSyncPrimitives.isPairingInvalidationControlReason("connection_code_regenerated"))
    assertTrue(AndroidSyncPrimitives.isPairingInvalidationControlReason(" connection_code_set "))
    assertFalse(AndroidSyncPrimitives.isPairingInvalidationControlReason(""))
    assertFalse(AndroidSyncPrimitives.isPairingInvalidationControlReason("offline"))
    assertFalse(AndroidSyncPrimitives.isPairingInvalidationControlReason(null))
  }

  @Test
  fun lanWakeReachabilityDoesNotPromoteConnectionUntilPresenceConfirmsPairing() {
    assertEquals(
      "offline",
      AndroidSyncPrimitives.bindingStateAfterLanWakeReachability(
        presenceConfirmed = false,
      ),
    )
    assertEquals(
      "connected",
      AndroidSyncPrimitives.bindingStateAfterLanWakeReachability(
        presenceConfirmed = true,
      ),
    )
    assertEquals(
      "offline",
      AndroidSyncPrimitives.bindingStateAfterLanWakeReachability(
        presenceConfirmed = false,
      ),
    )
  }

  @Test
  fun lanWakeRecoveredHostRequiresPresenceConfirmedPairing() {
    assertFalse(
      AndroidSyncPrimitives.shouldUseLanWakeRecoveredHost(
        presenceConfirmed = false,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldUseLanWakeRecoveredHost(
        presenceConfirmed = true,
      ),
    )
  }

  @Test
  fun wakeLanRecoveryReasonDoesNotClaimFullWakeSuccess() {
    assertEquals(
      "browse_shared_files_wake_lan_reachable",
      AndroidSyncPrimitives.wakeLanReachableReason("browse_shared_files"),
    )
    assertEquals(
      "browse_shared_files_wake_full_resume_confirmed",
      AndroidSyncPrimitives.wakeFullResumeConfirmedReason("browse_shared_files"),
    )
  }

  @Test
  fun failedPresenceHeartbeatStartsRecoveryOnlyForIdleConnectedBinding() {
    assertTrue(
      AndroidSyncPrimitives.shouldStartPresenceRecoveryAfterHeartbeatFailure(
        connectionState = "connected",
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldStartPresenceRecoveryAfterHeartbeatFailure(
        connectionState = "connected",
        syncInProgress = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldStartPresenceRecoveryAfterHeartbeatFailure(
        connectionState = "offline",
        syncInProgress = false,
      ),
    )
  }

  @Test
  fun boundDiscoveryResolutionRefreshesPresenceWhenBindingIsOffline() {
    assertTrue(
      AndroidSyncPrimitives.shouldRefreshBoundPresenceFromDiscovery(
        bindingDeviceId = "desktop-1",
        candidateDeviceId = "desktop-1",
        connectionState = "offline",
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRefreshBoundPresenceFromDiscovery(
        bindingDeviceId = " desktop-1 ",
        candidateDeviceId = "desktop-1",
        connectionState = "connecting",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRefreshBoundPresenceFromDiscovery(
        bindingDeviceId = "desktop-1",
        candidateDeviceId = "other-desktop",
        connectionState = "offline",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRefreshBoundPresenceFromDiscovery(
        bindingDeviceId = "desktop-1",
        candidateDeviceId = "desktop-1",
        connectionState = "connected",
      ),
    )
  }

  @Test
  fun exhaustedPresenceRecoveryRestartsDiscoveryForBoundOfflineDevice() {
    assertTrue(
      AndroidSyncPrimitives.shouldRestartDiscoveryAfterPresenceRecoveryExhausted(
        bindingDeviceId = "desktop-1",
        connectionState = "offline",
        reason = "presence_recovery_exhausted",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRestartDiscoveryAfterPresenceRecoveryExhausted(
        bindingDeviceId = "",
        connectionState = "offline",
        reason = "presence_recovery_exhausted",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRestartDiscoveryAfterPresenceRecoveryExhausted(
        bindingDeviceId = "desktop-1",
        connectionState = "connecting",
        reason = "presence_recovery_exhausted",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRestartDiscoveryAfterPresenceRecoveryExhausted(
        bindingDeviceId = "desktop-1",
        connectionState = "offline",
        reason = "user_offline",
      ),
    )
  }

  @Test
  fun networkAvailabilityRefreshesDiscoveryOnlyAfterBoundLanTransition() {
    assertTrue(
      AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = "desktop-1",
        syncInProgress = false,
        hasLanNetwork = true,
        isInitialSnapshot = false,
        previousLanNetworkAvailable = false,
        networkChanged = false,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = "desktop-1",
        syncInProgress = false,
        hasLanNetwork = true,
        isInitialSnapshot = false,
        previousLanNetworkAvailable = true,
        networkChanged = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = "desktop-1",
        syncInProgress = false,
        hasLanNetwork = true,
        isInitialSnapshot = true,
        previousLanNetworkAvailable = false,
        networkChanged = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = "desktop-1",
        syncInProgress = true,
        hasLanNetwork = true,
        isInitialSnapshot = false,
        previousLanNetworkAvailable = false,
        networkChanged = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = "",
        syncInProgress = false,
        hasLanNetwork = true,
        isInitialSnapshot = false,
        previousLanNetworkAvailable = false,
        networkChanged = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = "desktop-1",
        syncInProgress = false,
        hasLanNetwork = true,
        isInitialSnapshot = false,
        previousLanNetworkAvailable = true,
        networkChanged = false,
      ),
    )
  }

  @Test
  fun buildSubnetProbeHostsIncludesPeerAcrossSlash22() {
    val hosts = AndroidSyncPrimitives.buildSubnetProbeHosts(
      clientIp = "172.16.22.15",
      prefixLength = 22,
      maxHosts = 2_000,
    )

    assertTrue(hosts.contains("172.16.21.43"))
    assertFalse(hosts.contains("172.16.22.15"))
    assertFalse(hosts.contains("172.16.20.0"))
    assertFalse(hosts.contains("172.16.23.255"))
  }

  @Test
  fun buildSubnetProbeHostsSkipsNetworksThatAreTooLarge() {
    val hosts = AndroidSyncPrimitives.buildSubnetProbeHosts(
      clientIp = "10.0.20.15",
      prefixLength = 16,
      maxHosts = 2_000,
    )

    assertTrue(hosts.isEmpty())
  }

  @Test
  fun staleDiscoveryProbeCanUseLatestCandidateWhenEndpointStillMatches() {
    assertEquals(
      AndroidDiscoveryProbeResolution.CURRENT_CANDIDATE,
      AndroidSyncPrimitives.resolveDiscoveryProbeCandidate(
        probeGeneration = 3,
        currentGeneration = 3,
        hasOriginalCandidate = true,
        latestCandidateMatchesProbeEndpoint = true,
      ),
    )
    assertEquals(
      AndroidDiscoveryProbeResolution.LATEST_CANDIDATE,
      AndroidSyncPrimitives.resolveDiscoveryProbeCandidate(
        probeGeneration = 2,
        currentGeneration = 3,
        hasOriginalCandidate = false,
        latestCandidateMatchesProbeEndpoint = true,
      ),
    )
    assertEquals(
      AndroidDiscoveryProbeResolution.IGNORE_STALE_GENERATION,
      AndroidSyncPrimitives.resolveDiscoveryProbeCandidate(
        probeGeneration = 2,
        currentGeneration = 3,
        hasOriginalCandidate = false,
        latestCandidateMatchesProbeEndpoint = false,
      ),
    )
    assertEquals(
      AndroidDiscoveryProbeResolution.IGNORE_MISSING_CANDIDATE,
      AndroidSyncPrimitives.resolveDiscoveryProbeCandidate(
        probeGeneration = 3,
        currentGeneration = 3,
        hasOriginalCandidate = false,
        latestCandidateMatchesProbeEndpoint = false,
      ),
    )
  }

  @Test
  fun fallbackDiscoveryNamePrefersDesktopServerName() {
    assertEquals(
      "Mini4",
      AndroidSyncPrimitives.fallbackDiscoveryName(" Mini4 ", "172.16.21.43"),
    )
  }

  @Test
  fun fallbackDiscoveryNameFallsBackToHostWhenServerNameIsBlank() {
    assertEquals(
      "Lynavo Drive 172.16.21.43",
      AndroidSyncPrimitives.fallbackDiscoveryName(" ", "172.16.21.43"),
    )
  }

  @Test
  fun computeFileKeyMatchesIosClientAssetMediaTypeShape() {
    val key = AndroidSyncPrimitives.computeFileKey(
      clientId = "client-123",
      assetLocalId = "content://media/external/images/media/42",
      mediaType = "image",
    )

    assertEquals(
      "bf33ee502cd0889bd878774d4820648d724896618eaf07679580193be3d1db40",
      key,
    )
  }

  @Test
  fun computeAuthHmacUsesSha256PairingTokenBytesAsKeyAndHexDecodedNonce() {
    val hmac = AndroidSyncPrimitives.computeAuthHmac(
      pairingToken = "pairing-token-abc",
      nonceHex = "000102030405060708090a0b0c0d0e0f",
    )

    assertEquals(
      "aab8c4cf6d1387ef25855f432b1faeff6b6290ed5f62eb49e79bc00be0f96f1d",
      hmac,
    )
  }

  @Test
  fun canonicalPersonalAccessMatchesSidecarLineOrder() {
    val canonical = AndroidSyncPrimitives.canonicalPersonalAccess(
      method = "get",
      escapedPath = "/personal/download/Photos%2FIMG_0001.JPG",
      clientId = "phone-123",
      timestamp = "2026-06-22T10:20:30.123Z",
      nonce = "nonce-123",
    )

    assertEquals(
      """
      GET
      /personal/download/Photos%2FIMG_0001.JPG
      phone-123
      2026-06-22T10:20:30.123Z
      nonce-123
      """.trimIndent(),
      canonical,
    )
  }

  @Test
  fun computePersonalAccessHmacUsesSha256PairingTokenBytesAsKey() {
    val signature = AndroidSyncPrimitives.computePersonalAccessHmac(
      pairingToken = "pairing-token-secret",
      method = "get",
      escapedPath = "/personal/download/Photos%2FIMG_0001.JPG",
      clientId = "phone-123",
      timestamp = "2026-06-22T10:20:30.123Z",
      nonce = "nonce-123",
    )

    assertEquals(
      "6fc9632974ae6a98854607cda3c7dac1327247e86d733098cc2a1a065c83d050",
      signature,
    )
  }

  @Test
  fun personalAccessSignatureCarriesSignatureTimestampAndNonce() {
    val signed = AndroidSyncPrimitives.personalAccessSignature(
      pairingToken = "pairing-token-secret",
      method = "GET",
      escapedPath = "/personal/list",
      clientId = "phone-123",
      timestamp = "2026-06-22T10:20:30.123Z",
      nonce = "nonce-456",
    )

    assertEquals(
      "94ef62337c99a78061a32ea4bd9b04ecb3d263f003a8174881afb1e2e4d00421",
      signed.signature,
    )
    assertEquals("2026-06-22T10:20:30.123Z", signed.timestamp)
    assertEquals("nonce-456", signed.nonce)
  }

  @Test
  fun sortedPendingItemsUseOldestUpdatedAtThenFileKey() {
    val items = listOf(
      AndroidUploadItem(
        assetLocalId = "auto-new",
        fileKey = "auto-new-key",
        filename = "auto-new.jpg",
        mediaType = "image",
        mimeType = "image/jpeg",
        fileSize = 10,
        createdAt = "2026-01-03T00:00:00Z",
        modifiedAt = "2026-01-03T00:00:00Z",
        uri = "content://auto-new",
        status = "queued",
        source = "auto",
        batchId = null,
        ackedOffset = 0,
        updatedAt = "2026-01-03T00:00:00Z",
      ),
      AndroidUploadItem(
        assetLocalId = "auto-middle",
        fileKey = "auto-middle-key",
        filename = "auto-middle.jpg",
        mediaType = "image",
        mimeType = "image/jpeg",
        fileSize = 10,
        createdAt = "2026-01-02T00:00:00Z",
        modifiedAt = "2026-01-02T00:00:00Z",
        uri = "content://auto-middle",
        status = "queued",
        source = "auto",
        batchId = null,
        ackedOffset = 0,
        updatedAt = "2026-01-02T00:00:00Z",
      ),
      AndroidUploadItem(
        assetLocalId = "auto-old",
        fileKey = "auto-old-key",
        filename = "auto-old.jpg",
        mediaType = "image",
        mimeType = "image/jpeg",
        fileSize = 10,
        createdAt = "2026-01-01T00:00:00Z",
        modifiedAt = "2026-01-01T00:00:00Z",
        uri = "content://auto-old",
        status = "queued",
        source = "auto",
        batchId = null,
        ackedOffset = 0,
        updatedAt = "2026-01-01T00:00:00Z",
      ),
    )

    assertEquals(
      listOf("auto-old-key", "auto-middle-key", "auto-new-key"),
      AndroidSyncPrimitives.sortedPendingItems(items).map { it.fileKey },
    )
  }

  @Test
  fun cancelPendingAutoItemsCancelsOnlyAutoPendingQueue() {
    val updatedAt = "2026-05-07T09:00:00Z"
    val items = listOf(
      testUploadItem(fileKey = "auto-queued", source = "auto", status = "queued"),
      testUploadItem(fileKey = "auto-preparing", source = "auto", status = "preparing"),
      testUploadItem(fileKey = "auto-uploading", source = "auto", status = "uploading"),
      testUploadItem(fileKey = "auto-completed", source = "auto", status = "completed"),
    )

    val cancelled = AndroidSyncPrimitives.cancelPendingAutoItems(items, updatedAt)
      .associateBy { it.fileKey }

    assertEquals("cancelled", cancelled["auto-queued"]?.status)
    assertEquals(updatedAt, cancelled["auto-queued"]?.updatedAt)
    assertEquals("cancelled", cancelled["auto-preparing"]?.status)
    assertEquals("uploading", cancelled["auto-uploading"]?.status)
    assertEquals("completed", cancelled["auto-completed"]?.status)
  }

  @Test
  fun writeZipArchiveCreatesReadableDiagnosticsJsonEntry() {
    val archive = kotlin.io.path.createTempFile(
      prefix = "lynavo-drive-diagnostics-test-",
      suffix = ".zip",
    ).toFile()

    try {
      AndroidSyncPrimitives.writeZipArchive(
        archive,
        mapOf("diagnostics.json" to """{"platform":"android"}""".toByteArray(Charsets.UTF_8)),
      )

      ZipFile(archive).use { zip ->
        val entry = zip.getEntry("diagnostics.json")
        assertEquals("diagnostics.json", entry.name)
        val text = zip.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
        assertEquals("""{"platform":"android"}""", text)
      }
    } finally {
      archive.delete()
    }
  }

  @Test
  fun buildDiagnosticsArchiveEntriesMatchesMobileBundleShape() {
    val entries = AndroidSyncPrimitives.buildDiagnosticsArchiveEntries(
      diagnosticsJson = """
        {
          "generatedAt": "2026-05-06T08:05:03Z",
          "app": { "platform": "android" },
          "device": { "systemName": "Android" },
          "client": { "clientId": "client-1" },
          "runtime": { "queueCount": 0 }
        }
      """.trimIndent(),
      queueJson = "[]",
      historyJson = """{"items":[]}""",
      engineLogLines = listOf("2026-05-06T08:05:03Z [Diagnostics] exported"),
    )

    assertEquals(
      setOf("diagnostics.json", "queue.json", "history.json", "engine.log"),
      entries.keys,
    )
    val diagnostics = entries.getValue("diagnostics.json").toString(Charsets.UTF_8)
    assertTrue(diagnostics.contains(""""app""""))
    assertTrue(diagnostics.contains(""""device""""))
    assertTrue(diagnostics.contains(""""client""""))
    assertTrue(diagnostics.contains(""""runtime""""))
    assertEquals("[]", entries.getValue("queue.json").toString(Charsets.UTF_8))
    assertEquals(
      "2026-05-06T08:05:03Z [Diagnostics] exported",
      entries.getValue("engine.log").toString(Charsets.UTF_8),
    )
  }

  @Test
  fun buildDiagnosticsLogLineNormalizesCategoryAndMessage() {
    val line = AndroidSyncPrimitives.buildDiagnosticsLogLine(
      timestampIso = "2026-05-06T08:05:03Z",
      category = " Sync ",
      message = " round requested ",
    )

    assertEquals("2026-05-06T08:05:03Z [Sync] round requested", line)
  }

  @Test
  fun buildDiagnosticsLogLineFallsBackForBlankCategoryAndMessage() {
    val line = AndroidSyncPrimitives.buildDiagnosticsLogLine(
      timestampIso = "2026-05-06T08:05:03Z",
      category = " ",
      message = " ",
    )

    assertEquals("2026-05-06T08:05:03Z [NativeSyncEngine] <empty>", line)
  }

  @Test
  fun retainRecentLogLinesKeepsNewestLinesOnly() {
    val retained = AndroidSyncPrimitives.retainRecentLogLines(
      lines = listOf("one", "two", "three", "four"),
      maxLines = 2,
    )

    assertEquals(listOf("three", "four"), retained)
  }

  @Test
  fun computeTransferSpeedReportsMiBPerSecondFromByteDelta() {
    assertEquals(
      2.0,
      AndroidSyncPrimitives.computeTransferSpeedMbps(
        bytesDelta = 1_048_576,
        elapsedMs = 500,
      ),
      0.001,
    )
    assertEquals(
      0.0,
      AndroidSyncPrimitives.computeTransferSpeedMbps(
        bytesDelta = 1_048_576,
        elapsedMs = 0,
      ),
      0.0,
    )
    assertEquals(
      0.0,
      AndroidSyncPrimitives.computeTransferSpeedMbps(
        bytesDelta = -1,
        elapsedMs = 500,
      ),
      0.0,
    )
  }

  @Test
  fun buildSyncOverviewFieldsReportsCompletedRoundAndClearsActiveFile() {
    val fields = AndroidSyncPrimitives.buildSyncOverviewFields(
      AndroidSyncOverviewInput(
        currentDeviceId = "desktop-1",
        currentDeviceName = "Mini4",
        uploadState = "completed",
        sessionId = "session-1",
        completedCount = 2,
        totalCount = 2,
        completedBytes = 3_000,
        totalBytes = 3_000,
        currentFileKey = "file-2",
        currentFilename = "IMG_0002.JPG",
        currentFileConfirmedBytes = 1_000,
        currentFileTotalBytes = 1_000,
        autoUploadState = "active",
        autoPending = 0,
        lastCompletedTaskSource = "auto",
      ),
    )

    assertEquals("completed", fields.uploadState)
    assertEquals(100.0, fields.progressPercent, 0.0)
    assertEquals(2.0, fields.completedCount, 0.0)
    assertEquals(2.0, fields.totalCount, 0.0)
    assertEquals(3_000.0, fields.transferredBytes, 0.0)
    assertEquals(3_000.0, fields.totalBytes, 0.0)
    assertEquals(null, fields.currentFile)
    assertEquals(null, fields.currentFilename)
    assertEquals(0.0, fields.currentFileConfirmedBytes, 0.0)
    assertEquals(0.0, fields.currentFileTotalBytes, 0.0)
    assertEquals("auto", fields.lastCompletedTaskSource)
  }

  @Test
  fun foregroundLanRuntimeAllowsVisibleInteractiveUnlockedApp() {
    val decision = AndroidSyncPrimitives.foregroundLanRuntimeDecision(
      AndroidForegroundLanRuntimeState(
        appVisible = true,
        screenInteractive = true,
        lockscreenLocked = false,
      ),
    )

    assertTrue(decision.canContinue)
    assertNull(decision.reason)
  }

  @Test
  fun foregroundLanRuntimeStopsWhenAppIsNotVisible() {
    val decision = AndroidSyncPrimitives.foregroundLanRuntimeDecision(
      AndroidForegroundLanRuntimeState(
        appVisible = false,
        screenInteractive = true,
        lockscreenLocked = false,
      ),
    )

    assertFalse(decision.canContinue)
    assertEquals("foreground_lan_runtime_inactive", decision.reason)
  }

  @Test
  fun foregroundLanRuntimeStopsWhenScreenIsOffOrLocked() {
    val screenOff = AndroidSyncPrimitives.foregroundLanRuntimeDecision(
      AndroidForegroundLanRuntimeState(
        appVisible = true,
        screenInteractive = false,
        lockscreenLocked = false,
      ),
    )
    val locked = AndroidSyncPrimitives.foregroundLanRuntimeDecision(
      AndroidForegroundLanRuntimeState(
        appVisible = true,
        screenInteractive = true,
        lockscreenLocked = true,
      ),
    )

    assertFalse(screenOff.canContinue)
    assertEquals("foreground_lan_runtime_inactive", screenOff.reason)
    assertFalse(locked.canContinue)
    assertEquals("foreground_lan_runtime_inactive", locked.reason)
  }

  private fun testUploadItem(
    fileKey: String,
    source: String,
    status: String,
  ): AndroidUploadItem =
    AndroidUploadItem(
      assetLocalId = fileKey,
      fileKey = fileKey,
      filename = "$fileKey.jpg",
      mediaType = "image",
      mimeType = "image/jpeg",
      fileSize = 10,
      createdAt = "2026-01-01T00:00:00Z",
      modifiedAt = "2026-01-01T00:00:00Z",
      uri = "content://$fileKey",
      status = status,
      source = source,
      batchId = null,
      ackedOffset = 0,
      updatedAt = "2026-01-01T00:00:00Z",
    )
}
