package com.vividrop.mobile.china.sync

import java.util.zip.ZipFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSyncPrimitivesTest {
  @Test
  fun sharedFilesRouteUsesLoopbackWhenTunnelIsActive() {
    val route = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = true,
      tunnelPort = 51234,
      hasTunnelCredentials = true,
      directHost = "172.20.10.3",
      directPort = 39394,
    )

    assertEquals(AndroidSharedFilesRouteMode.TUNNEL, route.mode)
    assertEquals("127.0.0.1", route.host)
    assertEquals(51234, route.port)
    assertTrue(route.isTunnel)
  }

  @Test
  fun sharedFilesRouteWaitsForTunnelWhenCredentialsExistButTunnelIsNotActive() {
    val route = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = false,
      tunnelPort = null,
      hasTunnelCredentials = true,
      directHost = "172.20.10.3",
      directPort = 39394,
    )

    assertEquals(AndroidSharedFilesRouteMode.WAIT_FOR_TUNNEL, route.mode)
    assertFalse(route.isTunnel)
  }

  @Test
  fun sharedFilesRouteDoesNotUseStaleTunnelPortUntilTunnelIsActive() {
    val route = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = false,
      tunnelPort = 51234,
      hasTunnelCredentials = true,
      directHost = "172.20.10.3",
      directPort = 39394,
    )

    assertEquals(AndroidSharedFilesRouteMode.WAIT_FOR_TUNNEL, route.mode)
    assertEquals("", route.host)
    assertEquals(0, route.port)
    assertFalse(route.isTunnel)
  }

  @Test
  fun sharedFilesRouteFallsBackToDirectLanWhenCredentialsAreMissingEvenWithStaleTunnelPort() {
    val route = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = false,
      tunnelPort = 51234,
      hasTunnelCredentials = false,
      directHost = " 172.20.10.3 ",
      directPort = 39394,
    )

    assertEquals(AndroidSharedFilesRouteMode.DIRECT_LAN, route.mode)
    assertEquals("172.20.10.3", route.host)
    assertEquals(39394, route.port)
    assertFalse(route.isTunnel)
  }

  @Test
  fun sharedFilesRouteFallsBackToDirectLanWhenTunnelCredentialsAreMissing() {
    val route = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = false,
      tunnelPort = null,
      hasTunnelCredentials = false,
      directHost = " 172.20.10.3 ",
      directPort = 39394,
    )

    assertEquals(AndroidSharedFilesRouteMode.DIRECT_LAN, route.mode)
    assertEquals("172.20.10.3", route.host)
    assertEquals(39394, route.port)
    assertFalse(route.isTunnel)
  }

  @Test
  fun sharedFilesRouteFailureRetriesOnlyTunnelRoute() {
    assertTrue(AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(isTunnelRoute = true))
    assertFalse(AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(isTunnelRoute = false))
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
        path = "",
        operation = "download",
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
    assertTrue(
      AndroidSyncPrimitives.shouldContinueAutoUploadRound(
        roundReason = "manual_upload",
        itemSource = "manual",
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
      "connected",
      AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
        currentState = "offline",
        reachable = true,
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
  fun buildPresenceHeartbeatUrlUsesSidecarHttpPresenceEndpoint() {
    assertEquals(
      "http://192.168.10.237:39394/presence/client-123",
      AndroidSyncPrimitives.buildPresenceHeartbeatUrl(
        host = "192.168.10.237",
        port = 39394,
        clientId = "client-123",
      ),
    )

    assertEquals(
      "http://[fe80::1%wlan0]:39394/presence/client-123",
      AndroidSyncPrimitives.buildPresenceHeartbeatUrl(
        host = "fe80::1%wlan0",
        port = 39394,
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
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = "desktop-1",
        responseServerId = "other-desktop",
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.presenceResponseMatchesBinding(
        expectedDeviceId = "desktop-1",
        responseServerId = null,
      ),
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
  fun restoredConnectionResumesPendingManualUploadOnlyWhenIdle() {
    assertTrue(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterReachabilityRestored(
        previousConnectionState = "offline",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = false,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterReachabilityRestored(
        previousConnectionState = "connecting",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterReachabilityRestored(
        previousConnectionState = "connected",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterReachabilityRestored(
        previousConnectionState = "offline",
        nextConnectionState = "connected",
        manualPending = 0,
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterReachabilityRestored(
        previousConnectionState = "offline",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = true,
      ),
    )
  }

  @Test
  fun discoveryReachabilityReconnectResumesPendingManualUploadOnlyWhenIdle() {
    assertTrue(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterDiscoveryReachabilityRestored(
        previousConnectionState = "offline",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterDiscoveryReachabilityRestored(
        previousConnectionState = "connected",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldResumeManualUploadAfterDiscoveryReachabilityRestored(
        previousConnectionState = "offline",
        nextConnectionState = "connected",
        manualPending = 1,
        syncInProgress = true,
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
  fun exhaustedPresenceRecoveryRetainsActiveSharedFilesTunnelReachability() {
    assertTrue(
      AndroidSyncPrimitives.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason = "presence_recovery_exhausted",
        reachabilityState = "available",
        reachabilityRoute = "tunnel",
        isTunnelActive = true,
        isTunnelStarting = false,
      ),
    )
    assertTrue(
      AndroidSyncPrimitives.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason = "presence_recovery_exhausted",
        reachabilityState = "available",
        reachabilityRoute = "relay",
        isTunnelActive = false,
        isTunnelStarting = true,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason = "pipeline_failed",
        reachabilityState = "available",
        reachabilityRoute = "tunnel",
        isTunnelActive = true,
        isTunnelStarting = false,
      ),
    )
    assertFalse(
      AndroidSyncPrimitives.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason = "presence_recovery_exhausted",
        reachabilityState = "available",
        reachabilityRoute = "lan",
        isTunnelActive = true,
        isTunnelStarting = false,
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
      "Vivi Drop 172.16.21.43",
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
  fun sortedPendingItemsPrioritizeManualThenOldestUpdatedAt() {
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
        assetLocalId = "manual",
        fileKey = "manual-key",
        filename = "manual.jpg",
        mediaType = "image",
        mimeType = "image/jpeg",
        fileSize = 10,
        createdAt = "2026-01-02T00:00:00Z",
        modifiedAt = "2026-01-02T00:00:00Z",
        uri = "content://manual",
        status = "queued",
        source = "manual",
        batchId = "batch-1",
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
      listOf("manual-key", "auto-old-key", "auto-new-key"),
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
      testUploadItem(fileKey = "manual-queued", source = "manual", status = "queued"),
      testUploadItem(fileKey = "auto-completed", source = "auto", status = "completed"),
    )

    val cancelled = AndroidSyncPrimitives.cancelPendingAutoItems(items, updatedAt)
      .associateBy { it.fileKey }

    assertEquals("cancelled", cancelled["auto-queued"]?.status)
    assertEquals(updatedAt, cancelled["auto-queued"]?.updatedAt)
    assertEquals("cancelled", cancelled["auto-preparing"]?.status)
    assertEquals("uploading", cancelled["auto-uploading"]?.status)
    assertEquals("queued", cancelled["manual-queued"]?.status)
    assertEquals("completed", cancelled["auto-completed"]?.status)
  }

  @Test
  fun writeZipArchiveCreatesReadableDiagnosticsJsonEntry() {
    val archive = kotlin.io.path.createTempFile(
      prefix = "syncflow-diagnostics-test-",
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
        manualPending = 0,
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
      batchId = if (source == "manual") "batch-1" else null,
      ackedOffset = 0,
      updatedAt = "2026-01-01T00:00:00Z",
    )
}
