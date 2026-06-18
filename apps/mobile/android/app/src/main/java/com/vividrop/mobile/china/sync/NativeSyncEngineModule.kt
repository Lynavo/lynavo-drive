package com.vividrop.mobile.china.sync

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.vividrop.mobile.china.BuildConfig
import mobiletunnel.Mobiletunnel
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject

private val STRUCTURED_PAIRING_ERROR_CODES = setOf(
  "PAIRING_CODE_INVALID",
  "PAIRING_CLIENT_BLOCKED",
  "PAIR_TOKEN_INVALID",
  "APP_VERSION_INCOMPATIBLE",
)

private class NativeStructuredError(
  val nativeCode: String,
  message: String,
  val userInfo: WritableMap,
) : Exception(message)

private data class PickedDocumentMetadata(
  val name: String,
  val size: Long,
  val mimeType: String,
  val uri: Uri,
)

class NativeSyncEngineModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val discoveryLock = Any()
  private var nsdManager: NsdManager? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  private var discoveryGeneration = 0L
  private val discoveredCandidates = mutableMapOf<String, DiscoveredServiceCandidate>()
  private val reachableCandidates = mutableMapOf<String, DiscoveredServiceCandidate>()
  private val pendingResolveKeys = mutableSetOf<String>()
  private val diagnosticsLogLock = Any()
  private val diagnosticsLogLines = mutableListOf<String>()
  private val syncRunLock = Any()
  private var syncInProgress = false
  private val presenceHeartbeatLock = Any()
  private var presenceHeartbeatExecutor: ScheduledExecutorService? = null
  private var presenceHeartbeatFuture: ScheduledFuture<*>? = null
  private val presenceRecoveryLock = Any()
  private var presenceRecoveryGeneration = 0L
  private var presenceRecoveryFuture: ScheduledFuture<*>? = null
  private val networkMonitorLock = Any()
  private var connectivityManager: ConnectivityManager? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var networkInitialSnapshotObserved = false
  private var lastLanNetworkAvailable = false
  private var lastLanNetworkKey: String? = null
  private var pendingPhotoPermissionPromise: Promise? = null
  private var pendingDiscoveryPermissionPromise: Promise? = null
  private val uploadStore by lazy { AndroidUploadStore(reactApplicationContext) }
  private val mediaStoreRepository by lazy { AndroidMediaStoreRepository(reactApplicationContext) }
  @Volatile private var foregroundSyncStopRequested = false
  @Volatile private var lastBackgroundStopReason: String? = null
  private val foregroundSyncStopHandler: () -> Unit = {
    requestForegroundSyncStopInternal(reason = "notification_stop")
  }
  private val p2pTunnelLock = Any()
  private val p2pTunnelExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ViviP2PTunnel").apply { isDaemon = true }
  }
  private var tunnelGeneration = 0L
  private var tunnelPort: Int? = null
  private var isTunnelActive = false
  private var tunnelStarting = false
  private var signalingUrl: String? = null
  private var accessToken: String? = null
  private var tunnelIceServersJSON: String = ""
  @Volatile private var sharedFilesReachability: SharedFilesReachability? = null
  init {
    foregroundSyncStopCallback = foregroundSyncStopHandler
    registerNetworkAvailabilityMonitor()
    resumePresenceHeartbeatFromStoredBinding(reason = "module_initialized")
  }

  override fun getName(): String = MODULE_NAME

  override fun getConstants(): Map<String, Any>? {
    val packageName = reactApplicationContext.packageName
    val market = if (packageName.contains("global")) "global" else "cn"
    return mapOf(
      "SYNCFLOW_MARKET" to market,
      "PACKAGE_NAME" to packageName
    )
  }

  override fun invalidate() {
    stopDiscoveryInternal(emitUpdate = false)
    cancelPresenceRecoveryProbe(reason = "module_invalidated")
    stopPresenceHeartbeatTimer()
    stopP2PTunnel()
    unregisterNetworkAvailabilityMonitor()
    if (foregroundSyncStopCallback === foregroundSyncStopHandler) {
      foregroundSyncStopCallback = null
    }
    super.invalidate()
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for NativeEventEmitter compatibility.
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required for NativeEventEmitter compatibility.
  }

  @ReactMethod
  fun setTunnelCredentials(
    signalingUrl: String,
    accessToken: String,
    iceServersJSON: String,
    promise: Promise,
  ) {
    if (signalingUrl.isBlank() || accessToken.isBlank()) {
      synchronized(p2pTunnelLock) {
        this.signalingUrl = null
        this.accessToken = null
        this.tunnelIceServersJSON = ""
      }
      stopP2PTunnel()
      recordNativeLog("SyncEngine", "tunnel credentials cleared")
      promise.resolve(null)
      return
    }

    val credentialsChanged = synchronized(p2pTunnelLock) {
      val changed = this.signalingUrl != signalingUrl ||
        this.accessToken != accessToken ||
        this.tunnelIceServersJSON != iceServersJSON
      this.signalingUrl = signalingUrl
      this.accessToken = accessToken
      this.tunnelIceServersJSON = iceServersJSON
      changed
    }
    if (credentialsChanged) {
      stopP2PTunnel()
    }

    Log.d("NativeSyncEngine", "setTunnelCredentials received signalingUrl=$signalingUrl")
    recordNativeLog("SyncEngine", "setTunnelCredentials received signalingUrl=$signalingUrl")
    val currentBinding = loadBinding()
    if (currentBinding != null && isBindingConnected(currentBinding)) {
      startP2PTunnelIfNeeded(currentBinding)
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun requestPhotoPermission(promise: Promise) {
    val currentState = currentPhotoPermissionState()
    recordNativeLog("PhotoPermission", "request started currentState=$currentState")
    if (currentState == "granted" || currentState == "limited") {
      recordNativeLog("PhotoPermission", "request resolved without prompt state=$currentState")
      promise.resolve(currentState)
      return
    }

    val activity = getCurrentActivity()
    if (activity !is PermissionAwareActivity) {
      recordNativeLog("PhotoPermission", "request unavailable activity=${activity?.javaClass?.simpleName ?: "null"}", Log.WARN)
      emitError(
        code = "ANDROID_PHOTO_PERMISSION_UNAVAILABLE",
        message = "Android 当前 Activity 不支持相簿权限请求。",
      )
      promise.resolve(currentState)
      return
    }

    if (pendingPhotoPermissionPromise != null) {
      promise.reject(
        "ANDROID_PHOTO_PERMISSION_REQUEST_IN_PROGRESS",
        "Photo permission request is already in progress",
      )
      return
    }

    pendingPhotoPermissionPromise = promise
    try {
      activity.requestPermissions(
        photoPermissionsForRequest(),
        PHOTO_PERMISSION_REQUEST_CODE,
      ) { requestCode, _, _ ->
        if (requestCode != PHOTO_PERMISSION_REQUEST_CODE) {
          return@requestPermissions false
        }

        val pendingPromise = pendingPhotoPermissionPromise
        pendingPhotoPermissionPromise = null
        val nextState = currentPhotoPermissionState()
        recordNativeLog("PhotoPermission", "request completed state=$nextState")
        pendingPromise?.resolve(nextState)
        true
      }
    } catch (error: Throwable) {
      pendingPhotoPermissionPromise = null
      recordNativeLog("PhotoPermission", "request failed: ${error.message ?: error.javaClass.simpleName}", Log.ERROR)
      promise.reject(
        "ANDROID_PHOTO_PERMISSION_REQUEST_FAILED",
        error.message ?: "Failed to request Android photo permission",
        error,
      )
    }
  }

  @ReactMethod
  fun startDiscovery(promise: Promise) {
    recordNativeLog("Discovery", "startDiscovery requested")
    if (shouldRequestNearbyWifiPermission()) {
      requestNearbyWifiPermissionThenStartDiscovery(promise)
      return
    }
    startDiscoveryAfterPermission(promise)
  }

  private fun requestNearbyWifiPermissionThenStartDiscovery(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity !is PermissionAwareActivity) {
      recordNativeLog(
        "Discovery",
        "nearby wifi permission unavailable activity=${activity?.javaClass?.simpleName ?: "null"}",
        Log.WARN,
      )
      emitDiscoveredDevicesChanged()
      emitError(
        code = "ANDROID_DISCOVERY_PERMISSION_UNAVAILABLE",
        message = "目前無法請求附近裝置權限，無法搜尋桌面端。",
      )
      promise.resolve(null)
      return
    }

    if (pendingDiscoveryPermissionPromise != null) {
      promise.reject(
        "ANDROID_DISCOVERY_PERMISSION_REQUEST_IN_PROGRESS",
        "Nearby Wi-Fi permission request is already in progress",
      )
      return
    }

    pendingDiscoveryPermissionPromise = promise
    recordNativeLog("Discovery", "requesting nearby wifi permission")
    try {
      activity.requestPermissions(
        arrayOf(Manifest.permission.NEARBY_WIFI_DEVICES),
        DISCOVERY_PERMISSION_REQUEST_CODE,
      ) { requestCode, _, _ ->
        if (requestCode != DISCOVERY_PERMISSION_REQUEST_CODE) {
          return@requestPermissions false
        }

        val pendingPromise = pendingDiscoveryPermissionPromise
        pendingDiscoveryPermissionPromise = null
        if (pendingPromise == null) {
          return@requestPermissions true
        }

        if (shouldRequestNearbyWifiPermission()) {
          recordNativeLog("Discovery", "nearby wifi permission denied", Log.WARN)
          emitDiscoveredDevicesChanged()
          emitError(
            code = "ANDROID_DISCOVERY_PERMISSION_DENIED",
            message = "需要允許「附近裝置」權限，才能在區網中搜尋桌面端。",
          )
          pendingPromise.resolve(null)
          return@requestPermissions true
        }

        recordNativeLog("Discovery", "nearby wifi permission granted")
        startDiscoveryAfterPermission(pendingPromise)
        true
      }
    } catch (error: Throwable) {
      pendingDiscoveryPermissionPromise = null
      recordNativeLog("Discovery", "nearby wifi permission request failed: ${error.message ?: error.javaClass.simpleName}", Log.ERROR)
      emitDiscoveredDevicesChanged()
      emitError(
        code = "ANDROID_DISCOVERY_PERMISSION_FAILED",
        message = "請求附近裝置權限失敗：${error.message ?: "unknown error"}",
      )
      promise.resolve(null)
    }
  }

  private fun startDiscoveryAfterPermission(promise: Promise) {
    startDiscoveryInternal()
    promise.resolve(null)
  }

  private fun startDiscoveryInternal(): Boolean {
    val manager = reactApplicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
    if (manager == null) {
      recordNativeLog("Discovery", "startDiscovery unavailable: NsdManager missing", Log.WARN)
      emitDiscoveredDevicesChanged()
      emitError(
        code = "ANDROID_DISCOVERY_UNAVAILABLE",
        message = "Android 系统未提供局域网发现服务，无法扫描电脑端设备。",
      )
      return false
    }

    val listener: NsdManager.DiscoveryListener
    val generation: Long
    synchronized(discoveryLock) {
      stopDiscoveryLocked()
      nsdManager = manager
      acquireMulticastLockLocked()
      discoveryGeneration += 1
      generation = discoveryGeneration
      listener = createDiscoveryListener(
        manager = manager,
        generation = generation,
      )
      discoveryListener = listener
    }

    emitDiscoveredDevicesChanged()
    try {
      manager.discoverServices(BONJOUR_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
      scheduleSubnetDiscoveryFallback(generation)
      return true
    } catch (error: Throwable) {
      synchronized(discoveryLock) {
        stopDiscoveryLocked()
      }
      recordNativeLog("Discovery", "startDiscovery failed: ${error.message ?: error.javaClass.simpleName}", Log.ERROR)
      emitError(
        code = "ANDROID_DISCOVERY_START_FAILED",
        message = "启动 Android 局域网发现失败：${error.message ?: "unknown error"}",
      )
    }
    return false
  }

  @ReactMethod
  fun stopDiscovery(promise: Promise) {
    recordNativeLog("Discovery", "stopDiscovery requested")
    stopDiscoveryInternal(emitUpdate = true)
    promise.resolve(null)
  }

  private fun registerNetworkAvailabilityMonitor() {
    val manager = reactApplicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    if (manager == null) {
      recordNativeLog("NetworkPath", "observer unavailable: ConnectivityManager missing", Log.WARN)
      return
    }

    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
        handleNetworkCapabilitiesChanged(network, networkCapabilities)
      }

      override fun onLost(network: Network) {
        handleNetworkLost(network)
      }
    }

    try {
      manager.registerDefaultNetworkCallback(callback)
      synchronized(networkMonitorLock) {
        connectivityManager = manager
        networkCallback = callback
      }
      recordDiagnosticsLog("NetworkPath", "observer started")
    } catch (error: Throwable) {
      recordNativeLog(
        "NetworkPath",
        "observer start failed: ${error.message ?: error.javaClass.simpleName}",
        Log.WARN,
      )
    }
  }

  private fun unregisterNetworkAvailabilityMonitor() {
    val pair = synchronized(networkMonitorLock) {
      val manager = connectivityManager
      val callback = networkCallback
      connectivityManager = null
      networkCallback = null
      manager to callback
    }
    val manager = pair.first ?: return
    val callback = pair.second ?: return
    try {
      manager.unregisterNetworkCallback(callback)
      recordDiagnosticsLog("NetworkPath", "observer stopped")
    } catch (_: Throwable) {
      // Callback may already be unregistered during React Native teardown.
    }
  }

  private fun handleNetworkCapabilitiesChanged(
    network: Network,
    networkCapabilities: NetworkCapabilities,
  ) {
    val hasLanNetwork = networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
      networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    val networkKey = network.toString()
    val binding = loadBinding()
    var initialSnapshot = false
    var previousLanNetworkAvailable = false
    var networkChanged = false
    val shouldRefresh = synchronized(networkMonitorLock) {
      initialSnapshot = !networkInitialSnapshotObserved
      previousLanNetworkAvailable = lastLanNetworkAvailable
      networkChanged = lastLanNetworkKey != null && lastLanNetworkKey != networkKey

      val result = AndroidSyncPrimitives.shouldRefreshBoundDiscoveryAfterNetworkAvailable(
        bindingDeviceId = binding?.deviceId.orEmpty(),
        syncInProgress = syncInProgress,
        hasLanNetwork = hasLanNetwork,
        isInitialSnapshot = initialSnapshot,
        previousLanNetworkAvailable = previousLanNetworkAvailable,
        networkChanged = networkChanged,
      )

      networkInitialSnapshotObserved = true
      lastLanNetworkAvailable = hasLanNetwork
      lastLanNetworkKey = if (hasLanNetwork) networkKey else null
      result
    }

    if (initialSnapshot) {
      recordDiagnosticsLog(
        "NetworkPath",
        "network initial snapshot observed; discovery refresh deferred available=$hasLanNetwork network=$networkKey",
      )
      return
    }

    if (!shouldRefresh || binding == null) {
      return
    }

    refreshBoundDiscoveryAfterNetworkAvailable(
      binding = binding,
      reason = "network_available",
      previousLanNetworkAvailable = previousLanNetworkAvailable,
      networkChanged = networkChanged,
    )
  }

  private fun handleNetworkLost(network: Network) {
    val networkKey = network.toString()
    val shouldLog = synchronized(networkMonitorLock) {
      if (lastLanNetworkKey != networkKey && lastLanNetworkKey != null) {
        return@synchronized false
      }
      val wasAvailable = lastLanNetworkAvailable
      networkInitialSnapshotObserved = true
      lastLanNetworkAvailable = false
      lastLanNetworkKey = null
      wasAvailable
    }
    if (shouldLog) {
      recordDiagnosticsLog("NetworkPath", "lan network lost network=$networkKey")
    }
  }

  private fun refreshBoundDiscoveryAfterNetworkAvailable(
    binding: StoredBinding,
    reason: String,
    previousLanNetworkAvailable: Boolean,
    networkChanged: Boolean,
  ) {
    recordDiagnosticsLog(
      "NetworkPath",
      "network available triggered discovery refresh deviceId=${binding.deviceId} state=${binding.connectionState} previousLan=$previousLanNetworkAvailable networkChanged=$networkChanged",
    )
    sendPresenceHeartbeatAsync(binding, reason = reason, recoverOnFailure = true)
    if (shouldRequestNearbyWifiPermission()) {
      recordNativeLog(
        "Discovery",
        "network available but nearby wifi permission is required; discovery refresh skipped",
        Log.WARN,
      )
      return
    }

    val restarted = startDiscoveryInternal()
    if (restarted) {
      recordDiagnosticsLog("Discovery", "network available restarted discovery deviceId=${binding.deviceId}")
    }
  }

  @ReactMethod
  fun pairDevice(params: ReadableMap, promise: Promise) {
    runAsync(promise) {
      val host = params.getString("host")?.trim().orEmpty()
      val port = if (params.hasKey("port")) params.getInt("port") else DEFAULT_PROTOCOL_PORT
      val fallbackDeviceId = params.getString("deviceId")?.trim().orEmpty()
      val connectionCode = AndroidSyncPrimitives.normalizePairingConnectionCode(
        params.getString("connectionCode"),
      )

      if (host.isBlank()) {
        throw IllegalArgumentException("Missing host for pairing")
      }
      recordNativeLog(
        "Pairing",
        "pairDevice requested deviceId=${fallbackDeviceId.ifBlank { "<unknown>" }} host=$host port=$port codeProvided=${connectionCode.isNotBlank()}",
      )
      val previousBinding = loadBinding()

      val storedPairingToken = if (AndroidSyncPrimitives.shouldUseStoredPairingToken(connectionCode)) {
        pairingTokenForKnownDevice(fallbackDeviceId)
      } else {
        null
      }

      val helloPayload = JSONObject(
        AndroidSyncPrimitives.buildClientHelloPayloadFields(
          clientId = getOrCreateClientId(),
          clientName = getClientDisplayNameValue(),
          clientPlatform = "android",
          appVersion = getVersionName(),
          appState = "active",
          stableDeviceId = getOrCreateStableDeviceId(),
          pairingToken = storedPairingToken,
        ),
      )

      val resolvedBinding = performPairing(
        host = host,
        port = port,
        fallbackDeviceId = fallbackDeviceId,
        connectionCode = connectionCode,
        storedPairingToken = storedPairingToken,
        helloPayload = helloPayload,
      )

      resetAutoUploadAfterPairingDeviceSwitch(previousBinding, resolvedBinding)
      saveBinding(resolvedBinding)
      recordNativeLog(
        "Pairing",
        "pairDevice successful deviceId=${resolvedBinding.deviceId} host=${resolvedBinding.host} shareEnabled=${resolvedBinding.shareEnabled}",
        Log.INFO,
      )
      emitBindingStateChanged(resolvedBinding)
      emitIdleSyncState(resolvedBinding)
      emitQueueUpdated(Arguments.createArray())
      sendPresenceHeartbeatAsync(resolvedBinding, reason = "pairing_confirmed", recoverOnFailure = true)
      startPresenceHeartbeatTimer(resolvedBinding)
      promise.resolve(null)
    }
  }

  private fun resetAutoUploadAfterPairingDeviceSwitch(
    previousBinding: StoredBinding?,
    nextBinding: StoredBinding,
  ) {
    if (!AndroidSyncPrimitives.shouldResetAutoUploadAfterPairing(previousBinding?.deviceId, nextBinding.deviceId)) {
      return
    }
    recordNativeLog(
      "AutoUpload",
      "reset after device switch ${previousBinding?.deviceId} -> ${nextBinding.deviceId}",
      Log.INFO,
    )
    persistAutoUploadDisabledState()
    uploadStore.cancelPendingAutoItems(isoNow())
    recordDiagnosticsLog(
      "AutoUpload",
      "reset after device switch previous=${previousBinding?.deviceId} next=${nextBinding.deviceId}",
    )
  }

  @ReactMethod
  fun disconnectAndUnbind(promise: Promise) {
    recordNativeLog("Pairing", "disconnectAndUnbind requested")
    cancelPresenceRecoveryProbe(reason = "unbind")
    stopP2PTunnel()
    stopPresenceHeartbeatTimer()
    clearBinding()
    clearSharedFilesReachability(reason = "disconnectAndUnbind")
    emitBindingStateCleared()
    emitIdleSyncState(null)
    emitQueueUpdated(Arguments.createArray())
    promise.resolve(null)
  }

  @ReactMethod
  fun getBindingState(promise: Promise) {
    runAsync(promise) {
      promise.resolve(refreshBindingReachability(loadBinding())?.toWritableMapWithSharedFilesReachability())
    }
  }

  @ReactMethod
  fun getSyncOverview(promise: Promise) {
    promise.resolve(buildIdleSyncSummary(loadBinding(), "idle", uploadStore.getPendingItems(limit = 10_000)))
  }

  @ReactMethod
  fun getReadOnlyQueue(promise: Promise) {
    val pending = uploadStore.getPendingItems(limit = 100)
    promise.resolve(uploadStore.queueToWritableArray(pending))
  }

  @ReactMethod
  fun getHistoryDays(cursor: String?, promise: Promise) {
    val ledgers = uploadStore.getLedgers()
    val result = Arguments.createMap().apply {
      putArray("items", uploadStore.historyToWritableArray(ledgers))
      putNull("nextCursor")
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun getAppInfo(promise: Promise) {
    val label = reactApplicationContext.applicationInfo.loadLabel(
      reactApplicationContext.packageManager,
    ).toString()
    val result = Arguments.createMap().apply {
      putString("appName", label)
      putString("version", getVersionName())
      putString("build", getVersionCode())
      putString("platform", "android")
      putString("supportLevel", "sync")
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun exportDiagnostics(promise: Promise) {
    runAsync(promise) {
      val timestamp = diagnosticsArchiveTimestamp()
      val archive = File(
        reactApplicationContext.cacheDir,
        "SyncFlow-Mobile-Diagnostics-$timestamp.zip",
      )
      val binding = loadBinding()
      val queueItems = uploadStore.getPendingItems(limit = 10_000)
      val historyPayload = JSONObject().apply {
        put("items", JSONArray(uploadStore.getLedgers().map { it.toJson() }))
        put("nextCursor", JSONObject.NULL)
      }
      val engineLogSnapshot = diagnosticsLogSnapshot()
      dumpDiagnosticsLogSnapshotToConsole(engineLogSnapshot)
      val payload = JSONObject().apply {
        put("generatedAt", isoNow())
        put(
          "app",
          JSONObject().apply {
            put(
              "appName",
              reactApplicationContext.applicationInfo.loadLabel(
                reactApplicationContext.packageManager,
              ).toString(),
            )
            put("version", getVersionName())
            put("build", getVersionCode())
            put("platform", "android")
            put("supportLevel", "sync")
          },
        )
        put(
          "device",
          JSONObject().apply {
            put("name", getClientDisplayNameValue())
            put("manufacturer", Build.MANUFACTURER)
            put("brand", Build.BRAND)
            put("model", Build.MODEL)
            put("device", Build.DEVICE)
            put("osVersion", "Android ${Build.VERSION.RELEASE}")
            put("systemName", "Android")
            put("systemVersion", Build.VERSION.RELEASE)
            put("sdkInt", Build.VERSION.SDK_INT)
          },
        )
        put(
          "client",
          JSONObject().apply {
            put("clientId", getOrCreateClientId())
            put("displayName", getClientDisplayNameValue())
            put("hasPairingToken", !binding?.pairingToken.isNullOrBlank())
            put("preferredIPv4", currentClientIPv4() ?: JSONObject.NULL)
          },
        )
        put(
          "runtime",
          JSONObject().apply {
            put("applicationState", "active")
            put("bindingState", binding?.toDiagnosticsJson() ?: JSONObject.NULL)
            put("syncOverview", buildIdleSyncOverviewJson(binding, queueItems))
            put("queueCount", queueItems.size)
            put("historyPageCount", historyPayload.optJSONArray("items")?.length() ?: 0)
            put("photoAuthorization", currentPhotoPermissionState())
            put("backgroundKeepalive", buildAndroidBackgroundKeepaliveStatusJson())
            put("sidecarHost", binding?.host ?: JSONObject.NULL)
            put("activeSession", JSONObject.NULL)
            put("recentRetry", JSONObject.NULL)
            put("recentError", JSONObject.NULL)
          },
        )
      }
      writeDiagnosticsArchive(
        archive = archive,
        diagnosticsPayload = payload,
        queuePayload = JSONArray(queueItems.map { it.toJson() }),
        historyPayload = historyPayload,
        engineLogLines = engineLogSnapshot,
      )
      recordDiagnosticsLog(
        "Diagnostics",
        "exported android diagnostics archive ${archive.name} bytes=${archive.length()}",
      )
      promise.resolve(archive.absolutePath)
    }
  }

  @ReactMethod
  fun uploadDiagnosticsArchive(params: ReadableMap, promise: Promise) {
    thread(name = "NativeSyncEngineDiagnosticsUpload", isDaemon = true) {
      try {
        val uploadUrl = params.getStringOrNull("url")?.trim().orEmpty()
        val archivePath = params.getStringOrNull("archivePath")?.trim().orEmpty()
        val note = params.getStringOrNull("note")?.trim().orEmpty()
        val headers = if (params.hasKey("headers") && !params.isNull("headers")) {
          params.getMap("headers")
        } else {
          null
        }

        val result = performDiagnosticsArchiveUpload(
          uploadUrl = uploadUrl,
          archivePath = archivePath,
          note = note,
          headers = readableMapToStringMap(headers),
        )
        promise.resolve(result)
      } catch (error: NativeBridgeException) {
        diagnosticsUploadLog("failed code=${error.nativeCode} message=${error.message.orEmpty()}")
        promise.reject(error.nativeCode, error.message, error)
      } catch (error: Throwable) {
        diagnosticsUploadLog("failed code=NETWORK_ERROR message=${error.message.orEmpty()}")
        promise.reject("NETWORK_ERROR", error.message ?: "Diagnostics upload failed", error)
      }
    }
  }

  @ReactMethod
  fun recordDiagnosticsLog(category: String, message: String) {
    recordNativeLog(category.trim().ifBlank { "JS" }, message)
  }

  private fun recordNativeLog(
    category: String,
    message: String,
    priority: Int = Log.DEBUG,
  ) {
    val line = AndroidSyncPrimitives.buildDiagnosticsLogLine(
      timestampIso = isoNow(),
      category = category,
      message = message,
    )
    synchronized(diagnosticsLogLock) {
      diagnosticsLogLines.add(line)
      if (diagnosticsLogLines.size > MAX_DIAGNOSTICS_LOG_LINES) {
        val retained = AndroidSyncPrimitives.retainRecentLogLines(
          diagnosticsLogLines,
          MAX_DIAGNOSTICS_LOG_LINES,
        )
        diagnosticsLogLines.clear()
        diagnosticsLogLines.addAll(retained)
      }
    }
    val consoleMessage = AndroidSyncPrimitives.buildConsoleLogMessage(
      localTimestamp = localLogTimestamp(),
      category = category,
      message = message,
    )
    when (priority) {
      Log.ERROR -> Log.e(MODULE_NAME, consoleMessage)
      Log.WARN -> Log.w(MODULE_NAME, consoleMessage)
      Log.INFO -> Log.i(MODULE_NAME, consoleMessage)
      else -> Log.d(MODULE_NAME, consoleMessage)
    }
  }

  private fun wakeCapabilityLogSummary(wake: AndroidWakeCapability?): String {
    if (wake == null) {
      return "wake=nil"
    }
    val usableTargets = AndroidSyncPrimitives.validWakeTargets(wake.targets).size
    val hasPublic = wake.publicTarget?.enabled == true && wake.publicTarget.host.isNotBlank()
    return "wakeSupported=${wake.supported} wakeTargets=${wake.targets.size} wakeUsableTargets=$usableTargets remoteWakeEnabled=$hasPublic"
  }

  @ReactMethod
  fun getClientDisplayName(promise: Promise) {
    promise.resolve(getClientDisplayNameValue())
  }

  @ReactMethod
  fun getClientId(promise: Promise) {
    promise.resolve(getOrCreateClientId())
  }

  @ReactMethod
  fun getKnownDeviceIds(promise: Promise) {
    val result = Arguments.createArray()
    for (deviceId in getKnownDeviceIdsValue()) {
      result.pushString(deviceId)
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun setClientDisplayName(name: String, promise: Promise) {
    val trimmed = name.trim()
    if (trimmed.isBlank()) {
      promise.resolve(null)
      return
    }

    prefs.edit().putString(PREF_CLIENT_DISPLAY_NAME, trimmed).apply()
    promise.resolve(null)
  }

  @ReactMethod
  fun triggerSync(promise: Promise) {
    recordNativeLog("Sync", "triggerSync requested")
    startForegroundSyncRound(reason = "manual_trigger", threadName = "NativeSyncEngineSync")
    promise.resolve(null)
  }

  @ReactMethod
  fun retryLanReconnect(params: ReadableMap, promise: Promise) {
    runAsync(promise) {
      val allowWake = if (params.hasKey("allowWake") && !params.isNull("allowWake")) {
        params.getBoolean("allowWake")
      } else {
        false
      }
      retryLanReconnectInternal(allowWake = allowWake)
      promise.resolve(null)
    }
  }

  private fun startAutoUploadSyncRound(reason: String) {
    recordDiagnosticsLog("AutoUpload", "starting sync round reason=$reason")
    startForegroundSyncRound(reason = reason, threadName = "NativeSyncEngineAutoUpload")
  }

  @ReactMethod
  fun startBackgroundSyncService(reason: String, promise: Promise) {
    try {
      if (!startForegroundSyncService(reason.ifBlank { "manual_trigger" })) {
        promise.reject(
          "ANDROID_BACKGROUND_SYNC_SERVICE_UNAVAILABLE",
          "無法啟動 Android 背景同步服務。",
        )
        return
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("ANDROID_BACKGROUND_SYNC_SERVICE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stopBackgroundSyncService(promise: Promise) {
    requestForegroundSyncStopInternal()
    val shouldFinishService = synchronized(syncRunLock) { !syncInProgress }
    if (shouldFinishService) {
      stopForegroundSyncService()
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun renameBoundDeviceAlias(alias: String, promise: Promise) {
    val binding = loadBinding()
    if (binding == null) {
      promise.resolve(null)
      return
    }

    val updated = binding.copy(deviceAlias = alias.trim().ifBlank { binding.deviceName })
    saveBinding(updated)
    emitBindingStateChanged(updated)
    promise.resolve(null)
  }

  @ReactMethod
  fun savePublicWakeTarget(params: ReadableMap, promise: Promise) {
    try {
      val binding = loadBinding()
      if (binding == null) {
        promise.reject("SAVE_PUBLIC_WAKE_TARGET_ERROR", "No active binding available")
        return
      }
      val host = if (params.hasKey("host") && !params.isNull("host")) params.getString("host").orEmpty() else ""
      val port = if (params.hasKey("port") && !params.isNull("port")) params.getInt("port") else 9
      val enabled = if (params.hasKey("enabled") && !params.isNull("enabled")) params.getBoolean("enabled") else false

      AndroidSyncPrimitives.validatePublicWakeTarget(host, port, enabled)

      val existingWake = binding.wake ?: AndroidWakeCapability(
        supported = false,
        targets = emptyList(),
        publicTarget = null,
        updatedAt = isoNow(),
      )
      val newPublicTarget = if (host.trim().isNotEmpty()) {
        AndroidPublicWakeTarget(
          kind = "router_wan_udp",
          host = host.trim(),
          port = port,
          enabled = enabled,
          updatedAt = isoNow(),
        )
      } else {
        null
      }
      val updatedWake = existingWake.copy(
        publicTarget = newPublicTarget,
        updatedAt = isoNow(),
      )
      val updatedBinding = binding.copy(wake = updatedWake)
      saveBinding(updatedBinding)
      emitBindingStateChanged(updatedBinding)
      emitIdleSyncState(updatedBinding)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("SAVE_PUBLIC_WAKE_TARGET_ERROR", error.message ?: error.javaClass.simpleName, error)
    }
  }

  @ReactMethod
  fun resetAllStatus(promise: Promise) {
    recordNativeLog("SyncEngine", "resetAllStatus requested")
    uploadStore.resetQueue()
    emitIdleSyncState(loadBinding())
    emitQueueUpdated(uploadStore.queueToWritableArray(emptyList()))
    promise.resolve(null)
  }

  // ---------------------------------------------------------------------------
  // Account Identity Reset (Phase 1 / 2 / 3)
  //
  // Android keeps sync identity plus local queue/history ledgers in
  // SharedPreferences. The allowlist wipe below preserves only account/session
  // guard keys, so client-scoped sync state is cleared with the identity. We
  // mirror the iOS 2-phase sentinel so a crash mid-wipe is recoverable on next
  // launch (see MainApplication.onCreate).
  // ---------------------------------------------------------------------------

  @ReactMethod
  fun wipeSyncIdentity(promise: Promise) {
    try {
      stopP2PTunnel()
      performWipeSyncIdentity(prefs)
      emitBindingStateCleared()
      emitQueueUpdated(Arguments.createArray())
      emitIdleSyncState(null)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("WIPE_SYNC_IDENTITY_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun getOwnerUserId(promise: Promise) {
    // Stored as String so backend ids above 2^53 round-trip losslessly
    // across the RN bridge (a Double/Long hop would truncate the low bits).
    // The JS bootstrap compares against `String(profile.id)`.
    val stored = prefs.getString(PREF_OWNER_USER_ID, null)
    promise.resolve(stored)
  }

  @ReactMethod
  fun setOwnerUserId(userId: String, promise: Promise) {
    // String-typed arg avoids the Double demotion that would otherwise
    // silently clip ids above 2^53.
    //
    // `commit()` not `apply()` — this write is the Phase-2 owner marker
    // and MUST be durable before the promise resolves. A process kill
    // between apply()'s in-memory commit and the eventual async flush
    // would leave `storedOwnerId` null on next launch, causing the
    // owner-mismatch guard in bootstrapAuthedSession to mis-classify
    // user B as a fresh install and skip the wipe — defeating the
    // entire Phase 2 defense. We already use commit() for the
    // install_marker and wipe_in_progress sentinels for the same
    // reason (see runInstallSentinel + performWipeSyncIdentity).
    //
    // Reject the JS promise if `commit()` returns `false` (disk full,
    // SharedPreferences corruption, etc.). Silently resolving on a
    // failed write would leave us one cold start away from a Phase-2
    // bypass — the marker is the only signal the owner-mismatch guard
    // has.
    val flushed = prefs.edit().putString(PREF_OWNER_USER_ID, userId).commit()
    if (flushed) {
      promise.resolve(null)
    } else {
      android.util.Log.w(
        "NativeSyncEngineModule",
        "setOwnerUserId: SharedPreferences.commit() returned false for $PREF_OWNER_USER_ID",
      )
      promise.reject(
        "SET_OWNER_USER_ID_FLUSH_FAILED",
        "SharedPreferences.commit() returned false — owner marker not durably written",
      )
    }
  }

  @ReactMethod
  fun browseAlbum(params: ReadableMap, promise: Promise) {
    runAsync(promise) {
      promise.resolve(
        mediaStoreRepository.browseAlbum(
          mediaFilter = params.getStringOrNull("mediaFilter") ?: "all",
          transferFilter = params.getStringOrNull("transferFilter") ?: "all",
          offset = if (params.hasKey("offset")) params.getInt("offset") else 0,
          limit = if (params.hasKey("limit")) params.getInt("limit") else 50,
          collectionId = params.getStringOrNull("collectionId"),
          items = uploadStore.getAllItems(),
        ),
      )
    }
  }

  @ReactMethod
  fun getAlbumStats(promise: Promise) {
    runAsync(promise) {
      promise.resolve(mediaStoreRepository.getStats(uploadStore.getAllItems()))
    }
  }

  @ReactMethod
  fun getAlbumCollections(mediaFilter: String, promise: Promise) {
    runAsync(promise) {
      promise.resolve(mediaStoreRepository.getCollections(mediaFilter))
    }
  }

  @ReactMethod
  fun getAssetPreviewSource(assetLocalId: String, promise: Promise) {
    runAsync(promise) {
      promise.resolve(mediaStoreRepository.getPreview(assetLocalId))
    }
  }

  @ReactMethod
  fun submitManualUpload(params: ReadableMap, promise: Promise) {
    runAsync(promise) {
      val rawIds = params.getArray("assetLocalIds")
      val assetIds = mutableListOf<String>()
      if (rawIds != null) {
        for (index in 0 until rawIds.size()) {
          rawIds.getString(index)?.takeIf { it.isNotBlank() }?.let(assetIds::add)
        }
      }
      val existingItems = uploadStore.getAllItems()
      val activeIds = existingItems
        .filter { it.status in ACTIVE_UPLOAD_STATUSES }
        .mapTo(mutableSetOf()) { it.assetLocalId }
      val batchId = UUID.randomUUID().toString().lowercase(Locale.US)
      val candidates = mediaStoreRepository.findAssetsByIds(
        assetLocalIds = assetIds,
        clientId = getOrCreateClientId(),
        source = "manual",
        batchId = batchId,
      )
      val queued = candidates.filter { it.assetLocalId !in activeIds }
      recordNativeLog(
        "ManualUpload",
        "submit requested selected=${assetIds.size} candidates=${candidates.size} queued=${queued.size} skipped=${assetIds.size - queued.size} batchId=$batchId",
      )
      uploadStore.upsertItems(queued)
      emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
      emitIdleSyncState(loadBinding())
      val result = Arguments.createMap().apply {
        putInt("queuedCount", queued.size)
        putInt("skippedCount", assetIds.size - queued.size)
        putString("batchId", batchId)
      }
      promise.resolve(result)
      if (queued.isNotEmpty()) {
        startForegroundSyncRound(
          reason = "manual_upload",
          threadName = "NativeSyncEngineManualUpload",
        )
      }
    }
  }

  @ReactMethod
  fun submitDocumentUploads(params: ReadableMap, promise: Promise) {
    val files = params.getArray("files")
    if (files == null || files.size() == 0) {
      promise.resolve(emptyDocumentUploadResult())
      return
    }

    val uris = mutableListOf<Uri>()
    for (index in 0 until files.size()) {
      val file = files.getMap(index) ?: continue
      val rawUri = file.getString("uri")?.trim().orEmpty()
      if (rawUri.isBlank()) {
        continue
      }
      uris += Uri.parse(rawUri)
    }

    if (uris.isEmpty()) {
      promise.resolve(emptyDocumentUploadResult())
      return
    }

    runAsync(promise) {
      val result = queueDocumentUploads(uris)
      promise.resolve(result)
      if (result.getInt("queuedCount") > 0) {
        startForegroundSyncRound(
          reason = "manual_upload",
          threadName = "NativeSyncEngineDocumentUpload",
        )
      }
    }
  }

  private fun queueDocumentUploads(uris: List<Uri>): WritableMap {
    val existingItems = uploadStore.getAllItems()
    val activeIds = existingItems
      .filter { it.status in ACTIVE_UPLOAD_STATUSES }
      .mapTo(mutableSetOf()) { it.assetLocalId }
    val batchId = UUID.randomUUID().toString().lowercase(Locale.US)
    val clientId = getOrCreateClientId()
    val now = isoNow()
    val queued = mutableListOf<AndroidUploadItem>()
    val files = Arguments.createArray()
    var skipped = 0

    for (uri in uris) {
      takePersistableDocumentPermission(uri)
      val metadata = readPickedDocumentMetadata(uri)
      if (metadata == null || metadata.size <= 0) {
        skipped += 1
        continue
      }
      val assetLocalId = "document:${metadata.uri}"
      if (assetLocalId in activeIds) {
        skipped += 1
        continue
      }

      val mediaType = AndroidSyncPrimitives.classifyMediaType(metadata.mimeType, metadata.name)
      val item = AndroidUploadItem(
        assetLocalId = assetLocalId,
        fileKey = AndroidSyncPrimitives.computeFileKey(clientId, assetLocalId, mediaType),
        filename = metadata.name,
        mediaType = mediaType,
        mimeType = metadata.mimeType,
        fileSize = metadata.size,
        createdAt = now,
        modifiedAt = now,
        uri = metadata.uri.toString(),
        status = "queued",
        source = "manual",
        batchId = batchId,
        ackedOffset = 0,
        updatedAt = now,
      )
      queued += item
      files.pushMap(Arguments.createMap().apply {
        putString("name", metadata.name)
        putDouble("size", metadata.size.toDouble())
        putString("mimeType", metadata.mimeType)
        putString("uri", metadata.uri.toString())
      })
      activeIds += assetLocalId
    }

    if (queued.isNotEmpty()) {
      uploadStore.upsertItems(queued)
      emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
      emitIdleSyncState(loadBinding())
    }

    recordNativeLog(
      "ManualUpload",
      "document picker queued=${queued.size} skipped=$skipped selected=${uris.size} batchId=$batchId",
    )
    return Arguments.createMap().apply {
      putInt("queuedCount", queued.size)
      putInt("skippedCount", skipped)
      putString("batchId", batchId)
      putArray("files", files)
    }
  }

  private fun readPickedDocumentMetadata(uri: Uri): PickedDocumentMetadata? {
    val resolver = reactApplicationContext.contentResolver
    var displayName: String? = null
    var size = 0L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0) {
          displayName = cursor.getString(nameIndex)
        }
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
          size = cursor.getLong(sizeIndex)
        }
      }
    }
    if (size <= 0) {
      size = resolver.openAssetFileDescriptor(uri, "r")?.use { descriptor ->
        descriptor.length.takeIf { it > 0 } ?: 0
      } ?: 0
    }
    val filename = sanitizeDocumentFilename(
      displayName?.takeIf { it.isNotBlank() }
        ?: uri.lastPathSegment
        ?: "Document",
    )
    val mimeType = resolver.getType(uri)
      ?: AndroidSyncPrimitives.mimeTypeForFilename(filename)
    return PickedDocumentMetadata(
      name = filename,
      size = size,
      mimeType = mimeType,
      uri = uri,
    )
  }

  private fun takePersistableDocumentPermission(uri: Uri) {
    try {
      reactApplicationContext.contentResolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION,
      )
    } catch (error: SecurityException) {
      recordNativeLog("ManualUpload", "persistable URI permission unavailable uri=$uri", Log.WARN)
    } catch (error: IllegalArgumentException) {
      recordNativeLog("ManualUpload", "URI permission is not persistable uri=$uri", Log.WARN)
    }
  }

  private fun sanitizeDocumentFilename(raw: String): String {
    val base = raw.trim().ifBlank { "Document" }
    val cleaned = buildString(base.length) {
      for (char in base) {
        when (char) {
          '/', '\\', ':', '\u0000', '\r', '\n' -> append('_')
          else -> append(char)
        }
      }
    }
    return cleaned.ifBlank { "Document" }
  }

  private fun emptyDocumentUploadResult(): WritableMap =
    Arguments.createMap().apply {
      putInt("queuedCount", 0)
      putInt("skippedCount", 0)
      putString("batchId", "")
      putArray("files", Arguments.createArray())
    }

  @ReactMethod
  fun cancelManualBatch(batchId: String, promise: Promise) {
    recordNativeLog("ManualUpload", "cancel batch requested batchId=$batchId")
    uploadStore.cancelManualBatch(batchId, isoNow())
    emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
    emitIdleSyncState(loadBinding())
    promise.resolve(null)
  }

  @ReactMethod
  fun cancelAllManualUploads(promise: Promise) {
    recordNativeLog("ManualUpload", "cancel all requested")
    uploadStore.cancelAllManual(isoNow())
    emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
    emitIdleSyncState(loadBinding())
    promise.resolve(null)
  }

  @ReactMethod
  fun pauseAutoUpload(promise: Promise) {
    recordNativeLog("AutoUpload", "pause requested")
    persistAutoUploadInterruptedState()
    uploadStore.cancelPendingAutoItems(isoNow())
    emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
    emitSyncState(loadBinding(), "paused_auto_upload")
    promise.resolve(null)
  }

  @ReactMethod
  fun disableAutoUpload(promise: Promise) {
    recordNativeLog("AutoUpload", "disable requested")
    persistAutoUploadDisabledState()
    uploadStore.cancelPendingAutoItems(isoNow())
    emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
    recordDiagnosticsLog("AutoUpload", "disabled persisted")
    emitIdleSyncState(loadBinding())
    promise.resolve(null)
  }

  @ReactMethod
  fun resumeAutoUpload(promise: Promise) {
    runAsync(promise) {
      val previousConfig = loadAutoUploadConfig()
      val nextConfig = previousConfig.copy(enabled = true, state = "active")
      val shouldStartRound = AndroidSyncPrimitives.shouldStartAutoUploadRound(
        previousEnabled = previousConfig.enabled,
        previousState = previousConfig.state,
        nextEnabled = nextConfig.enabled,
        nextState = nextConfig.state,
      )
      val binding = if (shouldStartRound) refreshBindingReachability(loadBinding()) else loadBinding()
      if (shouldStartRound && !isBindingConnected(binding)) {
        recordDiagnosticsLog("AutoUpload", "resume blocked because desktop is offline")
        emitIdleSyncState(binding)
        promise.reject("ANDROID_SYNC_TARGET_OFFLINE", "桌面端未连接，无法开启自动上传。")
        return@runAsync
      }
      if (shouldStartRound && currentPhotoPermissionState() == "denied") {
        recordDiagnosticsLog("AutoUpload", "resume blocked because photo permission is denied")
        emitIdleSyncState(binding)
        promise.reject("ANDROID_PHOTO_PERMISSION_DENIED", "Android 相簿权限尚未开启，无法扫描同步素材。")
        return@runAsync
      }

      saveAutoUploadConfig(nextConfig)
      recordDiagnosticsLog(
        "AutoUpload",
        "resume requested previousState=${previousConfig.state} nextState=${nextConfig.state} startRound=$shouldStartRound",
      )
      emitIdleSyncState(binding)
      promise.resolve(null)
      if (shouldStartRound) {
        startAutoUploadSyncRound(reason = "auto_upload_resume")
      }
    }
  }

  @ReactMethod
  fun getAutoUploadConfig(promise: Promise) {
    promise.resolve(buildAutoUploadConfigMap())
  }

  @ReactMethod
  fun getAndroidBackgroundKeepaliveStatus(promise: Promise) {
    val result = Arguments.createMap().apply {
      val isForegroundServiceActive = synchronized(syncRunLock) { syncInProgress }
      putString("backgroundKeepaliveStrategy", currentAndroidBackgroundKeepaliveStrategy())
      putBoolean("foregroundServiceActive", isForegroundServiceActive)
      putBoolean("foregroundServiceStopRequested", foregroundSyncStopRequested)
      putBoolean("batteryOptimizationIgnored", isIgnoringBatteryOptimizationsValue())
      putBoolean("postNotificationsGranted", arePostNotificationsGranted())
      putString("lastBackgroundStopReason", lastBackgroundStopReason)
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    promise.resolve(isIgnoringBatteryOptimizationsValue())
  }

  @ReactMethod
  fun requestIgnoreBatteryOptimizations(promise: Promise) {
    if (BuildConfig.FLAVOR == "global") {
      recordDiagnosticsLog("Keepalive", "battery optimization request ignored for global flavor")
      promise.resolve(false)
      return
    }
    try {
      if (isIgnoringBatteryOptimizationsValue()) {
        promise.resolve(true)
        return
      }
      val requestIntent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val fallbackIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val packageManager = reactApplicationContext.packageManager
      val intent = if (requestIntent.resolveActivity(packageManager) != null) {
        requestIntent
      } else {
        fallbackIntent
      }
      reactApplicationContext.startActivity(intent)
      recordDiagnosticsLog("Keepalive", "battery optimization settings opened")
      promise.resolve(false)
    } catch (error: Throwable) {
      recordDiagnosticsLog(
        "Keepalive",
        "battery optimization request failed: ${error.message ?: error.javaClass.simpleName}",
      )
      promise.reject(
        "ANDROID_BATTERY_OPTIMIZATION_REQUEST_FAILED",
        error.message ?: "Failed to open battery optimization settings",
        error,
      )
    }
  }

  @ReactMethod
  fun saveAutoUploadConfig(params: ReadableMap, promise: Promise) {
    val currentConfig = loadAutoUploadConfig()
    val enabled = if (params.hasKey("enabled") && !params.isNull("enabled")) {
      params.getBoolean("enabled")
    } else {
      currentConfig.enabled
    }
    val timeRangeMode = params.getStringOrNull("timeRangeMode")
      ?.takeIf { it.isNotBlank() }
      ?: currentConfig.timeRangeMode
    val customTimeFrom = params.getStringOrNull("customTimeFrom")
      ?.takeIf { it.isNotBlank() }
      ?: currentConfig.customTimeFrom
    val state = when {
      !enabled -> "disabled"
      currentConfig.state == "disabled" -> "active"
      else -> currentConfig.state
    }

    val nextConfig = AutoUploadConfig(
      enabled = enabled,
      state = state,
      timeRangeMode = timeRangeMode,
      customTimeFrom = customTimeFrom,
    )
    val shouldStartRound = AndroidSyncPrimitives.shouldStartAutoUploadRound(
      previousEnabled = currentConfig.enabled,
      previousState = currentConfig.state,
      nextEnabled = nextConfig.enabled,
      nextState = nextConfig.state,
    )

    runAsync(promise) {
      val binding = if (shouldStartRound) refreshBindingReachability(loadBinding()) else loadBinding()
      if (shouldStartRound && !isBindingConnected(binding)) {
        recordDiagnosticsLog("AutoUpload", "config enable blocked because desktop is offline")
        emitIdleSyncState(binding)
        promise.reject("ANDROID_SYNC_TARGET_OFFLINE", "桌面端未连接，无法开启自动上传。")
        return@runAsync
      }

      saveAutoUploadConfig(nextConfig)
      recordDiagnosticsLog(
        "AutoUpload",
        "config saved previousState=${currentConfig.state} nextState=${nextConfig.state} enabled=${nextConfig.enabled} startRound=$shouldStartRound",
      )
      promise.resolve(null)
      if (shouldStartRound) {
        startAutoUploadSyncRound(reason = "auto_upload_config_enabled")
      }
    }
  }

  @ReactMethod
  fun browseSharedFiles(scope: String, path: String, accessToken: String, promise: Promise) {
    runAsync(promise) {
      promise.resolve(fetchSharedDirectory(scope, path, accessToken))
    }
  }

  @ReactMethod
  fun downloadSharedFile(scope: String, path: String, accessToken: String, promise: Promise) {
    runAsync(promise) {
      recordNativeLog("SharedFiles", "downloadSharedFile requested scope=$scope path=$path")
      promise.resolve(downloadSharedFileToLocalStorage(scope, path, accessToken))
    }
  }

  @ReactMethod
  fun downloadReceivedFile(fileKey: String, filename: String, mediaType: String?, promise: Promise) {
    runAsync(promise) {
      recordNativeLog(
        "SharedFiles",
        "downloadReceivedFile requested fileKey=${fileKey.trim()} filename=$filename media_type=${mediaType ?: "nil"}",
      )
      promise.resolve(downloadReceivedFileToLocalStorage(fileKey, filename, mediaType))
    }
  }

  @ReactMethod
  fun listReceivedFiles(promise: Promise) {
    runAsync(promise) {
      recordNativeLog("SharedFiles", "listReceivedFiles requested")
      promise.resolve(fetchReceivedFiles())
    }
  }

  @ReactMethod
  fun getReceivedFilePreviewUrl(fileKey: String, kind: String, promise: Promise) {
    runAsync(promise) {
      val normalizedFileKey = fileKey.trim()
      require(normalizedFileKey.isNotBlank()) { "Received file key is required" }
      val normalizedKind = normalizeReceivedMediaKind(kind)
      val route = resolveSharedFileRoute(
        scope = "team",
        kind = if (normalizedKind == "download") "download" else "stream",
        path = normalizedFileKey,
        requestAccessToken = "",
        reason = "preview_received_file",
      )
      logSharedFileRoute("getReceivedFilePreviewUrl", route)
      val previewUrl = receivedFileUrlForRoute(normalizedFileKey, route, normalizedKind)
      recordNativeLog(
        "SharedFiles",
        "getReceivedFilePreviewUrl resolved fileKey=$normalizedFileKey kind=$normalizedKind url_host=${previewUrl.host} url_path=${previewUrl.path}",
      )
      updateSharedFilesReachability(
        state = "available",
        route = route,
        reason = "preview_received_file_route_selected",
      )
      promise.resolve(previewUrl.toString())
    }
  }

  @ReactMethod
  fun getSharedFileStreamUrl(scope: String, path: String, accessToken: String, promise: Promise) {
    runAsync(promise) {
      val route = resolveSharedFileRoute(
        scope = scope,
        kind = "stream",
        path = path,
        requestAccessToken = accessToken,
        reason = "stream_shared_file",
      )
      logSharedFileRoute("getSharedFileStreamUrl", route)
      val streamUrl = sharedFileUrlForRoute("stream", path, route)
      recordNativeLog(
        "SharedFiles",
        "getSharedFileStreamUrl resolved scope=$scope path=$path url_host=${streamUrl.host} url_path=${streamUrl.path}",
      )
      promise.resolve(streamUrl.toString())
    }
  }

  @ReactMethod
  fun prepareSharedFilePreview(scope: String, path: String, accessToken: String, filename: String, promise: Promise) {
    runAsync(promise) {
      recordNativeLog("SharedFiles", "prepareSharedFilePreview requested scope=$scope path=$path")
      var route = resolveSharedFileRoute(
        scope = scope,
        kind = "download",
        path = path,
        requestAccessToken = accessToken,
        reason = "preview_shared_file",
      )
      logSharedFileRoute("prepareSharedFilePreview", route)
      try {
        val localPath = downloadSharedFilePreviewFromRoute(path, filename, route)
        updateSharedFilesReachability(
          state = "available",
          route = route,
          reason = "preview_shared_file_success",
        )
        recordNativeLog(
          "SharedFiles",
          "prepareSharedFilePreview completed scope=$scope path=$path is_tunnel=${route.isTunnel} local_path=$localPath",
        )
        promise.resolve(localPath)
      } catch (err: Throwable) {
        if (!AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(route.isTunnel)) {
          recordNativeLog(
            "SharedFiles",
            "prepareSharedFilePreview failed path=$path is_tunnel=${route.isTunnel} retry=false error=${err.message ?: err::class.java.simpleName}",
            Log.WARN,
          )
          throw err
        }
        route = recoverSharedFileTunnelAfterRouteFailure(
          scope = scope,
          kind = "download",
          path = path,
          requestAccessToken = accessToken,
          reason = "preview_shared_file",
          error = err,
        )
        logSharedFileRoute("prepareSharedFilePreview", route, retry = true)
        val localPath = downloadSharedFilePreviewFromRoute(path, filename, route)
        updateSharedFilesReachability(
          state = "available",
          route = route,
          reason = "preview_shared_file_success",
        )
        recordNativeLog(
          "SharedFiles",
          "prepareSharedFilePreview completed scope=$scope path=$path retry=true is_tunnel=${route.isTunnel} local_path=$localPath",
        )
        promise.resolve(localPath)
      }
    }
  }

  @ReactMethod
  fun shareFile(localPath: String, promise: Promise) {
    try {
      recordNativeLog("SharedFiles", "shareFile requested local_path=$localPath")
      val uri = when {
        localPath.startsWith("content://") -> Uri.parse(localPath)
        localPath.startsWith("file://") -> fileProviderUri(File(Uri.parse(localPath).path ?: ""))
        else -> fileProviderUri(File(localPath))
      }
      val resolvedType = reactApplicationContext.contentResolver.getType(uri) ?: "*/*"
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = resolvedType
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      recordNativeLog("SharedFiles", "shareFile launched uri_scheme=${uri.scheme} mime_type=$resolvedType")
      promise.resolve(true)
    } catch (error: Throwable) {
      recordNativeLog(
        "SharedFiles",
        "shareFile failed local_path=$localPath error=${error.message ?: error::class.java.simpleName}",
        Log.WARN,
      )
      promise.reject("ANDROID_SHARE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun downloadUrlToShareCache(url: String, filename: String, promise: Promise) {
    runAsync(promise) {
      val remoteUrl = URL(url)
      recordNativeLog(
        "SharedFiles",
        "downloadUrlToShareCache requested filename=$filename url_host=${remoteUrl.host} url_path=${remoteUrl.path}",
      )
      val connection = remoteUrl.openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "GET"
        connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
        connection.readTimeout = SHARED_DOWNLOAD_TIMEOUT_MS
        val statusCode = connection.responseCode
        recordNativeLog(
          "SharedFiles",
          "downloadUrlToShareCache response filename=$filename status=$statusCode content_type=${connection.contentType ?: "nil"} content_length=${connection.contentLengthLong}",
        )
        if (statusCode !in 200..299) {
          throw IllegalStateException("Download failed with HTTP $statusCode")
        }
        val destDir = File(reactApplicationContext.cacheDir, "syncflow_shared_downloads")
        if (!destDir.exists()) {
          destDir.mkdirs()
        }
        val fallbackName = remoteUrl.path.substringAfterLast('/').ifBlank { "remote-file" }
        val destFile = uniqueShareCacheFile(destDir, safeShareCacheFilename(filename, fallbackName))
        BufferedOutputStream(destFile.outputStream()).use { output ->
          BufferedInputStream(connection.inputStream).use { input ->
            input.copyTo(output)
          }
        }
        recordNativeLog(
          "SharedFiles",
          "downloadUrlToShareCache completed filename=${destFile.name} local_path=${destFile.absolutePath} bytes=${destFile.length()}",
        )
        promise.resolve(destFile.absolutePath)
      } finally {
        connection.disconnect()
      }
    }
  }

  @ReactMethod
  fun downloadUrlToLocal(url: String, filename: String, mediaType: String?, promise: Promise) {
    runAsync(promise) {
      val remoteUrl = URL(url)
      recordNativeLog(
        "SharedFiles",
        "downloadUrlToLocal requested filename=$filename media_type=${mediaType ?: "nil"} url_host=${remoteUrl.host} url_path=${remoteUrl.path}",
      )
      val safeFilename = safeShareCacheFilename(
        filename,
        remoteUrl.path.substringAfterLast('/').ifBlank { "remote-file" },
      )
      val localMediaType = localDownloadMediaType(safeFilename, mediaType)
      val connection = remoteUrl.openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "GET"
        connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
        connection.readTimeout = SHARED_DOWNLOAD_TIMEOUT_MS
        val statusCode = connection.responseCode
        recordNativeLog(
          "SharedFiles",
          "downloadUrlToLocal response filename=$safeFilename status=$statusCode media_type=$localMediaType content_type=${connection.contentType ?: "nil"} content_length=${connection.contentLengthLong}",
        )
        if (statusCode !in 200..299) {
          throw IllegalStateException("Download failed with HTTP $statusCode")
        }
        val mimeType = connection.contentType?.substringBefore(';')
          ?: AndroidSyncPrimitives.mimeTypeForFilename(safeFilename)
        val totalBytes = connection.contentLengthLong.takeIf { it > 0L } ?: 0L

        if (localMediaType == "image" || localMediaType == "video") {
          val collection = if (localMediaType == "video") {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
          } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
          }
          val savedLocation = if (localMediaType == "video") {
            "${Environment.DIRECTORY_MOVIES}/Vivi Drop"
          } else {
            "${Environment.DIRECTORY_PICTURES}/Vivi Drop"
          }
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
              put(MediaStore.MediaColumns.RELATIVE_PATH, savedLocation)
              put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
          }
          val uri = reactApplicationContext.contentResolver.insert(collection, values)
            ?: throw IllegalStateException("Unable to create MediaStore item")
          reactApplicationContext.contentResolver.openOutputStream(uri)?.use { output ->
            connection.inputStream.use { input ->
              copySharedDownloadWithProgress(safeFilename, input, output, totalBytes)
            }
          } ?: throw IllegalStateException("Unable to write MediaStore item")
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            reactApplicationContext.contentResolver.update(uri, values, null, null)
          }
          recordNativeLog(
            "SharedFiles",
            "downloadUrlToLocal saved_to_photos filename=$safeFilename media_type=$localMediaType saved_location=$savedLocation uri=$uri",
          )
          promise.resolve(Arguments.createMap().apply {
            putBoolean("savedToPhotos", true)
            putNull("localPath")
            putString("savedLocation", savedLocation)
          })
          return@runAsync
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val savedLocation = "${Environment.DIRECTORY_DOWNLOADS}/Vivi Drop"
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, savedLocation)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
          val uri = reactApplicationContext.contentResolver.insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            values,
          ) ?: throw IllegalStateException("Unable to create MediaStore item")
          reactApplicationContext.contentResolver.openOutputStream(uri)?.use { output ->
            connection.inputStream.use { input ->
              copySharedDownloadWithProgress(safeFilename, input, output, totalBytes)
            }
          } ?: throw IllegalStateException("Unable to write MediaStore item")
          values.clear()
          values.put(MediaStore.MediaColumns.IS_PENDING, 0)
          reactApplicationContext.contentResolver.update(uri, values, null, null)
          recordNativeLog(
            "SharedFiles",
            "downloadUrlToLocal saved_to_downloads filename=$safeFilename saved_location=$savedLocation local_path=$uri expose_uri=true",
          )
          promise.resolve(Arguments.createMap().apply {
            putBoolean("savedToPhotos", false)
            putString("localPath", uri.toString())
            putString("savedLocation", savedLocation)
          })
        } else {
          val destDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "Vivi Drop",
          )
          if (!destDir.exists()) {
            destDir.mkdirs()
          }
          val destFile = uniqueShareCacheFile(destDir, safeFilename)
          destFile.outputStream().use { output ->
            connection.inputStream.use { input ->
              copySharedDownloadWithProgress(safeFilename, input, output, totalBytes)
            }
          }
          recordNativeLog(
            "SharedFiles",
            "downloadUrlToLocal saved_to_downloads filename=$safeFilename saved_location=${Environment.DIRECTORY_DOWNLOADS}/Vivi Drop local_path=${destFile.absolutePath}",
          )
          promise.resolve(Arguments.createMap().apply {
            putBoolean("savedToPhotos", false)
            putString("localPath", destFile.absolutePath)
            putString("savedLocation", "${Environment.DIRECTORY_DOWNLOADS}/Vivi Drop")
          })
        }
      } finally {
        connection.disconnect()
      }
    }
  }

  @ReactMethod
  fun shareFiles(localPaths: ReadableArray, promise: Promise) {
    try {
      recordNativeLog("SharedFiles", "shareFiles requested count=${localPaths.size()}")
      val uris = arrayListOf<Uri>()
      var mimeType: String? = null
      for (index in 0 until localPaths.size()) {
        val localPath = localPaths.getString(index) ?: continue
        val uri = when {
          localPath.startsWith("content://") -> Uri.parse(localPath)
          localPath.startsWith("file://") -> fileProviderUri(File(Uri.parse(localPath).path ?: ""))
          else -> fileProviderUri(File(localPath))
        }
        uris.add(uri)
        val currentType = reactApplicationContext.contentResolver.getType(uri) ?: "*/*"
        mimeType = if (mimeType == null || mimeType == currentType) currentType else "*/*"
      }
      if (uris.isEmpty()) {
        throw IllegalArgumentException("No files to share")
      }
      val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = mimeType ?: "*/*"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      recordNativeLog("SharedFiles", "shareFiles launched count=${uris.size} mime_type=${mimeType ?: "*/*"}")
      promise.resolve(true)
    } catch (error: Throwable) {
      recordNativeLog(
        "SharedFiles",
        "shareFiles failed count=${localPaths.size()} error=${error.message ?: error::class.java.simpleName}",
        Log.WARN,
      )
      promise.reject("ANDROID_SHARE_FAILED", error.message, error)
    }
  }

  private fun fileProviderUri(file: File): Uri =
    FileProvider.getUriForFile(
      reactApplicationContext,
      "${reactApplicationContext.packageName}.syncflow.fileprovider",
      file,
    )

  private fun safeShareCacheFilename(filename: String, fallbackName: String): String {
    val candidate = filename.trim().ifBlank { fallbackName }
    val sanitized = candidate
      .replace(Regex("[/\\\\:\\p{Cntrl}]"), "_")
      .trim()
    return sanitized.ifBlank { "remote-file" }
  }

  private fun localDownloadMediaType(filename: String, requestedMediaType: String?): String {
    val normalized = requestedMediaType?.trim()?.lowercase(Locale.ROOT)
    if (normalized == "image" || normalized?.startsWith("image/") == true) {
      return "image"
    }
    if (normalized == "video" || normalized?.startsWith("video/") == true) {
      return "video"
    }
    return AndroidSyncPrimitives.classifyMediaType(
      AndroidSyncPrimitives.mimeTypeForFilename(filename),
      filename,
    )
  }

  private fun uniqueShareCacheFile(directory: File, filename: String): File {
    val initial = File(directory, filename)
    if (!initial.exists()) return initial
    val dotIndex = filename.lastIndexOf('.')
    val baseName = if (dotIndex > 0) filename.substring(0, dotIndex) else filename
    val extension = if (dotIndex > 0) filename.substring(dotIndex) else ""
    for (index in 1..999) {
      val candidate = File(directory, "$baseName-$index$extension")
      if (!candidate.exists()) return candidate
    }
    return File(directory, "${UUID.randomUUID()}-$filename")
  }

  @ReactMethod
  fun getPhotoAuthorizationStatus(promise: Promise) {
    // Reuse the same permission check as requestPhotoPermission so both
    // bridge methods agree on what "authorized" means.
    val state = currentPhotoPermissionState()
    promise.resolve(
      when {
        state == "granted" -> "authorized"
        state == "limited" -> "limited"
        else -> "denied"
      },
    )
  }

  @ReactMethod
  fun presentLimitedPhotoPicker(promise: Promise) {
    // No limited-access picker concept on Android; resolve as no-op.
    promise.resolve(null)
  }

  private fun runAsync(promise: Promise, block: () -> Unit) {
    thread(name = "NativeSyncEngine", isDaemon = true) {
      try {
        block()
      } catch (error: NativeStructuredError) {
        recordNativeLog("Bridge", "async method failed: ${error.nativeCode}: ${error.message}", Log.ERROR)
        promise.reject(error.nativeCode, error.message, error, error.userInfo)
      } catch (error: Throwable) {
        recordNativeLog("Bridge", "async method failed: ${error.message ?: error.javaClass.simpleName}", Log.ERROR)
        promise.reject("NATIVE_SYNC_ENGINE_ERROR", error.message, error)
      }
    }
  }

  private fun startForegroundSyncRound(
    reason: String,
    threadName: String,
    notificationReason: String = reason,
  ) {
    thread(name = threadName, isDaemon = true) {
      performSyncRound(reason = reason, notificationReason = notificationReason)
    }
  }

  private fun startForegroundSyncService(reason: String): Boolean {
    if (!NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled()) {
      recordNativeLog(
        "BackgroundSync",
        "foreground service notification is not allowed",
        Log.WARN,
      )
      return false
    }

    return runCatching {
      AndroidForegroundSyncService.start(reactApplicationContext, reason)
      true
    }.onFailure { error ->
      recordNativeLog(
        "BackgroundSync",
        "failed to start foreground service: ${error.message ?: error.javaClass.simpleName}",
        Log.WARN,
      )
    }.getOrDefault(false)
  }

  private fun stopForegroundSyncService() {
    runCatching {
      AndroidForegroundSyncService.finish(reactApplicationContext)
    }.onFailure { error ->
      recordNativeLog(
        "BackgroundSync",
        "failed to stop foreground service: ${error.message ?: error.javaClass.simpleName}",
        Log.WARN,
      )
    }
  }

  private fun requestForegroundSyncStopInternal(reason: String = "foreground_service_stop") {
    foregroundSyncStopRequested = true
    lastBackgroundStopReason = reason
    recordDiagnosticsLog("BackgroundSync", "foreground sync stop requested reason=$reason")
  }

  private fun clearForegroundSyncStopRequest() {
    val nextState = AndroidSyncPrimitives.clearForegroundSyncStopRequest(
      AndroidBackgroundKeepaliveStopState(
        foregroundStopRequested = foregroundSyncStopRequested,
        lastStopReason = lastBackgroundStopReason,
      ),
    )
    foregroundSyncStopRequested = nextState.foregroundStopRequested
    lastBackgroundStopReason = nextState.lastStopReason
  }

  private fun pairingTokenForKnownDevice(deviceId: String): String? {
    val normalizedDeviceId = deviceId.trim()
    if (normalizedDeviceId.isBlank()) {
      return null
    }

    val binding = loadBinding() ?: return null
    if (binding.deviceId != normalizedDeviceId) {
      return null
    }

    return binding.pairingToken.takeIf { it.isNotBlank() }
  }

  private fun currentClientIPv4(): String? {
    return currentClientIPv4Network()?.address
  }

  private fun currentClientIPv4Network(): IPv4Network? {
    return try {
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
      while (interfaces.hasMoreElements()) {
        val networkInterface = interfaces.nextElement()
        if (!networkInterface.isUp || networkInterface.isLoopback) {
          continue
        }

        for (interfaceAddress in networkInterface.interfaceAddresses) {
          val address = interfaceAddress.address
          if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
            val prefixLength = interfaceAddress.networkPrefixLength.toInt()
            val hostAddress = address.hostAddress ?: continue
            if (prefixLength in 1..30) {
              return IPv4Network(
                address = hostAddress,
                prefixLength = prefixLength,
              )
            }
          }
        }
      }
      null
    } catch (_: Throwable) {
      null
    }
  }

  private fun performPairing(
    host: String,
    port: Int,
    fallbackDeviceId: String,
    connectionCode: String,
    storedPairingToken: String?,
    helloPayload: JSONObject,
  ): StoredBinding {
    Socket().use { socket ->
      recordNativeLog("Pairing", "TCP connecting host=$host port=$port")
      socket.connect(InetSocketAddress(host, port), SOCKET_TIMEOUT_MS)
      socket.soTimeout = SOCKET_TIMEOUT_MS
      recordNativeLog("Pairing", "TCP connected host=$host port=$port")

      val input = DataInputStream(socket.getInputStream())
      val output = DataOutputStream(socket.getOutputStream())

      writeJsonFrame(output, TYPE_HELLO_REQ, helloPayload)
      val helloResponse = readJsonFrame(input, TYPE_HELLO_RES, structuredErrors = true)
      if (helloResponse.optInt("appCompatibilityVersion", -1) != APP_COMPATIBILITY_VERSION) {
        throw structuredNativeError(
          code = "APP_VERSION_INCOMPATIBLE",
          rawMessage = "手機與桌面 App 版本不相容，請同時更新兩端後再連線。",
          meta = null,
        )
      }
      recordNativeLog(
        "Pairing",
        "HELLO_RES serverId=${helloResponse.optString("serverId").ifBlank { "<missing>" }} authRequired=${helloResponse.optBoolean("authRequired", true)}",
      )

      val serverCapabilities = helloResponse.optJSONObject("serverCapabilities")
      val shareName = serverCapabilities?.optString("shareName")
        ?.takeIf { it.isNotBlank() }
      val wake = AndroidSyncPrimitives.parseWakeCapability(serverCapabilities?.optJSONObject("wake"))
      val serverId = helloResponse.optString("serverId")
        .takeIf { it.isNotBlank() }
        ?: fallbackDeviceId
      val serverName = helloResponse.optString("serverName")
        .takeIf { it.isNotBlank() }
        ?: host

      if (!helloResponse.optBoolean("authRequired", true)) {
        return StoredBinding(
          deviceId = serverId,
          deviceName = serverName,
          deviceAlias = serverName,
          host = host,
          port = port,
          pairingId = "",
          pairingToken = storedPairingToken.orEmpty(),
          shareEnabled = shareName != null,
          shareName = shareName,
          lastBoundAt = isoNow(),
          connectionState = "connected",
          wake = wake,
        )
      }

      val pairPayload = JSONObject().apply {
        put("clientId", getOrCreateClientId())
        put("stableDeviceId", getOrCreateStableDeviceId())
        put("clientName", getClientDisplayNameValue())
        put("connectionCode", connectionCode)
        currentClientIPv4()?.let { put("clientIp", it) }
      }
      writeJsonFrame(output, TYPE_PAIR_REQ, pairPayload)
      val pairResponse = readJsonFrame(input, TYPE_PAIR_RES)

      if (!pairResponse.optBoolean("ok", false)) {
        val errorCode = structuredErrorCode(pairResponse.optString("errorCode"))
        val errMsg = pairResponse.optString("error").ifBlank { "Pairing rejected" }
        recordNativeLog("Pairing", "PAIR_RES rejected code=${errorCode ?: "<none>"} error=$errMsg", Log.WARN)
        if (errorCode != null) {
          throw structuredNativeError(
            code = errorCode,
            rawMessage = errMsg,
            meta = pairResponse.optJSONObject("errorMeta"),
          )
        }
        throw IllegalStateException(errMsg)
      }
      recordNativeLog("Pairing", "PAIR_RES ok pairingId=${pairResponse.optString("pairingId")}")

      val serverInfo = pairResponse.optJSONObject("serverInfo")
      return StoredBinding(
        deviceId = serverInfo?.optString("serverId")
          ?.takeIf { it.isNotBlank() }
          ?: serverId,
        deviceName = serverInfo?.optString("serverName")
          ?.takeIf { it.isNotBlank() }
          ?: serverName,
        deviceAlias = serverInfo?.optString("serverName")
          ?.takeIf { it.isNotBlank() }
          ?: serverName,
        host = host,
        port = port,
        pairingId = pairResponse.optString("pairingId"),
        pairingToken = pairResponse.optString("pairingToken"),
        shareEnabled = serverInfo?.optString("shareName")?.isNotBlank() == true,
        shareName = serverInfo?.optString("shareName")?.takeIf { it.isNotBlank() },
        lastBoundAt = isoNow(),
        connectionState = "connected",
        wake = wake,
      )
    }
  }

  private fun performSyncRound(reason: String, notificationReason: String = reason) {
    synchronized(syncRunLock) {
      if (syncInProgress) {
        recordDiagnosticsLog("Sync", "round skipped reason=$reason syncInProgress=true")
        return
      }
      syncInProgress = true
      clearForegroundSyncStopRequest()
    }
    var foregroundServiceStarted = false
    try {
      var binding = loadBinding()
      if (binding == null) {
        recordDiagnosticsLog("Sync", "round paused reason=$reason no binding")
        emitSyncState(null, "paused_no_target")
        emitError("ANDROID_SYNC_NO_BINDING", "尚未绑定桌面端，无法同步。")
        return
      }
      val pendingBeforePermission = uploadStore.getPendingItems(limit = 10_000)
      val documentOnlyManualRound = reason == "manual_upload" &&
        pendingBeforePermission.isNotEmpty() &&
        pendingBeforePermission.all { it.source == "manual" && it.assetLocalId.startsWith("document:") }
      if (!documentOnlyManualRound) {
        val permissionState = currentPhotoPermissionState()
        if (permissionState == "denied") {
          recordDiagnosticsLog("Sync", "round paused reason=$reason photoPermission=denied")
          emitSyncState(binding, "paused_no_permission")
          emitError("ANDROID_PHOTO_PERMISSION_DENIED", "Android 相簿权限尚未开启，无法扫描同步素材。")
          return
        }
      } else {
        recordDiagnosticsLog("Sync", "round reason=$reason using document-only queue; skipping photo permission preflight")
      }
      val config = loadAutoUploadConfig()
      recordDiagnosticsLog(
        "Sync",
        "round requested reason=$reason autoEnabled=${config.enabled} autoState=${config.state}",
      )
      if (reason != "manual_upload" && !config.enabled) {
        recordDiagnosticsLog("Sync", "round ignored reason=$reason auto upload disabled")
        emitIdleSyncState(binding)
        return
      }

      if (!startForegroundSyncService(notificationReason)) {
        recordDiagnosticsLog("BackgroundSync", "round aborted reason=$reason foregroundServiceAvailable=false")
        emitError(
          code = "ANDROID_BACKGROUND_SYNC_SERVICE_UNAVAILABLE",
          message = "無法啟動 Android 背景同步服務，已保留佇列。",
        )
        emitIdleSyncState(binding)
        return
      }
      foregroundServiceStarted = true

      emitSyncState(binding, "scanning")
      val clientId = getOrCreateClientId()
      val existing = uploadStore.getAllItems()
      val existingAssetIds = existing
        .filter { it.status in ACTIVE_UPLOAD_STATUSES }
        .mapTo(mutableSetOf()) { it.assetLocalId }
      val discovered = if (documentOnlyManualRound) {
        emptyList()
      } else {
        mediaStoreRepository.scanAssets(clientId)
          .filter { it.assetLocalId !in existingAssetIds }
      }
      if (discovered.isNotEmpty() && config.enabled) {
        uploadStore.upsertItems(discovered.map { it.copy(source = "auto", status = "queued", updatedAt = isoNow()) })
      }

      val pending = uploadStore.getPendingItems(limit = 10_000)
      recordDiagnosticsLog(
        "Sync",
        "scan completed reason=$reason discovered=${discovered.size} pending=${pending.size}",
      )
      emitQueueUpdated(uploadStore.queueToWritableArray(pending.take(100)))
      if (pending.isEmpty()) {
        recordDiagnosticsLog("Sync", "round idle reason=$reason pending=0")
        emitIdleSyncState(binding)
        return
      }

      val sessionId = UUID.randomUUID().toString().lowercase(Locale.US)
      val totalBytes = pending.sumOf { it.fileSize }
      emitPreparationSyncState(
        binding = binding,
        sessionId = sessionId,
        pending = pending,
        totalBytes = totalBytes,
      )
      binding = updateBindingConnectionState(binding, "connecting") ?: binding
      recordNativeLog("SyncPipeline", "TCP connecting to ${binding.host}:${binding.port}")
      ProtocolConnection.open(binding).use { connection ->
        recordNativeLog("SyncPipeline", "TCP connected to ${binding.host}:${binding.port}", Log.INFO)
        binding = authenticateConnection(connection, binding)
        binding = updateBindingConnectionState(binding, "connected") ?: binding
        val beginPayload = JSONObject().apply {
          put("sessionId", sessionId)
          put("queueTotalCount", pending.size)
          put("queueTotalBytes", totalBytes)
        }
      val beginResponse = sendAndRead(connection, TYPE_SYNC_BEGIN_REQ, beginPayload, TYPE_SYNC_BEGIN_RES)
      if (!beginResponse.optBoolean("ok", true)) {
        throw IllegalStateException("SYNC_BEGIN rejected")
      }
      recordNativeLog(
        "SyncPipeline",
        "sync session started sessionId=$sessionId queueCount=${pending.size} queueBytes=$totalBytes",
        Log.INFO,
      )

        var completedCount = 0
        var completedBytes = 0L
        var lastCompletedTaskSource: String? = null
        for ((index, item) in pending.withIndex()) {
          if (foregroundSyncStopRequested) {
            recordDiagnosticsLog(
              "BackgroundSync",
              "round stopped before next item reason=$reason completed=$completedCount/${pending.size}",
            )
            break
          }
          val current = uploadStore.getItemByAssetId(item.assetLocalId) ?: item
          val currentAutoState = loadAutoUploadConfig().state
          if (!AndroidSyncPrimitives.shouldContinueAutoUploadRound(reason, current.source, currentAutoState)) {
            recordDiagnosticsLog(
              "AutoUpload",
              "round stopped reason=$reason autoState=$currentAutoState before fileKey=${current.fileKey}",
            )
            break
          }
          if (current.status == "cancelled") {
            completedCount += 1
            continue
          }
          val result = uploadOneItem(
            connection = connection,
            binding = binding,
            sessionId = sessionId,
            item = current,
            roundReason = reason,
            queueIndex = index,
            queueTotalCount = pending.size,
            completedCount = completedCount,
            completedBytes = completedBytes,
            totalBytes = totalBytes,
          )
          if (result) {
            completedCount += 1
            completedBytes += current.fileSize
            lastCompletedTaskSource = current.source
          }
        }

        val endResponse = sendAndRead(
          connection,
          TYPE_SYNC_END_REQ,
          JSONObject().apply { put("sessionId", sessionId) },
          TYPE_SYNC_END_RES,
        )
        if (!endResponse.optBoolean("ok", true)) {
          recordDiagnosticsLog("Sync", "SYNC_END returned ok=false")
        }
        recordNativeLog(
          "SyncPipeline",
          "sync session ended sessionId=$sessionId completed=$completedCount/${pending.size} bytes=$completedBytes/$totalBytes",
          Log.INFO,
        )
        emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
        if (completedCount >= pending.size) {
          emitCompletedSyncState(
            binding = binding,
            sessionId = sessionId,
            completedCount = completedCount,
            totalCount = pending.size,
            completedBytes = completedBytes,
            totalBytes = totalBytes,
            lastCompletedTaskSource = lastCompletedTaskSource,
          )
        } else {
          emitIdleSyncState(binding)
        }
      }
    } catch (error: Throwable) {
      if (error is AutoUploadRoundStoppedException) {
        recordDiagnosticsLog("AutoUpload", "round stopped during current item autoState=${error.autoUploadState}")
        emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
        emitIdleSyncState(loadBinding())
        return
      }
      if (error is ForegroundSyncStoppedException) {
        recordDiagnosticsLog("BackgroundSync", "round stopped by foreground notification action")
        emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
        emitIdleSyncState(loadBinding())
        return
      }
      val message = error.message ?: "Android sync failed"
      recordDiagnosticsLog("Sync", "sync failed: $message")
      emitError("ANDROID_SYNC_FAILED", message)
      val failedBinding = updateBindingConnectionState(loadBinding(), "offline")
      emitSyncState(
        binding = failedBinding,
        uploadState = "offline",
        lastErrorCode = "ANDROID_SYNC_FAILED",
        lastErrorMessage = message,
      )
    } finally {
      synchronized(syncRunLock) {
        syncInProgress = false
      }
      loadBinding()
        ?.takeIf { it.connectionState == "connected" }
        ?.let {
          sendPresenceHeartbeatAsync(it, reason = "sync_round_finished", recoverOnFailure = true)
          startPresenceHeartbeatTimer(it)
        }
      clearForegroundSyncStopRequest()
      if (foregroundServiceStarted) {
        stopForegroundSyncService()
      }
    }
  }

  private fun currentAndroidBackgroundKeepaliveStrategy(): String =
    if (BuildConfig.FLAVOR == "global") {
      "android_global_foreground_service_play_compliant"
    } else {
      "android_cn_foreground_service_battery_whitelist"
    }

  private fun buildAndroidBackgroundKeepaliveStatusJson(): JSONObject {
    val isForegroundServiceActive = synchronized(syncRunLock) { syncInProgress }
    return JSONObject().apply {
      put("backgroundKeepaliveStrategy", currentAndroidBackgroundKeepaliveStrategy())
      put("foregroundServiceActive", isForegroundServiceActive)
      put("foregroundServiceStopRequested", foregroundSyncStopRequested)
      put("batteryOptimizationIgnored", isIgnoringBatteryOptimizationsValue())
      put("postNotificationsGranted", arePostNotificationsGranted())
      put("lastBackgroundStopReason", lastBackgroundStopReason ?: JSONObject.NULL)
    }
  }

  private fun isIgnoringBatteryOptimizationsValue(): Boolean {
    val powerManager = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      ?: return false
    return powerManager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName)
  }

  private fun arePostNotificationsGranted(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      reactApplicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun authenticateConnection(connection: ProtocolConnection, binding: StoredBinding): StoredBinding {
    val helloPayload = JSONObject(
      AndroidSyncPrimitives.buildClientHelloPayloadFields(
        clientId = getOrCreateClientId(),
        clientName = getClientDisplayNameValue(),
        clientPlatform = "android",
        appVersion = getVersionName(),
        appState = "active",
        stableDeviceId = getOrCreateStableDeviceId(),
        pairingToken = binding.pairingToken,
      ),
    )
    writeJsonFrame(connection.output, TYPE_HELLO_REQ, helloPayload)
    val helloResponse = readJsonFrame(connection.input, TYPE_HELLO_RES)
    AndroidSyncPrimitives.requireCompatibleDesktopAppVersion(
      helloResponse.optInt("appCompatibilityVersion", -1),
    )
    recordNativeLog(
      "SyncPipeline",
      "HELLO_RES received serverId=${helloResponse.optString("serverId").ifBlank { binding.deviceId }} authRequired=${helloResponse.optBoolean("authRequired", false)} ${wakeCapabilityLogSummary(AndroidSyncPrimitives.parseWakeCapability(helloResponse.optJSONObject("serverCapabilities")?.optJSONObject("wake")))}",
    )
    val refreshedBinding = refreshBindingMetadataFromHello(binding, helloResponse) ?: binding

    val nonce = helloResponse.optString("nonce")
    if (nonce.isNotBlank()) {
      if (refreshedBinding.pairingToken.isBlank()) {
        throw IllegalStateException("Desktop requires re-pairing")
      }
      writeJsonFrame(
        connection.output,
        TYPE_AUTH_REQ,
        JSONObject().apply {
          put("clientId", getOrCreateClientId())
          put("auth", AndroidSyncPrimitives.computeAuthHmac(refreshedBinding.pairingToken, nonce))
        },
      )
      val authResponse = readJsonFrame(connection.input, TYPE_AUTH_RES)
      if (!authResponse.optBoolean("ok", false)) {
        throw IllegalStateException("Desktop authentication failed")
      }
      recordNativeLog("SyncPipeline", "auth successful", Log.INFO)
    } else if (helloResponse.optBoolean("authRequired", false)) {
      throw IllegalStateException("Desktop requires re-pairing")
    }
    return refreshedBinding
  }

  private fun refreshBindingMetadataFromHello(
    binding: StoredBinding,
    helloResponse: JSONObject,
  ): StoredBinding? {
    val serverId = helloResponse.optString("serverId").takeIf { it.isNotBlank() }
    if (serverId != null && serverId != binding.deviceId) {
      recordDiagnosticsLog(
        "SyncEngine",
        "HELLO metadata refresh skipped serverId=$serverId bindingDevice=${binding.deviceId}",
      )
      return null
    }

    val serverCapabilities = helloResponse.optJSONObject("serverCapabilities")
    val wake = AndroidSyncPrimitives.parseWakeCapability(serverCapabilities?.optJSONObject("wake"))
    val shareName = serverCapabilities?.optString("shareName")?.takeIf { it.isNotBlank() }
    val serverName = helloResponse.optString("serverName").takeIf { it.isNotBlank() }
    recordDiagnosticsLog(
      "SyncEngine",
      "HELLO metadata candidate host=${binding.host} ${wakeCapabilityLogSummary(wake)} existingWakeUsable=${binding.wake?.hasUsableTargets == true}",
    )

    val updated = binding.copy(
      deviceName = serverName ?: binding.deviceName,
      shareEnabled = shareName != null,
      shareName = shareName,
      wake = AndroidSyncPrimitives.mergeWakeCapability(wake, binding.wake),
    )
    if (updated == binding) {
      recordDiagnosticsLog(
        "SyncEngine",
        "HELLO metadata unchanged host=${binding.host} ${wakeCapabilityLogSummary(wake)}",
      )
      return binding
    }

    saveBinding(updated)
    emitBindingStateChanged(updated)
    recordDiagnosticsLog(
      "SyncEngine",
      "binding metadata refreshed from HELLO host=${binding.host} ${wakeCapabilityLogSummary(updated.wake)} shareEnabled=${updated.shareEnabled}",
    )
    return updated
  }

  private fun uploadOneItem(
    connection: ProtocolConnection,
    binding: StoredBinding,
    sessionId: String,
    item: AndroidUploadItem,
    roundReason: String,
    queueIndex: Int,
    queueTotalCount: Int,
    completedCount: Int,
    completedBytes: Long,
    totalBytes: Long,
  ): Boolean {
    recordNativeLog(
      "SyncUpload",
      "[${queueIndex + 1}/$queueTotalCount] starting ${item.filename} fileKey=${item.fileKey} source=${item.source} size=${item.fileSize}",
    )
    uploadStore.updateStatus(item.fileKey, "uploading", isoNow())
    emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
    emitEvent(
      "onSyncStateChanged",
      buildActiveSyncSummary(
        binding = binding,
        item = item,
        sessionId = sessionId,
        completedCount = completedCount,
        totalCount = queueTotalCount,
        completedBytes = completedBytes,
        totalBytes = totalBytes,
        currentOffset = item.ackedOffset,
      ),
    )

    val initPayload = JSONObject().apply {
      put("sessionId", sessionId)
      put("fileKey", item.fileKey)
      put("originalFilename", item.filename)
      put("mediaType", item.mediaType)
      put("mimeType", item.mimeType)
      put("fileSize", item.fileSize)
      put("createdAt", item.createdAt)
      put("modifiedAt", item.modifiedAt)
      put("queueIndex", queueIndex)
      put("queueTotalCount", queueTotalCount)
    }
    val initResponse = sendAndRead(connection, TYPE_FILE_INIT_REQ, initPayload, TYPE_FILE_INIT_RES)
    when (val action = initResponse.optString("action", "REJECT")) {
      "SKIP" -> {
        recordNativeLog("SyncUpload", "[${queueIndex + 1}/$queueTotalCount] SKIP ${item.filename}")
        completeUploadedItem(item, binding, activeTransmissionMs = 0)
        return true
      }
      "REJECT" -> {
        val reason = initResponse.optString("reason")
        recordNativeLog(
          "SyncUpload",
          "[${queueIndex + 1}/$queueTotalCount] REJECT ${item.filename} reason=${reason.ifBlank { "<empty>" }}",
          Log.WARN,
        )
        uploadStore.updateStatus(
          item.fileKey,
          if (reason == "LOW_DISK_PAUSED" || reason == "STORAGE_UNAVAILABLE") "queued" else "skipped",
          isoNow(),
        )
        return false
      }
      "UPLOAD", "RESUME" -> {
        val startOffset = if (action == "RESUME") initResponse.optLong("resumeOffset", item.ackedOffset) else 0L
        recordNativeLog(
          "SyncUpload",
          "[${queueIndex + 1}/$queueTotalCount] $action ${item.filename} offset=$startOffset",
        )
        streamFileData(
          connection = connection,
          binding = binding,
          sessionId = sessionId,
          item = item,
          startOffset = startOffset,
          roundReason = roundReason,
          completedCount = completedCount,
          queueTotalCount = queueTotalCount,
          completedBytes = completedBytes,
          totalBytes = totalBytes,
        )
      }
      else -> throw IllegalStateException("Unknown FILE_INIT action: $action")
    }

    writeJsonFrame(
      connection.output,
      TYPE_FILE_END_REQ,
      JSONObject().apply {
        put("fileKey", item.fileKey)
        put("fileSize", item.fileSize)
        put("sha256", "")
      },
    )
    var endFrame = readJsonFrameAny(connection.input)
    var drainCount = 0
    while (endFrame.type != TYPE_FILE_END_RES && endFrame.type != TYPE_ERROR && drainCount < 8) {
      endFrame = readJsonFrameAny(connection.input)
      drainCount += 1
    }
    if (endFrame.type == TYPE_ERROR) {
      throw IllegalStateException(endFrame.payload.optString("message", "Desktop returned protocol error"))
    }
    if (endFrame.type != TYPE_FILE_END_RES || !endFrame.payload.optBoolean("ok", true)) {
      recordNativeLog("SyncUpload", "[${queueIndex + 1}/$queueTotalCount] FILE_END not ok for ${item.filename}", Log.WARN)
      uploadStore.updateStatus(item.fileKey, "failed", isoNow())
      return false
    }
    completeUploadedItem(
      item = item,
      binding = binding,
      activeTransmissionMs = endFrame.payload.optLong("activeTransmissionMs", 0),
      ledgerDate = endFrame.payload.optString("ledgerDate"),
      storedBytes = endFrame.payload.optLong("storedBytes", item.fileSize),
    )
    recordNativeLog(
      "SyncUpload",
      "[${queueIndex + 1}/$queueTotalCount] completed ${item.filename} storedBytes=${endFrame.payload.optLong("storedBytes", item.fileSize)}",
      Log.INFO,
    )
    return true
  }

  private fun streamFileData(
    connection: ProtocolConnection,
    binding: StoredBinding,
    sessionId: String,
    item: AndroidUploadItem,
    startOffset: Long,
    roundReason: String,
    completedCount: Int,
    queueTotalCount: Int,
    completedBytes: Long,
    totalBytes: Long,
  ) {
    mediaStoreRepository.openInputStream(item).use { rawInput ->
      if (rawInput == null) {
        recordNativeLog("SyncUpload", "open asset failed fileKey=${item.fileKey}", Log.ERROR)
        throw IllegalStateException("Unable to open Android media asset")
      }
      var skipped = 0L
      while (skipped < startOffset) {
        val delta = rawInput.skip(startOffset - skipped)
        if (delta <= 0) {
          break
        }
        skipped += delta
      }

      val buffer = ByteArray(FILE_CHUNK_SIZE)
      var offset = startOffset
      var speedLastTransferredBytes = completedBytes + startOffset
      var speedLastCheckElapsedMs = SystemClock.elapsedRealtime()
      var currentSpeedMbps = 0.0
      while (offset < item.fileSize) {
        if (foregroundSyncStopRequested) {
          uploadStore.updateStatus(item.fileKey, "queued", isoNow())
          uploadStore.updateOffset(item.fileKey, offset, isoNow())
          recordDiagnosticsLog(
            "BackgroundSync",
            "current item stopped by notification action fileKey=${item.fileKey} ackedOffset=$offset",
          )
          throw ForegroundSyncStoppedException()
        }
        val currentAutoState = loadAutoUploadConfig().state
        if (!AndroidSyncPrimitives.shouldContinueAutoUploadRound(roundReason, item.source, currentAutoState)) {
          uploadStore.updateStatus(item.fileKey, "cancelled", isoNow())
          recordDiagnosticsLog(
            "AutoUpload",
            "current item stopped autoState=$currentAutoState fileKey=${item.fileKey} ackedOffset=$offset",
          )
          throw AutoUploadRoundStoppedException(currentAutoState)
        }
        val read = rawInput.read(buffer, 0, minOf(buffer.size.toLong(), item.fileSize - offset).toInt())
        if (read <= 0) {
          break
        }
        writeFileDataFrame(connection.output, item.fileKey, offset, buffer, read)
        offset += read
        val frame = readJsonFrameAny(connection.input)
        if (frame.type == TYPE_ERROR) {
          throw IllegalStateException(frame.payload.optString("message", "Desktop returned protocol error"))
        }
        if (frame.type == TYPE_FILE_ACK) {
          val committedOffset = frame.payload.optLong("committedOffset", offset)
          uploadStore.updateOffset(item.fileKey, committedOffset, isoNow())
          val nowElapsedMs = SystemClock.elapsedRealtime()
          val transferredBytes = completedBytes + committedOffset
          val elapsedMs = nowElapsedMs - speedLastCheckElapsedMs
          if (elapsedMs >= SPEED_SAMPLE_INTERVAL_MS) {
            currentSpeedMbps = AndroidSyncPrimitives.computeTransferSpeedMbps(
              bytesDelta = transferredBytes - speedLastTransferredBytes,
              elapsedMs = elapsedMs,
            )
            speedLastTransferredBytes = transferredBytes
            speedLastCheckElapsedMs = nowElapsedMs
          }
          emitEvent(
            "onSyncStateChanged",
            buildActiveSyncSummary(
              binding = binding,
              item = item,
              sessionId = sessionId,
              completedCount = completedCount,
              totalCount = queueTotalCount,
              completedBytes = completedBytes,
              totalBytes = totalBytes,
              currentOffset = committedOffset,
              currentSpeedMbps = currentSpeedMbps,
            ),
          )
        }
      }
      if (offset < item.fileSize) {
        recordNativeLog("SyncUpload", "FILE_DATA stream incomplete fileKey=${item.fileKey} offset=$offset size=${item.fileSize}", Log.ERROR)
        throw IllegalStateException("FILE_DATA stream incomplete: $offset/${item.fileSize}")
      }
    }
  }

  private fun completeUploadedItem(
    item: AndroidUploadItem,
    binding: StoredBinding,
    activeTransmissionMs: Long,
    ledgerDate: String = localLedgerDateKey(),
    storedBytes: Long = item.fileSize,
  ) {
    val now = isoNow()
    uploadStore.updateOffset(item.fileKey, storedBytes, now)
    uploadStore.updateStatus(item.fileKey, "completed", now)
    uploadStore.upsertLedger(
      AndroidHistoryLedger(
        ledgerDate = ledgerDate.takeIf { it.isNotBlank() } ?: localLedgerDateKey(),
        deviceId = binding.deviceId,
        deviceName = binding.deviceAlias.ifBlank { binding.deviceName },
        deviceIp = binding.host,
        fileCount = 1,
        totalBytes = storedBytes,
        activeTransmissionMs = activeTransmissionMs,
        updatedAt = now,
      ),
    )
    recordNativeLog(
      "SyncUpload",
      "ledger updated fileKey=${item.fileKey} ledgerDate=${ledgerDate.takeIf { it.isNotBlank() } ?: localLedgerDateKey()} bytes=$storedBytes",
    )
    emitQueueUpdated(uploadStore.queueToWritableArray(uploadStore.getPendingItems(limit = 100)))
    emitEvent("onHistoryUpdated", null)
  }

  private fun sendAndRead(
    connection: ProtocolConnection,
    requestType: Int,
    payload: JSONObject,
    expectedResponseType: Int,
  ): JSONObject {
    writeJsonFrame(connection.output, requestType, payload)
    return readJsonFrame(connection.input, expectedResponseType)
  }

  private fun buildActiveSyncSummary(
    binding: StoredBinding,
    item: AndroidUploadItem,
    sessionId: String,
    completedCount: Int,
    totalCount: Int,
    completedBytes: Long,
    totalBytes: Long,
    currentOffset: Long,
    currentSpeedMbps: Double = 0.0,
  ): WritableMap {
    val pendingItems = uploadStore.getPendingItems(limit = 10_000)
    val autoConfig = loadAutoUploadConfig()
    return AndroidSyncPrimitives.buildSyncOverviewFields(
      AndroidSyncOverviewInput(
        currentDeviceId = binding.deviceId,
        currentDeviceName = binding.deviceAlias.ifBlank { binding.deviceName },
        uploadState = "uploading",
        sessionId = sessionId,
        completedCount = completedCount,
        totalCount = totalCount,
        completedBytes = completedBytes,
        totalBytes = totalBytes,
        currentFileKey = item.fileKey,
        currentFilename = item.filename,
        currentFileConfirmedBytes = currentOffset,
        currentFileTotalBytes = item.fileSize,
        currentSpeedMbps = currentSpeedMbps,
        activeTuningProfile = "standard",
        currentTaskSource = item.source,
        autoUploadState = autoConfig.state,
        manualPending = AndroidSyncPrimitives.pendingCount(pendingItems, "manual"),
        autoPending = AndroidSyncPrimitives.pendingCount(pendingItems, "auto"),
      ),
    ).toWritableMap()
  }

  private fun writeJsonFrame(
    output: DataOutputStream,
    type: Int,
    payload: JSONObject,
  ) {
    val body = payload.toString().toByteArray(StandardCharsets.UTF_8)
    val header = ByteBuffer.allocate(HEADER_SIZE)
      .order(ByteOrder.BIG_ENDIAN)
      .put(MAGIC_BYTES)
      .putShort(PROTOCOL_VERSION.toShort())
      .putShort(type.toShort())
      .putInt(body.size)
      .array()
    output.write(header)
    output.write(body)
    output.flush()
  }

  private fun readJsonFrame(
    input: DataInputStream,
    expectedType: Int,
    structuredErrors: Boolean = false,
  ): JSONObject {
    val frame = readJsonFrameAny(input)
    if (frame.type == TYPE_ERROR) {
      val errorCode = structuredErrorCode(frame.payload.optString("code"))
      if (structuredErrors && errorCode != null) {
        throw structuredNativeError(
          code = errorCode,
          rawMessage = frame.payload.optString("message", "Desktop returned protocol error"),
          meta = frame.payload.optJSONObject("meta"),
        )
      }
      throw IllegalStateException(frame.payload.optString("message", "Desktop returned protocol error"))
    }
    if (frame.type != expectedType) {
      throw IllegalStateException("Unexpected frame type: ${frame.type}")
    }
    return frame.payload
  }

  private fun structuredErrorCode(rawCode: String?): String? {
    val code = rawCode?.trim().orEmpty()
    return code.takeIf { it in STRUCTURED_PAIRING_ERROR_CODES }
  }

  private fun defaultStructuredErrorMessage(code: String): String = when (code) {
    "PAIRING_CODE_INVALID" -> "連接碼錯誤，請重新輸入"
    "PAIRING_CLIENT_BLOCKED" -> "這支手機已被此電腦封鎖，請在桌面端設定解除封鎖後再試。"
    "PAIR_TOKEN_INVALID" -> "連線授權已失效，請重新輸入桌面端連接碼。"
    "APP_VERSION_INCOMPATIBLE" -> "手機與桌面 App 版本不相容，請同時更新兩端後再連線。"
    else -> "Pairing rejected"
  }

  private fun structuredNativeError(
    code: String,
    rawMessage: String,
    meta: JSONObject?,
  ): NativeStructuredError {
    val message = rawMessage.trim().ifBlank { defaultStructuredErrorMessage(code) }
    return NativeStructuredError(
      nativeCode = code,
      message = message,
      userInfo = pairingErrorUserInfo(meta),
    )
  }

  private fun pairingErrorUserInfo(meta: JSONObject?): WritableMap {
    val userInfo = Arguments.createMap()
    if (meta == null) {
      return userInfo
    }
    for (key in listOf("failedAttempts", "remainingAttempts", "maxAttempts")) {
      if (meta.has(key) && !meta.isNull(key)) {
        userInfo.putInt(key, meta.optInt(key))
      }
    }
    return userInfo
  }

  private fun readJsonFrameAny(input: DataInputStream): JsonFrame {
    val headerBytes = ByteArray(HEADER_SIZE)
    input.readFully(headerBytes)
    val header = ByteBuffer.wrap(headerBytes).order(ByteOrder.BIG_ENDIAN)

    val magic = ByteArray(MAGIC_BYTES.size)
    header.get(magic)
    if (!magic.contentEquals(MAGIC_BYTES)) {
      throw IllegalStateException("Invalid LMUP magic")
    }

    val version = header.short.toInt()
    if (version != PROTOCOL_VERSION) {
      throw IllegalStateException("Unsupported LMUP version: $version")
    }

    val actualType = header.short.toInt()

    val bodyLength = header.int
    if (bodyLength < 0 || bodyLength > MAX_BODY_LENGTH) {
      throw IllegalStateException("Invalid frame size: $bodyLength")
    }

    if (bodyLength == 0) {
      return JsonFrame(actualType, JSONObject())
    }

    val body = ByteArray(bodyLength)
    input.readFully(body)
    return JsonFrame(actualType, JSONObject(String(body, StandardCharsets.UTF_8)))
  }

  private fun writeFileDataFrame(
    output: DataOutputStream,
    fileKey: String,
    offset: Long,
    buffer: ByteArray,
    length: Int,
  ) {
    val keyBytes = fileKey.toByteArray(StandardCharsets.UTF_8)
    val bodyLength = 2 + keyBytes.size + 8 + length
    val header = ByteBuffer.allocate(HEADER_SIZE)
      .order(ByteOrder.BIG_ENDIAN)
      .put(MAGIC_BYTES)
      .putShort(PROTOCOL_VERSION.toShort())
      .putShort(TYPE_FILE_DATA.toShort())
      .putInt(bodyLength)
      .array()
    output.write(header)
    output.writeShort(keyBytes.size)
    output.write(keyBytes)
    output.writeLong(offset)
    output.write(buffer, 0, length)
    output.flush()
  }

  private fun fetchSharedDirectory(scope: String, path: String, requestAccessToken: String): WritableMap {
    var route = resolveSharedFileRoute(
      scope = scope,
      kind = "list",
      path = path,
      requestAccessToken = requestAccessToken,
      reason = "browse_shared_files",
    )
    logSharedFileRoute("browseSharedFiles", route)
    val json = try {
      JSONObject(readHttpString(route))
    } catch (err: Throwable) {
      if (!AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(route.isTunnel)) {
        throw err
      }
      route = recoverSharedFileTunnelAfterRouteFailure(
        scope = scope,
        kind = "list",
        path = path,
        requestAccessToken = requestAccessToken,
        reason = "browse_shared_files",
        error = err,
      )
      logSharedFileRoute("browseSharedFiles", route, retry = true)
      JSONObject(readHttpString(route))
    }
    updateSharedFilesReachability(
      state = "available",
      route = route,
      reason = "browse_shared_files_success",
    )
    val files = Arguments.createArray()
    val sourceFiles = json.optJSONArray("files") ?: JSONArray()
    for (index in 0 until sourceFiles.length()) {
      val source = sourceFiles.optJSONObject(index) ?: continue
      val filePath = source.optString("path")
      val fileType = source.optString("type").ifBlank { "other" }
      files.pushMap(Arguments.createMap().apply {
        putString("name", source.optString("name"))
        putString("path", filePath)
        putString("type", fileType)
        putDouble("size", source.optLong("size", 0).toDouble())
        putString("modifiedAt", source.optString("modifiedAt"))
        putBoolean("isDirectory", source.optBoolean("isDirectory", false))
        if (fileType == "image") {
          putString("thumbnailUrl", sharedFileUrlForRoute("thumbnail", filePath, route).toString())
        }
        if (fileType == "video") {
          putString("streamUrl", sharedFileUrlForRoute("stream", filePath, route).toString())
        }
      })
    }
    return Arguments.createMap().apply {
      putString("scope", route.scope)
      putString("path", json.optString("path", path))
      putArray("files", files)
      putInt("totalCount", json.optInt("totalCount", sourceFiles.length()))
    }
  }

  private fun fetchReceivedFiles(): WritableArray {
    var route = receivedListRoute(
      resolveSharedFileRoute(
        scope = "team",
        kind = "list",
        path = "received",
        requestAccessToken = "",
        reason = "list_received_files",
      ),
    )
    logSharedFileRoute("listReceivedFiles", route)
    val json = try {
      JSONObject(readHttpString(route))
    } catch (err: Throwable) {
      if (!AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(route.isTunnel)) {
        throw err
      }
      route = receivedListRoute(
        recoverSharedFileTunnelAfterRouteFailure(
          scope = "team",
          kind = "list",
          path = "received",
          requestAccessToken = "",
          reason = "list_received_files",
          error = err,
        ),
      )
      logSharedFileRoute("listReceivedFiles", route, retry = true)
      JSONObject(readHttpString(route))
    }
    updateSharedFilesReachability(
      state = "available",
      route = route,
      reason = "list_received_files_success",
    )

    val items = Arguments.createArray()
    val sourceItems = json.optJSONArray("items") ?: JSONArray()
    for (index in 0 until sourceItems.length()) {
      val source = sourceItems.optJSONObject(index) ?: continue
      val fileKey = source.optString("fileKey")
      val filename = source.optString("filename").ifBlank { source.optString("displayName") }
      val mediaType = source.optString("mediaType")
      items.pushMap(Arguments.createMap().apply {
        putString("resourceId", source.optString("resourceId"))
        putString("desktopDeviceId", source.optString("desktopDeviceId"))
        putString("clientId", source.optString("clientId"))
        putString("displayName", source.optString("displayName"))
        putString("fileKey", fileKey)
        putString("filename", source.optString("filename"))
        putString("mediaType", mediaType)
        putDouble("fileSize", source.optLong("fileSize", 0L).toDouble())
        putString("completedAt", source.optString("completedAt"))
        putString("shareStatus", source.optString("shareStatus").ifBlank { "not_shared" })
        if (fileKey.isNotBlank() && isReceivedImage(mediaType, filename)) {
          putString("previewUrl", receivedFileUrlForRoute(fileKey, route, "preview").toString())
          putString("thumbnailUrl", receivedFileUrlForRoute(fileKey, route, "thumbnail").toString())
        }
        if (fileKey.isNotBlank() && isReceivedVideo(mediaType, filename)) {
          putString("previewUrl", receivedFileUrlForRoute(fileKey, route, "preview").toString())
          putString("streamUrl", receivedFileUrlForRoute(fileKey, route, "stream").toString())
        }
      })
    }
    return items
  }

  private fun downloadSharedFileToLocalStorage(scope: String, path: String, requestAccessToken: String): WritableMap {
    recordNativeLog("SharedFiles", "downloadSharedFile resolving route scope=$scope path=$path")
    var route = resolveSharedFileRoute(
      scope = scope,
      kind = "download",
      path = path,
      requestAccessToken = requestAccessToken,
      reason = "download_shared_file",
    )
    logSharedFileRoute("downloadSharedFile", route)
    return try {
      downloadSharedFileFromRoute(path, route).also {
        logSharedFileDownloadResult("downloadSharedFile", path, it, route)
        updateSharedFilesReachability(
          state = "available",
          route = route,
          reason = "download_shared_file_success",
        )
      }
    } catch (err: Throwable) {
      if (!AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(route.isTunnel)) {
        recordNativeLog(
          "SharedFiles",
          "downloadSharedFile failed path=$path is_tunnel=${route.isTunnel} retry=false error=${err.message ?: err::class.java.simpleName}",
          Log.WARN,
        )
        throw err
      }
      route = recoverSharedFileTunnelAfterRouteFailure(
        scope = scope,
        kind = "download",
        path = path,
        requestAccessToken = requestAccessToken,
        reason = "download_shared_file",
        error = err,
      )
      logSharedFileRoute("downloadSharedFile", route, retry = true)
      downloadSharedFileFromRoute(path, route).also {
        logSharedFileDownloadResult("downloadSharedFile", path, it, route, retry = true)
        updateSharedFilesReachability(
          state = "available",
          route = route,
          reason = "download_shared_file_success",
        )
      }
    }
  }

  private fun downloadReceivedFileToLocalStorage(
    fileKey: String,
    filename: String,
    requestedMediaType: String?,
  ): WritableMap {
    val normalizedFileKey = fileKey.trim()
    require(normalizedFileKey.isNotBlank()) { "Received file key is required" }
    val safeFilename = safeShareCacheFilename(filename, normalizedFileKey.substringAfterLast('/').ifBlank { "remote-file" })
    recordNativeLog(
      "SharedFiles",
      "downloadReceivedFile resolving route fileKey=$normalizedFileKey filename=$safeFilename media_type=${requestedMediaType ?: "nil"}",
    )
    var route = resolveSharedFileRoute(
      scope = "team",
      kind = "download",
      path = normalizedFileKey,
      requestAccessToken = "",
      reason = "download_received_file",
    )
    logSharedFileRoute("downloadReceivedFile", route)
    return try {
      downloadReceivedFileFromRoute(normalizedFileKey, safeFilename, requestedMediaType, route).also {
        logSharedFileDownloadResult("downloadReceivedFile", normalizedFileKey, it, route)
        updateSharedFilesReachability(
          state = "available",
          route = route,
          reason = "download_received_file_success",
        )
      }
    } catch (err: Throwable) {
      if (!AndroidSyncPrimitives.shouldRetrySharedFilesRouteAfterFailure(route.isTunnel)) {
        recordNativeLog(
          "SharedFiles",
          "downloadReceivedFile failed fileKey=$normalizedFileKey is_tunnel=${route.isTunnel} retry=false error=${err.message ?: err::class.java.simpleName}",
          Log.WARN,
        )
        throw err
      }
      route = recoverSharedFileTunnelAfterRouteFailure(
        scope = "team",
        kind = "download",
        path = normalizedFileKey,
        requestAccessToken = "",
        reason = "download_received_file",
        error = err,
      )
      logSharedFileRoute("downloadReceivedFile", route, retry = true)
      downloadReceivedFileFromRoute(normalizedFileKey, safeFilename, requestedMediaType, route).also {
        logSharedFileDownloadResult("downloadReceivedFile", normalizedFileKey, it, route, retry = true)
        updateSharedFilesReachability(
          state = "available",
          route = route,
          reason = "download_received_file_success",
        )
      }
    }
  }

  private fun downloadReceivedFileFromRoute(
    fileKey: String,
    filename: String,
    requestedMediaType: String?,
    route: SharedFileRoute,
  ): WritableMap {
    val connection = receivedFileUrlForRoute(fileKey, route).openConnection() as HttpURLConnection
    try {
      recordNativeLog(
        "SharedFiles",
        "downloadReceivedFile HTTP request fileKey=$fileKey filename=$filename is_tunnel=${route.isTunnel}",
      )
      connection.requestMethod = "GET"
      connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
      connection.readTimeout = SHARED_DOWNLOAD_TIMEOUT_MS
      return persistHttpDownloadToLocalStorage(
        connection = connection,
        filename = filename,
        requestedMediaType = requestedMediaType,
        progressKey = fileKey,
        exposeDownloadsUri = true,
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun downloadSharedFileFromRoute(path: String, route: SharedFileRoute): WritableMap {
    val filename = path.substringAfterLast('/').ifBlank { "shared-file" }
    val mediaType = AndroidSyncPrimitives.classifyMediaType(
      AndroidSyncPrimitives.mimeTypeForFilename(filename),
      filename,
    )
    val connection = route.url.openConnection() as HttpURLConnection
    try {
      recordNativeLog(
        "SharedFiles",
        "downloadSharedFile HTTP request path=$path filename=$filename media_type=$mediaType is_tunnel=${route.isTunnel}",
      )
      connection.requestMethod = "GET"
      connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
      connection.readTimeout = SHARED_DOWNLOAD_TIMEOUT_MS
      applySharedDirectoryAuthorization(connection, route)
      return persistHttpDownloadToLocalStorage(
        connection = connection,
        filename = filename,
        requestedMediaType = mediaType,
        progressKey = path,
        exposeDownloadsUri = false,
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun downloadSharedFilePreviewFromRoute(path: String, filename: String, route: SharedFileRoute): String {
    val fallbackName = path.substringAfterLast('/').ifBlank { "shared-file" }
    val safeFilename = safeShareCacheFilename(filename, fallbackName)
    val connection = route.url.openConnection() as HttpURLConnection
    try {
      recordNativeLog(
        "SharedFiles",
        "prepareSharedFilePreview HTTP request path=$path filename=$safeFilename is_tunnel=${route.isTunnel}",
      )
      connection.requestMethod = "GET"
      connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
      connection.readTimeout = SHARED_DOWNLOAD_TIMEOUT_MS
      applySharedDirectoryAuthorization(connection, route)
      val statusCode = connection.responseCode
      val totalBytes = connection.contentLengthLong.takeIf { it > 0L } ?: 0L
      recordNativeLog(
        "SharedFiles",
        "prepareSharedFilePreview HTTP response path=$path status=$statusCode content_type=${connection.contentType ?: "nil"} content_length=${connection.contentLengthLong}",
      )
      if (statusCode !in 200..299) {
        throw IllegalStateException("Sidecar returned HTTP $statusCode")
      }
      val destDir = File(reactApplicationContext.cacheDir, "syncflow_shared_previews")
      if (!destDir.exists()) {
        destDir.mkdirs()
      }
      val destFile = uniqueShareCacheFile(destDir, safeFilename)
      BufferedOutputStream(destFile.outputStream()).use { output ->
        BufferedInputStream(connection.inputStream).use { input ->
          copySharedDownloadWithProgress(path, input, output, totalBytes)
        }
      }
      recordNativeLog(
        "SharedFiles",
        "prepareSharedFilePreview cached path=$path filename=${destFile.name} local_path=${destFile.absolutePath} bytes=${destFile.length()}",
      )
      return destFile.absolutePath
    } finally {
      connection.disconnect()
    }
  }

  private fun persistHttpDownloadToLocalStorage(
    connection: HttpURLConnection,
    filename: String,
    requestedMediaType: String?,
    progressKey: String,
    exposeDownloadsUri: Boolean,
  ): WritableMap {
    val safeFilename = safeShareCacheFilename(filename, "remote-file")
    val mediaType = localDownloadMediaType(safeFilename, requestedMediaType)
    val statusCode = connection.responseCode
    recordNativeLog(
      "SharedFiles",
      "persistHttpDownload response filename=$safeFilename progress_key=$progressKey status=$statusCode media_type=$mediaType content_type=${connection.contentType ?: "nil"} content_length=${connection.contentLengthLong} expose_downloads_uri=$exposeDownloadsUri",
    )
    if (statusCode !in 200..299) {
      throw IllegalStateException("Sidecar returned HTTP $statusCode")
    }
    val mimeType = connection.contentType?.substringBefore(';')
      ?: AndroidSyncPrimitives.mimeTypeForFilename(safeFilename)
    val totalBytes = connection.contentLengthLong.takeIf { it > 0L } ?: 0L
    if (mediaType == "image" || mediaType == "video") {
      val collection = if (mediaType == "video") {
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      } else {
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      }
      val savedLocation = if (mediaType == "video") {
        "${Environment.DIRECTORY_MOVIES}/Vivi Drop"
      } else {
        "${Environment.DIRECTORY_PICTURES}/Vivi Drop"
      }
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(
            MediaStore.MediaColumns.RELATIVE_PATH,
            savedLocation,
          )
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      }
      val uri = reactApplicationContext.contentResolver.insert(collection, values)
        ?: throw IllegalStateException("Unable to create MediaStore item")
      reactApplicationContext.contentResolver.openOutputStream(uri)?.use { output ->
        connection.inputStream.use { input ->
          copySharedDownloadWithProgress(progressKey, input, output, totalBytes)
        }
      } ?: throw IllegalStateException("Unable to write MediaStore item")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        reactApplicationContext.contentResolver.update(uri, values, null, null)
      }
      recordNativeLog(
        "SharedFiles",
        "persistHttpDownload saved_to_photos filename=$safeFilename media_type=$mediaType saved_location=$savedLocation uri=$uri",
      )
      return Arguments.createMap().apply {
        putBoolean("savedToPhotos", true)
        putNull("localPath")
        putString("savedLocation", savedLocation)
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
      val savedLocation = "${Environment.DIRECTORY_DOWNLOADS}/Vivi Drop"
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, savedLocation)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val uri = reactApplicationContext.contentResolver.insert(collection, values)
        ?: throw IllegalStateException("Unable to create MediaStore item")
      reactApplicationContext.contentResolver.openOutputStream(uri)?.use { output ->
        connection.inputStream.use { input ->
          copySharedDownloadWithProgress(progressKey, input, output, totalBytes)
        }
      } ?: throw IllegalStateException("Unable to write MediaStore item")
      values.clear()
      values.put(MediaStore.MediaColumns.IS_PENDING, 0)
      reactApplicationContext.contentResolver.update(uri, values, null, null)
      recordNativeLog(
        "SharedFiles",
        "persistHttpDownload saved_to_downloads filename=$safeFilename saved_location=$savedLocation local_path=${if (exposeDownloadsUri) uri.toString() else "hidden"} expose_downloads_uri=$exposeDownloadsUri",
      )
      return Arguments.createMap().apply {
        putBoolean("savedToPhotos", false)
        if (exposeDownloadsUri) {
          putString("localPath", uri.toString())
          putString("savedLocation", savedLocation)
        } else {
          putNull("localPath")
          putNull("savedLocation")
        }
      }
    }

    val destDir = File(
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
      "Vivi Drop"
    )
    if (!destDir.exists()) {
      destDir.mkdirs()
    }
    val destFile = uniqueShareCacheFile(destDir, safeFilename)
    destFile.outputStream().use { output ->
      connection.inputStream.use { input ->
        copySharedDownloadWithProgress(progressKey, input, output, totalBytes)
      }
    }
    recordNativeLog(
      "SharedFiles",
      "persistHttpDownload saved_to_downloads filename=$safeFilename saved_location=${Environment.DIRECTORY_DOWNLOADS}/Vivi Drop local_path=${destFile.absolutePath}",
    )
    return Arguments.createMap().apply {
      putBoolean("savedToPhotos", false)
      putString("localPath", destFile.absolutePath)
      putString("savedLocation", "${Environment.DIRECTORY_DOWNLOADS}/Vivi Drop")
    }
  }

  private fun copySharedDownloadWithProgress(
    path: String,
    input: java.io.InputStream,
    output: OutputStream,
    totalBytes: Long,
  ) {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var bytesWritten = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      output.write(buffer, 0, read)
      bytesWritten += read.toLong()
      emitSharedFileDownloadProgress(path, bytesWritten, totalBytes)
    }
    output.flush()
    emitSharedFileDownloadProgress(path, bytesWritten, totalBytes, forceComplete = true)
  }

  private fun emitSharedFileDownloadProgress(
    path: String,
    bytesWritten: Long,
    totalBytes: Long,
    forceComplete: Boolean = false,
  ) {
    val progress = when {
      forceComplete -> 1.0
      totalBytes > 0L -> (bytesWritten.toDouble() / totalBytes.toDouble()).coerceIn(0.0, 1.0)
      else -> 0.0
    }
    emitEvent(
      "onSharedFileDownloadProgress",
      Arguments.createMap().apply {
        putString("path", path)
        putDouble("bytesWritten", bytesWritten.toDouble())
        putDouble("totalBytes", totalBytes.toDouble())
        putDouble("progress", progress)
      },
    )
  }

  private fun readHttpString(route: SharedFileRoute): String {
    val connection = route.url.openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
      connection.readTimeout = SHARED_HTTP_TIMEOUT_MS
      applySharedDirectoryAuthorization(connection, route)
      val statusCode = connection.responseCode
      val body = readResponseBody(connection, statusCode)
      if (statusCode !in 200..299) {
        throw IllegalStateException(body.ifBlank { "Sidecar returned HTTP $statusCode" })
      }
      return body
    } finally {
      connection.disconnect()
    }
  }

  private fun startP2PTunnelIfNeeded(binding: StoredBinding) {
    val clientId = getOrCreateClientId()
    val targetClientId = binding.deviceId
    val pairingToken = binding.pairingToken

    val startSnapshot = synchronized(p2pTunnelLock) {
      val currentSignalingUrl = signalingUrl
      val currentAccessToken = accessToken
      if (currentSignalingUrl.isNullOrBlank() || currentAccessToken.isNullOrBlank()) {
        recordNativeLog("SyncEngine", "P2P tunnel skipped: credentials not set")
        return
      }
      if (isTunnelActive && tunnelPort != null) {
        return
      }
      if (tunnelStarting) {
        return
      }
      tunnelStarting = true
      P2PTunnelStartSnapshot(
        generation = tunnelGeneration,
        signalingUrl = currentSignalingUrl,
        accessToken = currentAccessToken,
        iceServersJSON = tunnelIceServersJSON,
      )
    }

    p2pTunnelExecutor.execute {
      try {
        recordNativeLog("SyncEngine", "P2P tunnel starting target=$targetClientId")
        val port = Mobiletunnel.startTunnel(
          startSnapshot.signalingUrl,
          clientId,
          targetClientId,
          startSnapshot.accessToken,
          pairingToken,
          startSnapshot.iceServersJSON,
        ).toInt()
        var logMessage: String? = null
        var shouldStopStaleTunnel = false
        synchronized(p2pTunnelLock) {
          val shouldCommit = tunnelGeneration == startSnapshot.generation &&
            signalingUrl == startSnapshot.signalingUrl &&
            accessToken == startSnapshot.accessToken &&
            tunnelIceServersJSON == startSnapshot.iceServersJSON
          if (shouldCommit && port > 0) {
            tunnelPort = port
            isTunnelActive = true
            tunnelStarting = false
            logMessage = "P2P tunnel active on local port $port"
          } else if (shouldCommit) {
            tunnelPort = null
            isTunnelActive = false
            tunnelStarting = false
            logMessage = "P2P tunnel failed to start, fallback to direct LAN"
          } else if (port > 0) {
            shouldStopStaleTunnel = true
          }
        }
        if (shouldStopStaleTunnel) {
          Mobiletunnel.stopTunnel()
        }
        if (logMessage != null) {
          recordNativeLog("SyncEngine", logMessage)
        }
      } catch (err: Throwable) {
        var shouldLog = false
        synchronized(p2pTunnelLock) {
          val shouldCommit = tunnelGeneration == startSnapshot.generation &&
            signalingUrl == startSnapshot.signalingUrl &&
            accessToken == startSnapshot.accessToken &&
            tunnelIceServersJSON == startSnapshot.iceServersJSON
          if (shouldCommit) {
            tunnelPort = null
            isTunnelActive = false
            tunnelStarting = false
            shouldLog = true
          }
        }
        if (shouldLog) {
          recordNativeLog(
            "SyncEngine",
            "P2P tunnel start failed: ${err.message ?: err.javaClass.simpleName}",
          )
        }
      }
    }
  }

  private fun stopP2PTunnel() {
    synchronized(p2pTunnelLock) {
      tunnelGeneration += 1
      tunnelPort = null
      isTunnelActive = false
      tunnelStarting = false
    }

    p2pTunnelExecutor.execute {
      try {
        Mobiletunnel.stopTunnel()
      } catch (err: Throwable) {
        recordNativeLog(
          "SyncEngine",
          "P2P tunnel stop failed: ${err.message ?: err.javaClass.simpleName}",
        )
      }
    }
  }

  private fun resolveSharedFileRoute(
    scope: String,
    kind: String,
    path: String,
    requestAccessToken: String,
    reason: String,
    waitForTunnel: Boolean = true,
  ): SharedFileRoute {
    val binding = loadBinding() ?: throw IllegalStateException("No bound desktop")
    val shouldAttemptWake = AndroidSyncPrimitives.shouldAttemptSharedFilesWake(
      scope = scope,
      path = path,
      operation = kind,
    )
    recordNativeLog(
      "SharedFiles",
      "wake decision scope=$scope path=$path operation=$kind allowWake=$shouldAttemptWake ${wakeCapabilityLogSummary(binding.wake)}",
    )
    val wakeGateSnapshot = p2pTunnelRouteSnapshot()
    if (AndroidSyncPrimitives.shouldAttemptWakeBeforeP2PFallback(
        allowWake = shouldAttemptWake,
        hasActiveTunnel = wakeGateSnapshot.isActive && wakeGateSnapshot.port != null,
      )
    ) {
      val directSnapshot = wakeGateSnapshot
      val directDecision = AndroidSyncPrimitives.decideSharedFilesRoute(
        isTunnelActive = false,
        tunnelPort = null,
        hasTunnelCredentials = false,
        directHost = binding.host,
        directPort = DEFAULT_SIDECAR_HTTP_PORT,
      )
      if (canReachSidecarHealth(binding.host, BINDING_PROBE_TIMEOUT_MS)) {
        return sharedFileRoute(scope, kind, path, requestAccessToken, directDecision, directSnapshot)
      }

      if (directSnapshot.hasCredentials && !directSnapshot.isActive && !directSnapshot.isStarting) {
        recordNativeLog("SharedFiles", "starting P2P tunnel asynchronously during wake attempt reason=$reason")
        startP2PTunnelIfNeeded(binding)
      }

      val allowPublicWake = AndroidSyncPrimitives.shouldAllowSharedFilesPublicWake(
        scope = scope,
        path = path,
        operation = kind,
        trigger = "shared_files_root_browse",
      )
      val wokeHost = attemptSharedFilesLANWakeIfNeeded(binding, reason, allowPublicWake = allowPublicWake)
      if (wokeHost != null) {
        val isTunnel = wokeHost.startsWith("127.0.0.1")
        val finalDecision = if (isTunnel) {
          val portPart = wokeHost.substringAfterLast(":", "").toIntOrNull() ?: DEFAULT_SIDECAR_HTTP_PORT
          AndroidSharedFilesRouteDecision(
            mode = AndroidSharedFilesRouteMode.TUNNEL,
            host = "127.0.0.1",
            port = portPart,
            isTunnel = true,
          )
        } else {
          directDecision.copy(host = wokeHost)
        }
        return sharedFileRoute(
          scope,
          kind,
          path,
          requestAccessToken,
          finalDecision,
          directSnapshot,
        )
      }
      recordNativeLog(
        "SharedFiles",
        "LAN wake did not recover shared files host reason=$reason; falling back to route selection",
      )
    } else if (shouldAttemptWake && wakeGateSnapshot.isActive && wakeGateSnapshot.port != null) {
      val activeDecision = AndroidSyncPrimitives.decideSharedFilesRoute(
        isTunnelActive = true,
        tunnelPort = wakeGateSnapshot.port,
        hasTunnelCredentials = wakeGateSnapshot.hasCredentials,
        directHost = binding.host,
        directPort = DEFAULT_SIDECAR_HTTP_PORT,
      )
      recordNativeLog("SharedFiles", "using active P2P tunnel directly, skipping wake decision reason=$reason")
      return sharedFileRoute(scope, kind, path, requestAccessToken, activeDecision, wakeGateSnapshot)
    }
    val initialSnapshot = p2pTunnelRouteSnapshot()
    val initialDecision = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = initialSnapshot.isActive,
      tunnelPort = initialSnapshot.port,
      hasTunnelCredentials = initialSnapshot.hasCredentials,
      directHost = binding.host,
      directPort = DEFAULT_SIDECAR_HTTP_PORT,
    )

    when (initialDecision.mode) {
      AndroidSharedFilesRouteMode.TUNNEL -> {
        return sharedFileRoute(scope, kind, path, requestAccessToken, initialDecision, initialSnapshot)
      }

      AndroidSharedFilesRouteMode.DIRECT_LAN -> {
        recordNativeLog("SharedFiles", "P2P tunnel unavailable for shared files reason=$reason; credentials missing")
        return sharedFileRoute(scope, kind, path, requestAccessToken, initialDecision, initialSnapshot)
      }

      AndroidSharedFilesRouteMode.WAIT_FOR_TUNNEL -> {
        if (waitForTunnel && waitForP2PTunnelActive(binding, reason)) {
          val readySnapshot = p2pTunnelRouteSnapshot()
          val readyDecision = AndroidSyncPrimitives.decideSharedFilesRoute(
            isTunnelActive = readySnapshot.isActive,
            tunnelPort = readySnapshot.port,
            hasTunnelCredentials = readySnapshot.hasCredentials,
            directHost = binding.host,
            directPort = DEFAULT_SIDECAR_HTTP_PORT,
          )
          if (readyDecision.mode == AndroidSharedFilesRouteMode.TUNNEL) {
            return sharedFileRoute(scope, kind, path, requestAccessToken, readyDecision, readySnapshot)
          }
        }
      }
    }

    val fallbackSnapshot = p2pTunnelRouteSnapshot()
    val fallbackDecision = AndroidSyncPrimitives.decideSharedFilesRoute(
      isTunnelActive = false,
      tunnelPort = null,
      hasTunnelCredentials = false,
      directHost = binding.host,
      directPort = DEFAULT_SIDECAR_HTTP_PORT,
    )
    if (waitForTunnel) {
      recordNativeLog(
        "SharedFiles",
        "P2P tunnel wait timed out for shared files reason=$reason hasCredentials=${fallbackSnapshot.hasCredentials}",
      )
    }
    return sharedFileRoute(scope, kind, path, requestAccessToken, fallbackDecision, fallbackSnapshot)
  }

  private fun logPeerProxySkipDiagnostics() {
    val hasMultiDesktopBindingSource = false
    val hasOnlineVividropDesktopPeer = false
    if (!AndroidSyncPrimitives.shouldAttemptPeerProxyWake(
        hasMultiDesktopBindingSource = hasMultiDesktopBindingSource,
        hasOnlineVividropDesktopPeer = hasOnlineVividropDesktopPeer,
      )
    ) {
      AndroidSyncPrimitives.peerProxySkipReasons(
        hasMultiDesktopBindingSource = hasMultiDesktopBindingSource,
        hasOnlineVividropDesktopPeer = hasOnlineVividropDesktopPeer,
        hasThirdPartyHelperConfigured = false,
      ).forEach { skipReason ->
        recordDiagnosticsLog("SharedFiles", "peer proxy skipped reason=$skipReason")
      }
    }
  }

  private fun sharedFileRoute(
    scope: String,
    kind: String,
    path: String,
    requestAccessToken: String,
    decision: AndroidSharedFilesRouteDecision,
    snapshot: P2PTunnelRouteSnapshot,
  ): SharedFileRoute {
    val normalizedScope = normalizeSharedDirectoryScope(scope)
    val endpoint = sharedFileEndpoint(normalizedScope, kind, path)
    val displayHost = if (decision.isTunnel) "${decision.host}:${decision.port}" else decision.host
    val metadata = AndroidSyncPrimitives.sharedFilesRouteMetadata(
      decision = decision,
      snapshotTunnelActive = snapshot.isActive,
      snapshotTunnelStarting = snapshot.isStarting,
      snapshotTunnelPort = snapshot.port,
    )
    val authorizationToken = requestAccessToken.takeIf { normalizedScope == "personal" }?.trim()?.ifBlank { null }
    return SharedFileRoute(
      scope = normalizedScope,
      kind = kind,
      path = path,
      url = appendSharedDirectoryQueryParams(
        URL("http", decision.host, decision.port, endpoint),
        normalizedScope,
        authorizationToken,
      ),
      urlHost = decision.host,
      port = decision.port,
      authorizationToken = authorizationToken,
      displayHost = displayHost,
      isTunnel = decision.isTunnel,
      reachabilityRoute = if (decision.isTunnel) currentSharedFilesTunnelReachabilityRoute() else "lan",
      tunnelActive = metadata.tunnelActive,
      tunnelStarting = metadata.tunnelStarting,
      activeTunnelPort = metadata.activeTunnelPort,
    )
  }

  private fun currentSharedFilesTunnelReachabilityRoute(): String =
    if (Mobiletunnel.currentSelectedICERoute() == "turn_relay") "relay" else "tunnel"

  private fun sharedFileUrlForRoute(kind: String, path: String, route: SharedFileRoute): URL =
    appendSharedDirectoryAccessToken(
      URL("http", route.urlHost, route.port, sharedFileEndpoint(route.scope, kind, path)),
      route,
    )

  private fun receivedListRoute(route: SharedFileRoute): SharedFileRoute {
    val query = listOf(
      "clientId" to getOrCreateClientId(),
      "clientName" to getClientDisplayNameValue(),
      "scope" to "client",
    ).joinToString("&") { (name, value) ->
      "$name=${URLEncoder.encode(value, "UTF-8")}"
    }
    return route.copy(
      kind = "list",
      path = "received",
      url = URL(
        "http",
        route.urlHost,
        route.port,
        "/resources/mobile/received?$query",
      ),
      authorizationToken = null,
    )
  }

  private fun receivedFileUrlForRoute(
    fileKey: String,
    route: SharedFileRoute,
    kind: String = "download",
  ): URL {
    val normalizedKind = normalizeReceivedMediaKind(kind)
    val query = listOf(
      "clientId" to getOrCreateClientId(),
      "clientName" to getClientDisplayNameValue(),
      "fileKey" to fileKey,
    ).joinToString("&") { (name, value) ->
      "$name=${URLEncoder.encode(value, "UTF-8")}"
    }
    return URL(
      "http",
      route.urlHost,
      route.port,
      "/resources/mobile/received/$normalizedKind?$query",
    )
  }

  private fun normalizeReceivedMediaKind(kind: String): String =
    when (kind.trim().lowercase(Locale.US)) {
      "preview" -> "preview"
      "thumbnail" -> "thumbnail"
      "stream" -> "stream"
      else -> "download"
    }

  private fun isReceivedImage(mediaType: String, filename: String): Boolean {
    val normalized = mediaType.trim().lowercase(Locale.US)
    if (normalized == "image" || normalized.startsWith("image/")) return true
    return filename.substringAfterLast('.', "")
      .lowercase(Locale.US) in setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif")
  }

  private fun isReceivedVideo(mediaType: String, filename: String): Boolean {
    val normalized = mediaType.trim().lowercase(Locale.US)
    if (normalized == "video" || normalized.startsWith("video/")) return true
    return filename.substringAfterLast('.', "")
      .lowercase(Locale.US) in setOf("mp4", "mov", "avi", "mkv", "webm", "m4v")
  }

  private fun sharedFileEndpoint(scope: String, kind: String, path: String): String {
    val normalizedPath = path.trim().trim('/')
    val prefix = if (scope == "personal") "/personal" else "/shared"
    return when (kind) {
      "list" -> if (normalizedPath.isBlank()) "$prefix/list" else "$prefix/list/${encodePath(normalizedPath)}"
      "download" -> "$prefix/download/${encodePath(normalizedPath)}"
      "stream" -> "$prefix/stream/${encodePath(normalizedPath)}"
      "thumbnail" -> "$prefix/thumbnail/${encodePath(normalizedPath)}"
      else -> throw IllegalArgumentException("Unsupported shared endpoint: $kind")
    }
  }

  private fun normalizeSharedDirectoryScope(scope: String): String =
    if (scope.trim().equals("personal", ignoreCase = true)) "personal" else "team"

  private fun applySharedDirectoryAuthorization(connection: HttpURLConnection, route: SharedFileRoute) {
    val token = route.authorizationToken ?: return
    connection.setRequestProperty("Authorization", "Bearer $token")
  }

  private fun appendSharedDirectoryAccessToken(url: URL, route: SharedFileRoute): URL {
    return appendSharedDirectoryQueryParams(url, route.scope, route.authorizationToken)
  }

  private fun appendSharedDirectoryQueryParams(url: URL, scope: String, authorizationToken: String?): URL {
    val queryItems = mutableListOf<Pair<String, String>>()
    authorizationToken?.trim()?.takeIf { it.isNotBlank() }?.let {
      queryItems.add("access_token" to it)
    }
    if (scope == "personal") {
      val clientId = getOrCreateClientId().trim()
      if (clientId.isNotBlank()) {
        queryItems.add("clientId" to clientId)
        queryItems.add("clientName" to getClientDisplayNameValue().trim().ifBlank { clientId })
      }
    }
    if (queryItems.isEmpty()) {
      return url
    }
    val separator = if (url.query.isNullOrBlank()) "?" else "&"
    val query = queryItems.joinToString("&") { (name, value) ->
      "$name=${URLEncoder.encode(value, "UTF-8")}"
    }
    return URL("${url}$separator$query")
  }

  private fun p2pTunnelRouteSnapshot(): P2PTunnelRouteSnapshot =
    synchronized(p2pTunnelLock) {
      P2PTunnelRouteSnapshot(
        hasCredentials = !signalingUrl.isNullOrBlank() && !accessToken.isNullOrBlank(),
        isActive = isTunnelActive && tunnelPort != null,
        isStarting = tunnelStarting,
        port = tunnelPort,
      )
    }

  private fun waitForP2PTunnelActive(binding: StoredBinding, reason: String): Boolean {
    val deadline = SystemClock.elapsedRealtime() + SHARED_TUNNEL_ROUTE_WAIT_MS
    var attempt = 0
    var didLogWait = false

    while (true) {
      val snapshot = p2pTunnelRouteSnapshot()
      if (snapshot.isActive) {
        recordNativeLog(
          "SharedFiles",
          "P2P tunnel ready for shared files reason=$reason port=${snapshot.port ?: "nil"} attempts=${attempt + 1}",
        )
        return true
      }
      if (!snapshot.hasCredentials) {
        recordNativeLog("SharedFiles", "P2P tunnel unavailable for shared files reason=$reason; credentials missing")
        return false
      }
      startP2PTunnelIfNeeded(binding)
      if (SystemClock.elapsedRealtime() >= deadline) {
        break
      }
      if (!didLogWait) {
        didLogWait = true
        recordNativeLog("SharedFiles", "waiting for P2P tunnel before shared files route reason=$reason")
      }
      Thread.sleep(SHARED_TUNNEL_ROUTE_POLL_MS)
      attempt += 1
    }

    val finalSnapshot = p2pTunnelRouteSnapshot()
    if (finalSnapshot.isActive) {
      recordNativeLog(
        "SharedFiles",
        "P2P tunnel became ready at wait deadline reason=$reason port=${finalSnapshot.port ?: "nil"}",
      )
      return true
    }
    return false
  }

  private fun recoverSharedFileTunnelAfterRouteFailure(
    scope: String,
    kind: String,
    path: String,
    requestAccessToken: String,
    reason: String,
    error: Throwable,
  ): SharedFileRoute {
    recordNativeLog(
      "SharedFiles",
      "tunnel route failed path=$path reason=$reason error=${error.message ?: error.javaClass.simpleName}; restarting tunnel",
      Log.WARN,
    )
    val binding = loadBinding() ?: throw IllegalStateException("No bound desktop")
    stopP2PTunnel()
    return if (waitForP2PTunnelActive(binding, "${reason}_retry_after_tunnel_restart")) {
      resolveSharedFileRoute(
        scope = scope,
        kind = kind,
        path = path,
        requestAccessToken = requestAccessToken,
        reason = "${reason}_retry_after_tunnel_restart",
        waitForTunnel = false,
      )
    } else {
      resolveSharedFileRoute(
        scope = scope,
        kind = kind,
        path = path,
        requestAccessToken = requestAccessToken,
        reason = "${reason}_direct_fallback_after_tunnel_restart",
        waitForTunnel = false,
      )
    }
  }

  private fun logSharedFileRoute(action: String, route: SharedFileRoute, retry: Boolean = false) {
    val retryPrefix = if (retry) " retry" else ""
    recordNativeLog(
      "SharedFiles",
      "$action$retryPrefix kind=${route.kind} path=${route.path} resolved_host=${route.displayHost} " +
        "is_tunnel=${route.isTunnel} tunnel_active=${route.tunnelActive} " +
        "tunnel_starting=${route.tunnelStarting} active_port=${route.activeTunnelPort ?: "nil"}",
    )
  }

  private fun logSharedFileDownloadResult(
    action: String,
    key: String,
    result: WritableMap,
    route: SharedFileRoute,
    retry: Boolean = false,
  ) {
    val localPath = if (result.hasKey("localPath") && !result.isNull("localPath")) {
      result.getString("localPath")
    } else {
      "nil"
    }
    val savedLocation = if (result.hasKey("savedLocation") && !result.isNull("savedLocation")) {
      result.getString("savedLocation")
    } else {
      "nil"
    }
    val savedToPhotos = result.hasKey("savedToPhotos") && result.getBoolean("savedToPhotos")
    recordNativeLog(
      "SharedFiles",
      "$action completed key=$key retry=$retry is_tunnel=${route.isTunnel} saved_to_photos=$savedToPhotos local_path=$localPath saved_location=$savedLocation",
    )
  }

  private fun attemptSharedFilesLANWakeIfNeeded(
    binding: StoredBinding,
    reason: String,
    allowPublicWake: Boolean = false,
  ): String? {
    val wake = binding.wake
    recordNativeLog(
      "SharedFiles",
      "wake candidate reason=$reason hasMetadata=${wake != null} hasUsableTargets=${wake?.hasUsableTargets == true} ${wakeCapabilityLogSummary(wake)}",
    )
    if (wake?.hasUsableTargets != true) {
      recordNativeLog(
        "SharedFiles",
        "wake skipped reason=$reason metadata_missing_or_unusable ${wakeCapabilityLogSummary(wake)}",
      )
      return null
    }

    val targets = AndroidSyncPrimitives.validWakeTargets(wake.targets)
    recordNativeLog(
      "SharedFiles",
      "wake target summary reason=$reason targets=${targets.joinToString("; ") { describeWakeTarget(it) }}",
    )
    updateSharedFilesReachability(
      state = "waking",
      route = null,
      reason = "${reason}_wake_attempt_started",
    )
    val wakeAttemptStartedAt = isoNow()
    try {
      val result = sendWakeOnLanPackets(targets, if (allowPublicWake) wake.publicTarget else null)
      val failures = result.failures
        .takeIf { it.isNotEmpty() }
        ?.let { " failedDestinations=${describeWakeFailures(it)}" }
        ?: ""
      recordNativeLog(
        "SharedFiles",
        "wake packets sent reason=$reason targets=${targets.size} packets=${result.sentPackets} destinations=${describeWakeDestinations(result.destinations)}$failures",
      )
    } catch (error: Throwable) {
      recordNativeLog(
        "SharedFiles",
        "wake packet send failed reason=$reason error=${error.message ?: error.javaClass.simpleName}",
        Log.WARN,
      )
      clearSharedFilesReachability(reason = "${reason}_wake_send_failed")
      return null
    }

    val deadline = SystemClock.elapsedRealtime() + SHARED_LAN_WAKE_POLL_TIMEOUT_MS
    while (SystemClock.elapsedRealtime() < deadline) {
      // Early exit if P2P tunnel becomes active
      val snapshot = p2pTunnelRouteSnapshot()
      if (snapshot.isActive && snapshot.port != null) {
        val wokeHost = "127.0.0.1:${snapshot.port}"
        recordNativeLog("SharedFiles", "wake early P2P tunnel active host=$wokeHost reason=$reason")
        updateSharedFilesReachability(
          state = "available",
          route = null,
          routeOverride = "tunnel",
          reason = AndroidSyncPrimitives.wakeLanReachableReason(reason),
        )
        return wokeHost
      }

      val latestBinding = loadBinding() ?: binding
      val probeHost = latestBinding.host.takeIf { it.isNotBlank() } ?: binding.host
      if (canReachSidecarHealth(probeHost, SHARED_LAN_WAKE_HEALTH_TIMEOUT_MS)) {
        val lanReachableReason = AndroidSyncPrimitives.wakeLanReachableReason(reason)
        val updated = updateBindingConnectionState(latestBinding, "connected", reason = lanReachableReason)
        val recoveredHost = updated?.host?.takeIf { it.isNotBlank() } ?: probeHost
        updateSharedFilesReachability(
          state = "available",
          route = null,
          routeOverride = "lan",
          reason = lanReachableReason,
        )
        recordNativeLog("SharedFiles", "wake LAN reachable host=$recoveredHost reason=$reason")
        if (confirmDesktopFullResume(recoveredHost, latestBinding.deviceId, wakeAttemptStartedAt, reason)) {
          val fullResumeReason = AndroidSyncPrimitives.wakeFullResumeConfirmedReason(reason)
          recordNativeLog("SharedFiles", "wake full resume confirmed host=$recoveredHost reason=$reason")
          updateBindingConnectionState(loadBinding() ?: updated ?: latestBinding, "connected", reason = fullResumeReason)
        } else {
          recordNativeLog(
            "SharedFiles",
            "LAN reachable but desktop full wake not confirmed host=$recoveredHost reason=$reason",
          )
        }
        return recoveredHost
      }

      Thread.sleep(SHARED_LAN_WAKE_POLL_INTERVAL_MS)
    }

    recordNativeLog("SharedFiles", "wake polling exhausted reason=$reason")
    logPeerProxySkipDiagnostics()
    clearSharedFilesReachability(reason = "${reason}_wake_polling_exhausted")
    return null
  }

  private fun confirmDesktopFullResume(
    host: String,
    expectedDeviceId: String,
    wakeAttemptStartedAt: String,
    reason: String,
  ): Boolean {
    val clientId = getOrCreateClientId()
    val url = try {
      URL(AndroidSyncPrimitives.buildPresenceHeartbeatUrl(host, DEFAULT_SIDECAR_HTTP_PORT, clientId))
    } catch (error: Throwable) {
      recordNativeLog(
        "SharedFiles",
        "wake full resume unconfirmed host=$host reason=$reason invalidPresenceTarget error=${error.message ?: error.javaClass.simpleName}",
      )
      return false
    }
    val connection = url.openConnection() as HttpURLConnection
    return try {
      connection.requestMethod = "POST"
      connection.connectTimeout = SHARED_LAN_WAKE_HEALTH_TIMEOUT_MS
      connection.readTimeout = SHARED_LAN_WAKE_HEALTH_TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { output -> writeUtf8(output, "{}") }
      val statusCode = connection.responseCode
      val body = readResponseBody(connection, statusCode)
      if (statusCode !in 200..299) {
        recordNativeLog(
          "SharedFiles",
          "wake full resume unconfirmed host=$host reason=$reason status=$statusCode",
        )
        return false
      }
      val payload = JSONObject(body)
      val responseServerId = payload.optString("serverId").takeIf { it.isNotBlank() }
      if (!AndroidSyncPrimitives.presenceResponseMatchesBinding(expectedDeviceId, responseServerId)) {
        recordNativeLog(
          "SharedFiles",
          "wake full resume unconfirmed host=$host reason=$reason expectedServerId=$expectedDeviceId responseServerId=${responseServerId ?: "nil"}",
        )
        return false
      }
      val power = payload.optJSONObject("power")
      val lastResumeAt = power?.optString("lastResumeAt")?.takeIf { it.isNotBlank() }.orEmpty()
      val confirmed = AndroidSyncPrimitives.isFullWakeConfirmed(
        lastResumeAt = lastResumeAt,
        wakeAttemptStartedAt = wakeAttemptStartedAt,
      )
      recordNativeLog(
        "SharedFiles",
        "wake full resume check host=$host reason=$reason confirmed=$confirmed attemptStartedAt=$wakeAttemptStartedAt lastResumeAt=${lastResumeAt.ifBlank { "nil" }}",
      )
      confirmed
    } catch (error: Throwable) {
      recordNativeLog(
        "SharedFiles",
        "wake full resume unconfirmed host=$host reason=$reason error=${error.message ?: error.javaClass.simpleName}",
      )
      false
    } finally {
      connection.disconnect()
    }
  }

  private fun describeWakeTarget(target: AndroidWakeTarget): String {
    val ports = target.ports
      .filter { it in 1..65_535 }
      .joinToString(",")
    return "interface=${target.interfaceName} mac=${maskedWakeMacAddress(target.macAddress)} ipv4=${target.ipv4Address} broadcast=${target.broadcastAddress} ports=$ports"
  }

  private fun describeWakeDestinations(destinations: List<AndroidWakePacketDestination>): String =
    destinations.joinToString(",") { "${it.host}:${it.port}" }

  private fun describeWakeFailures(failures: List<WakePacketSendFailure>): String =
    failures.joinToString(",") { "${it.destination.host}:${it.destination.port}=${it.error}" }

  private fun maskedWakeMacAddress(macAddress: String): String {
    val parts = macAddress.trim().replace("-", ":").lowercase().split(":")
    return if (parts.size == 6) {
      "**:**:**:**:${parts[4]}:${parts[5]}"
    } else {
      "<invalid>"
    }
  }

  private data class WakeOnLanSendResult(
    val sentPackets: Int,
    val destinations: List<AndroidWakePacketDestination>,
    val failures: List<WakePacketSendFailure>,
  )

  private data class WakePacketSendFailure(
    val destination: AndroidWakePacketDestination,
    val error: String,
  )

  private fun sendWakeOnLanPackets(
    targets: List<AndroidWakeTarget>,
    publicTarget: AndroidPublicWakeTarget? = null
  ): WakeOnLanSendResult {
    val repeatCount = 3
    var sentPackets = 0
    val destinations = mutableListOf<AndroidWakePacketDestination>()
    val failures = mutableListOf<WakePacketSendFailure>()
    val seenFailures = mutableSetOf<String>()
    DatagramSocket().use { socket ->
      socket.broadcast = true
      for (target in targets) {
        val packetBytes = AndroidSyncPrimitives.buildWakeOnLanMagicPacket(target.macAddress)
        val targetDestinations = AndroidSyncPrimitives.wakePacketDestinations(target).toMutableList()
        if (publicTarget != null && publicTarget.enabled && publicTarget.host.isNotBlank()) {
          targetDestinations.add(AndroidWakePacketDestination(publicTarget.host.trim(), publicTarget.port))
        }
        val uniqueDestinations = targetDestinations.distinct()
        destinations.addAll(uniqueDestinations)
        repeat(repeatCount) { round ->
          for (destination in uniqueDestinations) {
            try {
              val address = InetAddress.getByName(destination.host)
              socket.send(DatagramPacket(packetBytes, packetBytes.size, address, destination.port))
              sentPackets += 1
            } catch (error: Throwable) {
              val errorDescription = error.message ?: error.javaClass.simpleName
              val failureKey = "${destination.host}:${destination.port}:$errorDescription"
              if (seenFailures.add(failureKey)) {
                failures.add(WakePacketSendFailure(destination, errorDescription))
              }
            }
          }
          if (round < repeatCount - 1) {
            Thread.sleep(250)
          }
        }
      }
    }
    if (sentPackets == 0) {
      val details = failures.joinToString(",") { "${it.destination.host}:${it.destination.port}=${it.error}" }
      throw IllegalStateException("all wake packets failed failures=$details")
    }
    return WakeOnLanSendResult(sentPackets, destinations, failures)
  }

  private fun canReachSidecarHealth(host: String, timeoutMs: Int): Boolean {
    if (host.isBlank()) {
      return false
    }
    val connection = try {
      URL("http", host, DEFAULT_SIDECAR_HTTP_PORT, "/health").openConnection() as HttpURLConnection
    } catch (_: Throwable) {
      return false
    }
    return try {
      connection.requestMethod = "GET"
      connection.connectTimeout = timeoutMs
      connection.readTimeout = timeoutMs
      val status = connection.responseCode
      if (status !in 200..299) {
        return false
      }
      val json = JSONObject(readResponseBody(connection, status))
      json.optBoolean("ok", false) && json.optString("service") == "syncflow-sidecar"
    } catch (_: Throwable) {
      false
    } finally {
      connection.disconnect()
    }
  }

  private fun encodePath(path: String): String =
    path.split('/')
      .filter { it.isNotBlank() }
      .joinToString("/") { segment -> URLEncoder.encode(segment, "UTF-8").replace("+", "%20") }
      .ifBlank { "" }

  private fun localLedgerDateKey(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    formatter.timeZone = TimeZone.getDefault()
    return formatter.format(Date())
  }

  private fun photoPermissionsForRequest(): Array<String> {
    return when {
      Build.VERSION.SDK_INT >= ANDROID_14_API -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED,
      )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
      )
      else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
  }

  private fun currentPhotoPermissionState(): String {
    return if (Build.VERSION.SDK_INT >= ANDROID_14_API) {
      val hasImages = reactApplicationContext.checkSelfPermission(
        Manifest.permission.READ_MEDIA_IMAGES,
      ) == PackageManager.PERMISSION_GRANTED
      val hasVideo = reactApplicationContext.checkSelfPermission(
        Manifest.permission.READ_MEDIA_VIDEO,
      ) == PackageManager.PERMISSION_GRANTED
      val hasSelected = reactApplicationContext.checkSelfPermission(
        PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED,
      ) == PackageManager.PERMISSION_GRANTED
      when {
        hasImages && hasVideo -> "granted"
        hasSelected || hasImages || hasVideo -> "limited"
        else -> "denied"
      }
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val hasImages = reactApplicationContext.checkSelfPermission(
        Manifest.permission.READ_MEDIA_IMAGES,
      ) == PackageManager.PERMISSION_GRANTED
      val hasVideo = reactApplicationContext.checkSelfPermission(
        Manifest.permission.READ_MEDIA_VIDEO,
      ) == PackageManager.PERMISSION_GRANTED
      when {
        hasImages && hasVideo -> "granted"
        hasImages || hasVideo -> "limited"
        else -> "denied"
      }
    } else {
      val granted = reactApplicationContext.checkSelfPermission(
        Manifest.permission.READ_EXTERNAL_STORAGE,
      ) == PackageManager.PERMISSION_GRANTED
      if (granted) "granted" else "denied"
    }
  }

  private fun getOrCreateClientId(): String {
    val existing = prefs.getString(PREF_CLIENT_ID, null)
    if (!existing.isNullOrBlank()) {
      return existing
    }

    val generated = UUID.randomUUID().toString()
    prefs.edit().putString(PREF_CLIENT_ID, generated).apply()
    return generated
  }

  private fun getOrCreateStableDeviceId(): String {
    val androidId = try {
      Settings.Secure.getString(
        reactApplicationContext.contentResolver,
        Settings.Secure.ANDROID_ID,
      )
    } catch (_: Throwable) {
      null
    }?.trim()?.lowercase()

    if (!androidId.isNullOrBlank() && androidId != "9774d56d682e549c") {
      return androidId
    }

    return getOrCreateClientId()
  }

  private fun getClientDisplayNameValue(): String {
    val stored = prefs.getString(PREF_CLIENT_DISPLAY_NAME, null)
    if (!stored.isNullOrBlank()) {
      return stored
    }

    return "Android ${Build.MODEL}".trim()
  }

  private fun getVersionName(): String {
    val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactApplicationContext.packageManager.getPackageInfo(
        reactApplicationContext.packageName,
        PackageManager.PackageInfoFlags.of(0),
      )
    } else {
      @Suppress("DEPRECATION")
      reactApplicationContext.packageManager.getPackageInfo(
        reactApplicationContext.packageName,
        0,
      )
    }

    return packageInfo.versionName ?: "1.0.0"
  }

  private fun getVersionCode(): String {
    val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactApplicationContext.packageManager.getPackageInfo(
        reactApplicationContext.packageName,
        PackageManager.PackageInfoFlags.of(0),
      )
    } else {
      @Suppress("DEPRECATION")
      reactApplicationContext.packageManager.getPackageInfo(
        reactApplicationContext.packageName,
        0,
      )
    }

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      packageInfo.longVersionCode.toString()
    } else {
      @Suppress("DEPRECATION")
      packageInfo.versionCode.toString()
    }
  }

  private fun emitDiscoveredDevicesChanged() {
    emitDiscoveredDevicesChanged(Arguments.createArray())
  }

  private fun emitDiscoveredDevicesChanged(devices: WritableArray) {
    recordNativeLog("Discovery", "emitting discovered devices count=${devices.size()}")
    emitEvent("onDiscoveredDevicesChanged", devices)
  }

  private fun emitQueueUpdated(queue: WritableArray) {
    emitEvent("onQueueUpdated", queue)
  }

  private fun emitBindingStateChanged(binding: StoredBinding) {
    emitEvent("onBindingStateChanged", binding.toWritableMapWithSharedFilesReachability())
  }

  private fun emitBindingStateCleared() {
    emitEvent("onBindingStateChanged", null)
  }

  private fun updateSharedFilesReachability(
    state: String,
    route: SharedFileRoute?,
    routeOverride: String? = null,
    reason: String,
  ) {
    val binding = loadBinding() ?: return
    val next = SharedFilesReachability(
      deviceId = binding.deviceId,
      state = state,
      route = route?.reachabilityRoute ?: routeOverride,
      reason = reason,
      updatedAt = isoNow(),
    )
    val previous = sharedFilesReachability
    sharedFilesReachability = next
    recordNativeLog(
      "SharedFiles",
      "reachability ${previous?.state ?: "nil"}/${previous?.route ?: "nil"} -> ${next.state}/${next.route ?: "nil"} ($reason)",
    )
    emitEvent("onSharedFilesReachabilityChanged", next.toWritableMap())
  }

  private fun clearSharedFilesReachability(reason: String) {
    if (sharedFilesReachability == null) {
      return
    }
    sharedFilesReachability = null
    recordNativeLog("SharedFiles", "reachability cleared ($reason)")
    emitEvent("onSharedFilesReachabilityChanged", null)
  }

  private fun retainSharedFilesTunnelReachabilityForBindingOffline(reason: String?): Boolean {
    val reachability = sharedFilesReachability ?: return false
    val snapshot = p2pTunnelRouteSnapshot()
    if (!AndroidSyncPrimitives.shouldRetainSharedFilesTunnelReachabilityOnBindingOffline(
        reason = reason,
        reachabilityState = reachability.state,
        reachabilityRoute = reachability.route,
        isTunnelActive = snapshot.isActive,
        isTunnelStarting = snapshot.isStarting,
      )
    ) {
      return false
    }

    val next = reachability.copy(
      reason = "${reason}_tunnel_retained",
      updatedAt = isoNow(),
    )
    sharedFilesReachability = next
    recordNativeLog(
      "SharedFiles",
      "reachability ${reachability.state}/${reachability.route ?: "nil"} -> ${next.state}/${next.route ?: "nil"} (${next.reason})",
    )
    emitEvent("onSharedFilesReachabilityChanged", next.toWritableMap())
    return true
  }

  private fun StoredBinding.toWritableMapWithSharedFilesReachability(): WritableMap {
    val map = toWritableMap()
    val reachability = sharedFilesReachability
    if (reachability != null && reachability.deviceId == deviceId) {
      map.putMap("sharedFilesReachability", reachability.toWritableMap())
    }
    return map
  }

  private fun emitIdleSyncState(binding: StoredBinding?) {
    emitEvent("onSyncStateChanged", buildIdleSyncSummary(binding, "idle", uploadStore.getPendingItems(limit = 10_000)))
  }

  private fun emitSyncState(
    binding: StoredBinding?,
    uploadState: String,
    lastErrorCode: String? = null,
    lastErrorMessage: String? = null,
  ) {
    emitEvent(
      "onSyncStateChanged",
      buildIdleSyncSummary(
        binding = binding,
        uploadState = uploadState,
        pendingItems = uploadStore.getPendingItems(limit = 10_000),
        lastErrorCode = lastErrorCode,
        lastErrorMessage = lastErrorMessage,
      ),
    )
  }

  private fun emitError(code: String, message: String) {
    recordNativeLog("Error", "$code: $message", Log.ERROR)
    val error = Arguments.createMap().apply {
      putString("code", code)
      putString("message", message)
    }
    emitEvent("onError", error)
  }

  private fun emitEvent(eventName: String, payload: Any?) {
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun buildIdleSyncSummary(
    binding: StoredBinding?,
    uploadState: String = "idle",
    pendingItems: List<AndroidUploadItem> = emptyList(),
    lastErrorCode: String? = null,
    lastErrorMessage: String? = null,
  ): WritableMap {
    val pendingBytes = pendingItems.sumOf { it.fileSize }
    val manualPending = AndroidSyncPrimitives.pendingCount(pendingItems, "manual")
    val autoPending = AndroidSyncPrimitives.pendingCount(pendingItems, "auto")
    val autoConfig = loadAutoUploadConfig()
    return AndroidSyncPrimitives.buildSyncOverviewFields(
      AndroidSyncOverviewInput(
        currentDeviceId = binding?.deviceId,
        currentDeviceName = binding?.deviceAlias ?: binding?.deviceName,
        uploadState = uploadState,
        totalCount = pendingItems.size,
        totalBytes = pendingBytes,
        lastErrorCode = lastErrorCode,
        lastErrorMessage = lastErrorMessage,
        autoUploadState = autoConfig.state,
        manualPending = manualPending,
        autoPending = autoPending,
      ),
    ).toWritableMap()
  }

  private fun buildIdleSyncOverviewJson(
    binding: StoredBinding?,
    pendingItems: List<AndroidUploadItem>,
  ): JSONObject {
    val pendingBytes = pendingItems.sumOf { it.fileSize }
    val autoConfig = loadAutoUploadConfig()
    return AndroidSyncPrimitives.buildSyncOverviewFields(
      AndroidSyncOverviewInput(
        currentDeviceId = binding?.deviceId,
        currentDeviceName = binding?.deviceAlias ?: binding?.deviceName,
        uploadState = "idle",
        totalCount = pendingItems.size,
        totalBytes = pendingBytes,
        autoUploadState = autoConfig.state,
        manualPending = AndroidSyncPrimitives.pendingCount(pendingItems, "manual"),
        autoPending = AndroidSyncPrimitives.pendingCount(pendingItems, "auto"),
      ),
    ).toJson()
  }

  private fun emitPreparationSyncState(
    binding: StoredBinding,
    sessionId: String,
    pending: List<AndroidUploadItem>,
    totalBytes: Long,
  ) {
    val autoConfig = loadAutoUploadConfig()
    emitEvent(
      "onSyncStateChanged",
      AndroidSyncPrimitives.buildSyncOverviewFields(
        AndroidSyncOverviewInput(
          currentDeviceId = binding.deviceId,
          currentDeviceName = binding.deviceAlias.ifBlank { binding.deviceName },
          uploadState = "preparing",
          sessionId = sessionId,
          totalCount = pending.size,
          totalBytes = totalBytes,
          activeTuningProfile = "standard",
          currentTaskSource = pending.firstOrNull()?.source,
          autoUploadState = autoConfig.state,
          manualPending = AndroidSyncPrimitives.pendingCount(pending, "manual"),
          autoPending = AndroidSyncPrimitives.pendingCount(pending, "auto"),
        ),
      ).toWritableMap(),
    )
  }

  private fun emitCompletedSyncState(
    binding: StoredBinding,
    sessionId: String,
    completedCount: Int,
    totalCount: Int,
    completedBytes: Long,
    totalBytes: Long,
    lastCompletedTaskSource: String?,
  ) {
    val pendingItems = uploadStore.getPendingItems(limit = 10_000)
    val autoConfig = loadAutoUploadConfig()
    emitEvent(
      "onSyncStateChanged",
      AndroidSyncPrimitives.buildSyncOverviewFields(
        AndroidSyncOverviewInput(
          currentDeviceId = binding.deviceId,
          currentDeviceName = binding.deviceAlias.ifBlank { binding.deviceName },
          uploadState = "completed",
          sessionId = sessionId,
          completedCount = completedCount,
          totalCount = totalCount,
          completedBytes = completedBytes,
          totalBytes = totalBytes,
          lastCompletedTaskSource = lastCompletedTaskSource,
          autoUploadState = autoConfig.state,
          manualPending = AndroidSyncPrimitives.pendingCount(pendingItems, "manual"),
          autoPending = AndroidSyncPrimitives.pendingCount(pendingItems, "auto"),
        ),
      ).toWritableMap(),
    )
  }

  private fun updateBindingConnectionState(
    binding: StoredBinding?,
    connectionState: String,
    reason: String? = null,
  ): StoredBinding? {
    if (binding == null) {
      return null
    }
    if (binding.connectionState == connectionState) {
      return binding
    }
    val reasonSuffix = reason?.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()
    recordNativeLog(
      "SyncEngine",
      "binding connection state ${binding.connectionState} -> $connectionState$reasonSuffix",
    )
    val updated = binding.copy(connectionState = connectionState)
    saveBinding(updated)
    val retainSharedFilesTunnel = connectionState == "offline" &&
      retainSharedFilesTunnelReachabilityForBindingOffline(reason)
    if (connectionState == "offline" && !retainSharedFilesTunnel) {
      clearSharedFilesReachability(reason = "binding_state_offline")
    }
    emitBindingStateChanged(updated)
    if (connectionState == "connected") {
      cancelPresenceRecoveryProbe(reason = reason ?: "state_connected")
      startPresenceHeartbeatTimer(updated)
      startP2PTunnelIfNeeded(updated)
      wakeManualUploadAfterReconnectIfNeeded(
        previousConnectionState = binding.connectionState,
        updatedBinding = updated,
        reason = reason ?: "state_connected",
      )
    } else if (connectionState == "offline") {
      cancelPresenceRecoveryProbe(reason = reason ?: "state_offline")
      stopPresenceHeartbeatTimer()
      if (retainSharedFilesTunnel) {
        recordNativeLog("SharedFiles", "retained P2P tunnel while binding offline (${reason ?: "state_offline"})")
      } else {
        stopP2PTunnel()
      }
    } else if (connectionState != "connecting") {
      stopPresenceHeartbeatTimer()
      stopP2PTunnel()
    } else {
      stopPresenceHeartbeatTimer()
      stopP2PTunnel()
    }
    return updated
  }

  private fun wakeManualUploadAfterReconnectIfNeeded(
    previousConnectionState: String,
    updatedBinding: StoredBinding,
    reason: String,
  ) {
    val pendingItems = uploadStore.getPendingItems(limit = 10_000)
    val manualPending = AndroidSyncPrimitives.pendingCount(pendingItems, "manual")
    if (!AndroidSyncPrimitives.shouldResumeManualUploadAfterReachabilityRestored(
        previousConnectionState = previousConnectionState,
        nextConnectionState = updatedBinding.connectionState,
        manualPending = manualPending,
        syncInProgress = syncInProgress,
      )
    ) {
      return
    }

    recordDiagnosticsLog(
      "ManualUpload",
      "resuming pending manual queue after reconnect pending=$manualPending reason=$reason",
    )
    resumePendingManualQueueAfterReconnect()
  }

  private fun wakeManualUploadAfterDiscoveryReconnectIfNeeded(
    previousConnectionState: String,
    updatedBinding: StoredBinding,
    reason: String,
  ) {
    val pendingItems = uploadStore.getPendingItems(limit = 10_000)
    val manualPending = AndroidSyncPrimitives.pendingCount(pendingItems, "manual")
    if (!AndroidSyncPrimitives.shouldResumeManualUploadAfterDiscoveryReachabilityRestored(
        previousConnectionState = previousConnectionState,
        nextConnectionState = updatedBinding.connectionState,
        manualPending = manualPending,
        syncInProgress = syncInProgress,
      )
    ) {
      return
    }

    recordDiagnosticsLog(
      "ManualUpload",
      "resuming pending manual queue after discovery reconnect pending=$manualPending reason=$reason",
    )
    resumePendingManualQueueAfterReconnect()
  }

  private fun resumePendingManualQueueAfterReconnect() {
    startForegroundSyncRound(
      reason = "manual_upload",
      threadName = "NativeSyncEngineManualReconnect",
      notificationReason = "manual_reconnect",
    )
  }

  private fun sendPresenceHeartbeatAsync(
    binding: StoredBinding,
    reason: String,
    recoverOnFailure: Boolean = false,
  ) {
    presenceHeartbeatExecutor().execute {
      val succeeded = sendPresenceHeartbeat(binding, reason = reason, updateStateOnFailure = false)
      if (!succeeded && recoverOnFailure) {
        startPresenceRecoveryProbeIfNeeded(binding)
      }
    }
  }

  private fun resumePresenceHeartbeatFromStoredBinding(reason: String) {
    val binding = loadBinding()?.takeIf { it.connectionState == "connected" } ?: return
    recordDiagnosticsLog("Presence", "resuming heartbeat for stored binding deviceId=${binding.deviceId} reason=$reason")
    sendPresenceHeartbeatAsync(binding, reason = reason, recoverOnFailure = true)
    startPresenceHeartbeatTimer(binding)
  }

  private fun startPresenceHeartbeatTimer(binding: StoredBinding) {
    if (binding.connectionState != "connected") {
      return
    }
    synchronized(presenceHeartbeatLock) {
      presenceHeartbeatFuture?.cancel(false)
      val deviceId = binding.deviceId
      presenceHeartbeatFuture = presenceHeartbeatExecutorLocked().scheduleWithFixedDelay(
        {
          val current = loadBinding()
          if (current == null || current.deviceId != deviceId || current.connectionState != "connected") {
            stopPresenceHeartbeatTimer()
            return@scheduleWithFixedDelay
          }
          if (syncInProgress) {
            return@scheduleWithFixedDelay
          }
          startP2PTunnelIfNeeded(current)
          val succeeded = sendPresenceHeartbeat(current, reason = "presence_heartbeat_timer", updateStateOnFailure = false)
          if (!succeeded) {
            startPresenceRecoveryProbeIfNeeded(current)
          }
        },
        PRESENCE_HEARTBEAT_INTERVAL_MS,
        PRESENCE_HEARTBEAT_INTERVAL_MS,
        TimeUnit.MILLISECONDS,
      )
    }
    recordDiagnosticsLog("Presence", "heartbeat timer started deviceId=${binding.deviceId}")
  }

  private fun stopPresenceHeartbeatTimer() {
    synchronized(presenceHeartbeatLock) {
      presenceHeartbeatFuture?.cancel(false)
      presenceHeartbeatFuture = null
    }
  }

  private fun presenceHeartbeatExecutor(): ScheduledExecutorService =
    synchronized(presenceHeartbeatLock) { presenceHeartbeatExecutorLocked() }

  private fun presenceHeartbeatExecutorLocked(): ScheduledExecutorService {
    val existing = presenceHeartbeatExecutor
    if (existing != null && !existing.isShutdown) {
      return existing
    }
    return Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "NativeSyncEnginePresence").apply { isDaemon = true }
    }.also { presenceHeartbeatExecutor = it }
  }

  private fun sendPresenceHeartbeat(
    binding: StoredBinding,
    reason: String,
    updateStateOnFailure: Boolean,
  ): Boolean = sendPresenceHeartbeat(
    binding = binding,
    successReason = reason,
    failureReason = reason,
    updateStateOnFailure = updateStateOnFailure,
  )

  private fun sendPresenceHeartbeat(
    binding: StoredBinding,
    successReason: String,
    failureReason: String,
    updateStateOnFailure: Boolean,
  ): Boolean {
    if (binding.host.isBlank()) {
      return false
    }
    val clientId = getOrCreateClientId()
    val url = try {
      URL(AndroidSyncPrimitives.buildPresenceHeartbeatUrl(binding.host, DEFAULT_SIDECAR_HTTP_PORT, clientId))
    } catch (error: Throwable) {
      recordDiagnosticsLog(
        "Presence",
        "heartbeat skipped invalid target host=${binding.host} clientId=$clientId reason=$failureReason error=${error.message ?: error.javaClass.simpleName}",
      )
      return false
    }

    val connection = url.openConnection() as HttpURLConnection
    return try {
      connection.requestMethod = "POST"
      connection.connectTimeout = PRESENCE_HEARTBEAT_TIMEOUT_MS
      connection.readTimeout = PRESENCE_HEARTBEAT_TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { output -> writeUtf8(output, "{}") }
      val statusCode = connection.responseCode
      val body = readResponseBody(connection, statusCode)
      if (statusCode !in 200..299) {
        throw IllegalStateException(body.ifBlank { "Sidecar returned HTTP $statusCode" })
      }
      val payload = JSONObject(body)
      val responseWake = AndroidSyncPrimitives.parseWakeCapability(payload.optJSONObject("wake"))
      val hasWakePayload = payload.has("wake") && !payload.isNull("wake")
      val responseServerId = payload.optString("serverId").takeIf { it.isNotBlank() }
      if (!AndroidSyncPrimitives.presenceResponseMatchesBinding(binding.deviceId, responseServerId)) {
        recordDiagnosticsLog(
          "Presence",
          "heartbeat rejected host=${binding.host} status=$statusCode expectedServerId=${binding.deviceId} responseServerId=${responseServerId ?: "nil"} reason=${failureReason}_server_mismatch",
        )
        if (updateStateOnFailure) {
          updateBindingConnectionState(loadBinding(), "offline", reason = failureReason)
        }
        return false
      }

      refreshBindingMetadataFromPresence(binding.deviceId, binding.host, payload)
      val current = loadBinding()
      if (current != null && current.deviceId == binding.deviceId && current.connectionState != "connected") {
        updateBindingConnectionState(current, "connected", reason = successReason)
      }
      recordDiagnosticsLog(
        "Presence",
        "heartbeat succeeded host=${binding.host} status=$statusCode reason=$successReason hasWakePayload=$hasWakePayload ${wakeCapabilityLogSummary(responseWake)}",
      )
      true
    } catch (error: Throwable) {
      recordDiagnosticsLog(
        "Presence",
        "heartbeat failed host=${binding.host} reason=$failureReason error=${error.message ?: error.javaClass.simpleName}",
      )
      if (updateStateOnFailure) {
        updateBindingConnectionState(loadBinding(), "offline", reason = failureReason)
      }
      false
    } finally {
      connection.disconnect()
    }
  }

  private fun startPresenceRecoveryProbeIfNeeded(binding: StoredBinding) {
    if (!AndroidSyncPrimitives.shouldStartPresenceRecoveryAfterHeartbeatFailure(
        connectionState = binding.connectionState,
        syncInProgress = syncInProgress,
      )
    ) {
      return
    }
    val current = loadBinding() ?: return
    if (current.deviceId != binding.deviceId) {
      return
    }
    startPresenceRecoveryProbe(current)
  }

  private fun startPresenceRecoveryProbe(
    binding: StoredBinding,
    maxAttempts: Int = PRESENCE_RECOVERY_MAX_ATTEMPTS,
    retryIntervalMs: Long = PRESENCE_RECOVERY_INTERVAL_MS,
  ) {
    if (binding.connectionState != "connected") {
      return
    }
    cancelPresenceRecoveryProbe(reason = "start_new_probe")
    val current = loadBinding() ?: return
    if (current.deviceId != binding.deviceId) {
      return
    }
    val generation = synchronized(presenceRecoveryLock) {
      presenceRecoveryGeneration += 1
      presenceRecoveryGeneration
    }
    updateBindingConnectionState(current, "connecting", reason = "presence_recovery_started")
    recordDiagnosticsLog(
      "SyncEngine",
      "presence recovery probe started attempts=$maxAttempts interval=${retryIntervalMs / 1000.0}s",
    )
    performPresenceRecoveryProbe(
      deviceId = binding.deviceId,
      attempt = 1,
      maxAttempts = maxAttempts,
      retryIntervalMs = retryIntervalMs,
      generation = generation,
    )
  }

  private fun performPresenceRecoveryProbe(
    deviceId: String,
    attempt: Int,
    maxAttempts: Int,
    retryIntervalMs: Long,
    generation: Long,
  ) {
    if (!isPresenceRecoveryGenerationCurrent(generation)) {
      return
    }
    val binding = loadBinding()
    if (binding == null || binding.deviceId != deviceId) {
      cancelPresenceRecoveryProbe(reason = "stale_binding")
      return
    }

    recordDiagnosticsLog(
      "SyncEngine",
      "presence recovery attempt $attempt/$maxAttempts host=${binding.host}",
    )
    val succeeded = sendPresenceHeartbeat(
      binding = binding,
      successReason = "presence_recovery_succeeded",
      failureReason = "presence_recovery_failed",
      updateStateOnFailure = false,
    )
    if (succeeded) {
      cancelPresenceRecoveryProbe(reason = "heartbeat_succeeded")
      return
    }
    if (attempt >= maxAttempts) {
      cancelPresenceRecoveryProbe(reason = "exhausted")
      val current = loadBinding()
      if (current != null && current.deviceId == deviceId) {
        val updated = updateBindingConnectionState(current, "offline", reason = "presence_recovery_exhausted") ?: return
        restartDiscoveryAfterPresenceRecoveryExhausted(updated, reason = "presence_recovery_exhausted")
      }
      return
    }

    val future = presenceHeartbeatExecutor().schedule(
      {
        performPresenceRecoveryProbe(
          deviceId = deviceId,
          attempt = attempt + 1,
          maxAttempts = maxAttempts,
          retryIntervalMs = retryIntervalMs,
          generation = generation,
        )
      },
      retryIntervalMs,
      TimeUnit.MILLISECONDS,
    )
    synchronized(presenceRecoveryLock) {
      if (presenceRecoveryGeneration == generation) {
        presenceRecoveryFuture = future
      } else {
        future.cancel(false)
      }
    }
  }

  private fun cancelPresenceRecoveryProbe(reason: String) {
    val shouldLog = synchronized(presenceRecoveryLock) {
      presenceRecoveryGeneration += 1
      val future = presenceRecoveryFuture
      presenceRecoveryFuture = null
      future?.cancel(false)
      future != null || reason == "exhausted"
    }
    if (shouldLog) {
      recordDiagnosticsLog("SyncEngine", "presence recovery probe cancelled ($reason)")
    }
  }

  private fun isPresenceRecoveryGenerationCurrent(generation: Long): Boolean =
    synchronized(presenceRecoveryLock) { presenceRecoveryGeneration == generation }

  private fun refreshBindingMetadataFromPresence(
    expectedDeviceId: String,
    host: String,
    payload: JSONObject,
  ) {
    val current = loadBinding() ?: return
    if (current.deviceId != expectedDeviceId) {
      return
    }
    val serverName = payload.optString("serverName").takeIf { it.isNotBlank() }
    val shareName = payload.optString("shareName").takeIf { it.isNotBlank() }
    val hasWakePayload = payload.has("wake") && !payload.isNull("wake")
    val wake = AndroidSyncPrimitives.parseWakeCapability(payload.optJSONObject("wake"))
    if (hasWakePayload) {
      recordDiagnosticsLog(
        "SyncEngine",
        "presence metadata candidate host=$host ${wakeCapabilityLogSummary(wake)} existingWakeUsable=${current.wake?.hasUsableTargets == true}",
      )
    }
    val updated = current.copy(
      host = host,
      deviceName = serverName ?: current.deviceName,
      shareEnabled = shareName != null,
      shareName = shareName,
      wake = AndroidSyncPrimitives.mergeWakeCapability(wake, current.wake),
    )
    if (updated == current) {
      if (hasWakePayload) {
        recordDiagnosticsLog(
          "SyncEngine",
          "presence metadata unchanged host=$host ${wakeCapabilityLogSummary(wake)}",
        )
      }
      return
    }
    saveBinding(updated)
    emitBindingStateChanged(updated)
    recordDiagnosticsLog(
      "SyncEngine",
      "binding metadata refreshed from presence host=$host ${wakeCapabilityLogSummary(updated.wake)} shareEnabled=${updated.shareEnabled}",
    )
  }

  private fun refreshBindingReachability(binding: StoredBinding?): StoredBinding? {
    if (binding == null) {
      return null
    }
    if (!AndroidSyncPrimitives.shouldProbeBindingConnectionState(binding.connectionState, syncInProgress)) {
      return binding
    }

    val reachable = probeBindingReachability(binding)
    val nextState = AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
      currentState = binding.connectionState,
      reachable = reachable,
    )
    if (nextState == binding.connectionState) {
      return binding
    }
    recordDiagnosticsLog(
      "SyncEngine",
      "binding reachability corrected ${binding.connectionState} -> $nextState host=${binding.host}:${binding.port}",
    )
    return updateBindingConnectionState(binding, nextState)
  }

  private fun probeBindingReachability(binding: StoredBinding): Boolean {
    if (binding.host.isBlank() || binding.port <= 0) {
      return false
    }
    return try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(binding.host, binding.port), BINDING_PROBE_TIMEOUT_MS)
        true
      }
    } catch (error: Throwable) {
      recordDiagnosticsLog(
        "SyncEngine",
        "binding reachability probe failed host=${binding.host}:${binding.port} error=${error.message ?: error.javaClass.simpleName}",
      )
      false
    }
  }

  private fun isBindingConnected(binding: StoredBinding?): Boolean =
    binding?.connectionState == "connected"

  private fun retryLanReconnectInternal(allowWake: Boolean) {
    if (shouldRequestNearbyWifiPermission()) {
      recordNativeLog(
        "Discovery",
        "retryLanReconnect skipped discovery because nearby wifi permission is required",
        Log.WARN,
      )
    } else {
      startDiscoveryInternal()
    }

    val binding = loadBinding()
    if (binding == null) {
      recordDiagnosticsLog("SyncEngine", "retryLanReconnect skipped: no binding")
      return
    }
    if (canReachSidecarHealth(binding.host, BINDING_PROBE_TIMEOUT_MS)) {
      updateBindingConnectionState(binding, "connected", reason = "manual_lan_reconnect_succeeded")
      startForegroundSyncRound(reason = "manual_trigger", threadName = "NativeSyncEngineSync")
      return
    }
    if (!allowWake) {
      recordDiagnosticsLog("SyncEngine", "retryLanReconnect LAN host unavailable; wake disabled")
      return
    }
    if (attemptSharedFilesLANWakeIfNeeded(binding, "manual_lan_reconnect", allowPublicWake = false) != null) {
      sendPresenceHeartbeatAsync(binding, reason = "manual_lan_reconnect_presence", recoverOnFailure = false)
      startForegroundSyncRound(reason = "manual_trigger", threadName = "NativeSyncEngineSync")
    } else {
      recordDiagnosticsLog("SyncEngine", "retryLanReconnect wake did not recover LAN host")
    }
  }

  private fun AndroidSyncOverviewFields.toWritableMap(): WritableMap {
    return Arguments.createMap().apply {
      putString("currentDeviceId", currentDeviceId)
      putString("currentDeviceName", currentDeviceName)
      putDouble("currentSpeedMbps", currentSpeedMbps)
      putDouble("transferredBytes", transferredBytes)
      putDouble("totalBytes", totalBytes)
      putDouble("progressPercent", progressPercent)
      putString("uploadState", uploadState)
      putString("performanceHint", performanceHint)
      if (performanceMessage == null) {
        putNull("performanceMessage")
      } else {
        putString("performanceMessage", performanceMessage)
      }
      putString("thermalState", thermalState)
      putString("activeTuningProfile", activeTuningProfile)
      putBoolean("isThermalLimited", isThermalLimited)
      putDouble("completedCount", completedCount)
      putDouble("totalCount", totalCount)
      putDouble("completedBytes", completedBytes)
      putDouble("roundBaselineCompletedCount", roundBaselineCompletedCount)
      putDouble("roundBaselineCompletedBytes", roundBaselineCompletedBytes)
      if (currentFile == null) {
        putNull("currentFile")
      } else {
        putString("currentFile", currentFile)
      }
      if (currentFilename == null) {
        putNull("currentFilename")
      } else {
        putString("currentFilename", currentFilename)
      }
      putDouble("currentFileConfirmedBytes", currentFileConfirmedBytes)
      putDouble("currentFileTotalBytes", currentFileTotalBytes)
      putString("sessionId", sessionId)
      putString("state", state)
      if (retryAttempt == null) {
        putNull("retryAttempt")
      } else {
        putDouble("retryAttempt", retryAttempt)
      }
      if (retryDelaySec == null) {
        putNull("retryDelaySec")
      } else {
        putDouble("retryDelaySec", retryDelaySec)
      }
      if (lastErrorCode == null) {
        putNull("lastErrorCode")
      } else {
        putString("lastErrorCode", lastErrorCode)
      }
      if (lastErrorMessage == null) {
        putNull("lastErrorMessage")
      } else {
        putString("lastErrorMessage", lastErrorMessage)
      }
      if (currentTaskSource == null) {
        putNull("currentTaskSource")
      } else {
        putString("currentTaskSource", currentTaskSource)
      }
      if (lastCompletedTaskSource == null) {
        putNull("lastCompletedTaskSource")
      } else {
        putString("lastCompletedTaskSource", lastCompletedTaskSource)
      }
      putString("autoUploadState", autoUploadState)
      putDouble("manualPending", manualPending)
      putDouble("autoPending", autoPending)
    }
  }

  private fun AndroidSyncOverviewFields.toJson(): JSONObject =
    JSONObject().apply {
      put("currentDeviceId", currentDeviceId ?: JSONObject.NULL)
      put("currentDeviceName", currentDeviceName ?: JSONObject.NULL)
      put("currentSpeedMbps", currentSpeedMbps)
      put("transferredBytes", transferredBytes)
      put("totalBytes", totalBytes)
      put("progressPercent", progressPercent)
      put("uploadState", uploadState)
      put("performanceHint", performanceHint)
      put("performanceMessage", performanceMessage ?: JSONObject.NULL)
      put("thermalState", thermalState)
      put("activeTuningProfile", activeTuningProfile)
      put("isThermalLimited", isThermalLimited)
      put("completedCount", completedCount)
      put("totalCount", totalCount)
      put("completedBytes", completedBytes)
      put("roundBaselineCompletedCount", roundBaselineCompletedCount)
      put("roundBaselineCompletedBytes", roundBaselineCompletedBytes)
      put("currentFile", currentFile ?: JSONObject.NULL)
      put("currentFilename", currentFilename ?: JSONObject.NULL)
      put("currentFileConfirmedBytes", currentFileConfirmedBytes)
      put("currentFileTotalBytes", currentFileTotalBytes)
      put("sessionId", sessionId)
      put("state", state)
      put("retryAttempt", retryAttempt ?: JSONObject.NULL)
      put("retryDelaySec", retryDelaySec ?: JSONObject.NULL)
      put("lastErrorCode", lastErrorCode ?: JSONObject.NULL)
      put("lastErrorMessage", lastErrorMessage ?: JSONObject.NULL)
      put("currentTaskSource", currentTaskSource ?: JSONObject.NULL)
      put("lastCompletedTaskSource", lastCompletedTaskSource ?: JSONObject.NULL)
      put("autoUploadState", autoUploadState)
      put("manualPending", manualPending)
      put("autoPending", autoPending)
    }

  private fun loadBinding(): StoredBinding? {
    val raw = prefs.getString(PREF_BINDING, null) ?: return null
    return try {
      StoredBinding.fromJson(JSONObject(raw))
    } catch (_: Throwable) {
      null
    }
  }

  private fun saveBinding(binding: StoredBinding) {
    prefs.edit().putString(PREF_BINDING, binding.toJson().toString()).apply()
    rememberKnownDeviceId(binding.deviceId)
  }

  private fun clearBinding() {
    cancelPresenceRecoveryProbe(reason = "binding_cleared")
    stopPresenceHeartbeatTimer()
    clearSharedFilesReachability(reason = "binding_cleared")
    prefs.edit().remove(PREF_BINDING).apply()
  }

  private fun isoNow(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date())
  }

  private fun localLogTimestamp(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    formatter.timeZone = TimeZone.getDefault()
    return formatter.format(Date())
  }

  private fun diagnosticsArchiveTimestamp(): String {
    val formatter = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US)
    formatter.timeZone = TimeZone.getDefault()
    return formatter.format(Date())
  }

  private fun diagnosticsLogSnapshot(): List<String> =
    synchronized(diagnosticsLogLock) {
      diagnosticsLogLines.toList()
    }

  private fun dumpDiagnosticsLogSnapshotToConsole(lines: List<String>) {
    if (lines.isEmpty()) {
      Log.d(
        MODULE_NAME,
        AndroidSyncPrimitives.buildConsoleLogMessage(
          localLogTimestamp(),
          "Diagnostics",
          "engine.log snapshot is empty at export time",
        ),
      )
      return
    }

    Log.d(
      MODULE_NAME,
      AndroidSyncPrimitives.buildConsoleLogMessage(
        localLogTimestamp(),
        "Diagnostics",
        "engine.log snapshot begin (${lines.size} lines)",
      ),
    )
    for (line in lines) {
      Log.d(
        MODULE_NAME,
        AndroidSyncPrimitives.buildConsoleLogMessage(localLogTimestamp(), "DiagnosticsLog", line),
      )
    }
    Log.d(
      MODULE_NAME,
      AndroidSyncPrimitives.buildConsoleLogMessage(
        localLogTimestamp(),
        "Diagnostics",
        "engine.log snapshot end",
      ),
    )
  }

  private fun getKnownDeviceIdsValue(): List<String> {
    val ids = mutableSetOf<String>()
    val storedIds = prefs.getStringSet(PREF_KNOWN_DEVICE_IDS, emptySet()) ?: emptySet()
    for (storedId in storedIds) {
      storedId.trim().takeIf { it.isNotBlank() }?.let(ids::add)
    }
    loadBinding()?.deviceId?.trim()?.takeIf { it.isNotBlank() }?.let(ids::add)
    return ids.sorted()
  }

  private fun rememberKnownDeviceId(deviceId: String) {
    val normalized = deviceId.trim()
    if (normalized.isBlank()) {
      return
    }

    val updated = getKnownDeviceIdsValue().toMutableSet()
    updated.add(normalized)
    prefs.edit().putStringSet(PREF_KNOWN_DEVICE_IDS, updated).apply()
  }

  private fun loadAutoUploadConfig(): AutoUploadConfig {
    return AutoUploadConfig(
      enabled = prefs.getBoolean(PREF_AUTO_UPLOAD_ENABLED, false),
      state = prefs.getString(PREF_AUTO_UPLOAD_STATE, "disabled")
        ?.takeIf { it.isNotBlank() }
        ?: "disabled",
      timeRangeMode = prefs.getString(PREF_AUTO_UPLOAD_TIME_RANGE_MODE, "all")
        ?.takeIf { it.isNotBlank() }
        ?: "all",
      customTimeFrom = prefs.getString(PREF_AUTO_UPLOAD_CUSTOM_TIME_FROM, null)
        ?.takeIf { it.isNotBlank() },
    )
  }

  private fun buildAutoUploadConfigMap(): WritableMap {
    val config = loadAutoUploadConfig()
    return Arguments.createMap().apply {
      putBoolean("enabled", config.enabled)
      putString("state", config.state)
      putString("timeRangeMode", config.timeRangeMode)
      if (config.customTimeFrom.isNullOrBlank()) {
        putNull("customTimeFrom")
      } else {
        putString("customTimeFrom", config.customTimeFrom)
      }
    }
  }

  private fun saveAutoUploadConfig(config: AutoUploadConfig) {
    val editor = prefs.edit()
      .putBoolean(PREF_AUTO_UPLOAD_ENABLED, config.enabled)
      .putString(PREF_AUTO_UPLOAD_STATE, config.state)
      .putString(PREF_AUTO_UPLOAD_TIME_RANGE_MODE, config.timeRangeMode)

    if (config.customTimeFrom.isNullOrBlank()) {
      editor.remove(PREF_AUTO_UPLOAD_CUSTOM_TIME_FROM)
    } else {
      editor.putString(PREF_AUTO_UPLOAD_CUSTOM_TIME_FROM, config.customTimeFrom)
    }
    editor.apply()
  }

  private fun persistAutoUploadInterruptedState() {
    val config = loadAutoUploadConfig()
    saveAutoUploadConfig(config.copy(enabled = true, state = "interrupted"))
  }

  private fun persistAutoUploadDisabledState() {
    val config = loadAutoUploadConfig()
    saveAutoUploadConfig(config.copy(enabled = false, state = "disabled"))
  }

  private fun persistAutoUploadActiveState() {
    val config = loadAutoUploadConfig()
    saveAutoUploadConfig(config.copy(enabled = true, state = "active"))
  }

  private fun ReadableMap.getStringOrNull(key: String): String? {
    return if (hasKey(key) && !isNull(key)) {
      getString(key)
    } else {
      null
    }
  }

  private fun readableMapToStringMap(map: ReadableMap?): Map<String, String> {
    if (map == null) {
      return emptyMap()
    }

    val result = mutableMapOf<String, String>()
    val iterator = map.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      if (!map.isNull(key)) {
        result[key] = map.getString(key).orEmpty()
      }
    }
    return result
  }

  private fun performDiagnosticsArchiveUpload(
    uploadUrl: String,
    archivePath: String,
    note: String,
    headers: Map<String, String>,
  ): WritableMap {
    if (uploadUrl.isBlank()) {
      throw NativeBridgeException("INVALID_UPLOAD_URL", "Missing diagnostics upload URL")
    }

    val archive = diagnosticsArchiveFileFromPath(archivePath)
    if (!archive.isFile) {
      throw NativeBridgeException("FILE_NOT_FOUND", "Diagnostics archive does not exist")
    }

    val boundary = "syncflow-${UUID.randomUUID()}"
    val connection = URL(uploadUrl).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.doOutput = true
      connection.connectTimeout = DIAGNOSTICS_UPLOAD_TIMEOUT_MS
      connection.readTimeout = DIAGNOSTICS_UPLOAD_TIMEOUT_MS
      connection.setChunkedStreamingMode(0)

      for ((key, value) in headers) {
        if (!key.equals("Content-Type", ignoreCase = true) && key.isNotBlank()) {
          connection.setRequestProperty(key, value)
        }
      }
      connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      diagnosticsUploadLog(
        "started url=$uploadUrl archive=${archive.name} bytes=${archive.length()} noteLen=${note.length}",
      )

      BufferedOutputStream(connection.outputStream).use { output ->
        writeMultipartField(output, boundary, "client_id", getOrCreateClientId())
        writeMultipartField(output, boundary, "platform", "android")
        if (note.isNotBlank()) {
          writeMultipartField(output, boundary, "note", note)
        }
        writeMultipartFile(output, boundary, "bundle", archive)
        writeUtf8(output, "--$boundary--\r\n")
      }

      val statusCode = connection.responseCode
      val responseBody = readResponseBody(connection, statusCode)
      diagnosticsUploadLog(
        "completed status=$statusCode responseBytes=${responseBody.toByteArray(StandardCharsets.UTF_8).size}",
      )

      if (statusCode == HttpURLConnection.HTTP_ENTITY_TOO_LARGE) {
        throw NativeBridgeException("BUNDLE_TOO_LARGE", "Diagnostics bundle too large")
      }
      if (statusCode != HttpURLConnection.HTTP_OK) {
        throw NativeBridgeException(
          "SERVER_ERROR",
          responseBody.takeIf { it.isNotBlank() } ?: "Diagnostics upload failed with HTTP $statusCode",
        )
      }

      val json = JSONObject(responseBody)
      val refId = json.optString("ref_id").takeIf { it.isNotBlank() }
        ?: throw NativeBridgeException("SERVER_ERROR", "Diagnostics upload response missing ref_id")
      val uploadedAt = json.optString("uploaded_at").takeIf { it.isNotBlank() }
        ?: throw NativeBridgeException("SERVER_ERROR", "Diagnostics upload response missing uploaded_at")

      return Arguments.createMap().apply {
        putString("ref_id", refId)
        putString("uploaded_at", uploadedAt)
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun diagnosticsArchiveFileFromPath(rawPath: String): File {
    val normalized = rawPath.trim()
    if (normalized.startsWith("file://")) {
      return File(Uri.parse(normalized).path.orEmpty())
    }
    return File(normalized)
  }

  private fun writeDiagnosticsArchive(
    archive: File,
    diagnosticsPayload: JSONObject,
    queuePayload: JSONArray,
    historyPayload: JSONObject,
    engineLogLines: List<String>,
  ) {
    AndroidSyncPrimitives.writeZipArchive(
      archive,
      AndroidSyncPrimitives.buildDiagnosticsArchiveEntries(
        diagnosticsJson = diagnosticsPayload.toString(2),
        queueJson = queuePayload.toString(2),
        historyJson = historyPayload.toString(2),
        engineLogLines = engineLogLines,
      ),
    )
  }

  private fun diagnosticsUploadLog(message: String) {
    recordNativeLog("DiagnosticsUpload", message)
  }

  private fun writeMultipartField(
    output: OutputStream,
    boundary: String,
    name: String,
    value: String,
  ) {
    writeUtf8(output, "--$boundary\r\n")
    writeUtf8(output, "Content-Disposition: form-data; name=\"$name\"\r\n\r\n")
    writeUtf8(output, value)
    writeUtf8(output, "\r\n")
  }

  private fun writeMultipartFile(
    output: OutputStream,
    boundary: String,
    name: String,
    file: File,
  ) {
    writeUtf8(output, "--$boundary\r\n")
    writeUtf8(
      output,
      "Content-Disposition: form-data; name=\"$name\"; filename=\"${file.name}\"\r\n",
    )
    writeUtf8(output, "Content-Type: application/zip\r\n\r\n")
    BufferedInputStream(file.inputStream()).use { input ->
      input.copyTo(output)
    }
    writeUtf8(output, "\r\n")
  }

  private fun writeUtf8(output: OutputStream, value: String) {
    output.write(value.toByteArray(StandardCharsets.UTF_8))
  }

  private fun readResponseBody(
    connection: HttpURLConnection,
    statusCode: Int,
  ): String {
    val stream = if (statusCode in 200..399) {
      connection.inputStream
    } else {
      connection.errorStream
    } ?: return ""

    return stream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
  }

  private val prefs
    get() = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun stopDiscoveryInternal(emitUpdate: Boolean) {
    synchronized(discoveryLock) {
      stopDiscoveryLocked()
    }
    if (emitUpdate) {
      emitDiscoveredDevicesChanged()
    }
  }

  private fun stopDiscoveryLocked() {
    discoveryGeneration += 1
    val manager = nsdManager
    val listener = discoveryListener
    if (manager != null && listener != null) {
      try {
        manager.stopServiceDiscovery(listener)
      } catch (_: IllegalArgumentException) {
        // Listener may not be registered yet or already stopped.
      } catch (_: Throwable) {
        // Ignore discovery cleanup failures.
      }
    }
    discoveryListener = null
    pendingResolveKeys.clear()
    discoveredCandidates.clear()
    reachableCandidates.clear()
    releaseMulticastLockLocked()
  }

  private fun createDiscoveryListener(
    manager: NsdManager,
    generation: Long,
  ): NsdManager.DiscoveryListener {
    return object : NsdManager.DiscoveryListener {
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        handleDiscoveryFailure(
          generation = generation,
          code = "ANDROID_DISCOVERY_START_FAILED",
          message = "Android 局域网发现启动失败（$errorCode）",
        )
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        handleDiscoveryFailure(
          generation = generation,
          code = "ANDROID_DISCOVERY_STOP_FAILED",
          message = "Android 局域网发现停止失败（$errorCode）",
        )
      }

      override fun onDiscoveryStarted(serviceType: String) {
        recordNativeLog("Discovery", "discovery started serviceType=$serviceType")
      }

      override fun onDiscoveryStopped(serviceType: String) {
        recordNativeLog("Discovery", "discovery stopped serviceType=$serviceType")
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        if (!isTargetServiceType(serviceInfo.serviceType)) {
          return
        }
        recordNativeLog(
          "Discovery",
          "service found name=${serviceInfo.serviceName} type=${serviceInfo.serviceType}",
        )
        resolveService(manager, generation, serviceInfo)
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        recordNativeLog("Discovery", "service lost name=${serviceInfo.serviceName} type=${serviceInfo.serviceType}")
        val serviceKey = serviceKeyFor(serviceInfo)
        val shouldEmit = synchronized(discoveryLock) {
          if (generation != discoveryGeneration) {
            recordNativeLog(
              "Discovery",
              "service lost ignored stale generation probeGeneration=$generation currentGeneration=$discoveryGeneration",
            )
            return@synchronized false
          }
          pendingResolveKeys.remove(serviceKey)
          discoveredCandidates.remove(serviceKey)
          reachableCandidates.remove(serviceKey) != null
        }
        if (shouldEmit) {
          emitReachableDevices()
        }
      }
    }
  }

  private fun handleDiscoveryFailure(
    generation: Long,
    code: String,
    message: String,
  ) {
    synchronized(discoveryLock) {
      if (generation != discoveryGeneration) {
        return
      }
      stopDiscoveryLocked()
    }
    recordNativeLog("Discovery", "$code: $message", Log.WARN)
    emitDiscoveredDevicesChanged()
    emitError(code = code, message = message)
  }

  private fun resolveService(
    manager: NsdManager,
    generation: Long,
    serviceInfo: NsdServiceInfo,
  ) {
    val serviceKey = serviceKeyFor(serviceInfo)
    val shouldResolve = synchronized(discoveryLock) {
      if (generation != discoveryGeneration) {
        recordNativeLog(
          "Discovery",
          "resolve ignored stale generation name=${serviceInfo.serviceName} probeGeneration=$generation currentGeneration=$discoveryGeneration",
        )
        return@synchronized false
      }
      pendingResolveKeys.add(serviceKey)
    }

    if (!shouldResolve) {
      return
    }

    try {
      manager.resolveService(
        serviceInfo,
        object : NsdManager.ResolveListener {
          override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            synchronized(discoveryLock) {
              pendingResolveKeys.remove(serviceKey)
            }
            recordNativeLog(
              "Discovery",
              "resolve failed name=${serviceInfo.serviceName} errorCode=$errorCode",
              Log.WARN,
            )
          }

          override fun onServiceResolved(resolvedServiceInfo: NsdServiceInfo) {
            val candidate = buildDiscoveredCandidate(resolvedServiceInfo, serviceKey)
            recordNativeLog(
              "Discovery",
              "resolved name=${candidate.name} host=${candidate.ip} probeHost=${candidate.probeHost} port=${candidate.port}",
            )
            synchronized(discoveryLock) {
              pendingResolveKeys.remove(serviceKey)
              if (generation != discoveryGeneration) {
                recordNativeLog(
                  "Discovery",
                  "resolved ignored stale generation name=${candidate.name} probeGeneration=$generation currentGeneration=$discoveryGeneration",
                )
                return
              }
              discoveredCandidates[serviceKey] = candidate
            }
            refreshBoundPresenceFromDiscoveryCandidate(
              candidate = candidate,
              reason = "bound_device_discovery_resolved",
            )
            probeReachability(candidate, generation)
          }
        },
      )
    } catch (error: Throwable) {
      synchronized(discoveryLock) {
        pendingResolveKeys.remove(serviceKey)
      }
      recordNativeLog(
        "Discovery",
        "resolve submit failed name=${serviceInfo.serviceName}: ${error.message ?: error.javaClass.simpleName}",
        Log.WARN,
      )
    }
  }

  private fun buildDiscoveredCandidate(
    serviceInfo: NsdServiceInfo,
    serviceKey: String,
  ): DiscoveredServiceCandidate {
    val attributes = parseTxtAttributes(serviceInfo)
    val resolvedHost = serviceInfo.host?.hostAddress.orEmpty()
    val advertisedIp = attributes["ip"].orEmpty()
    val initialIp = preferredDisplayHost(advertisedIp, resolvedHost)
    val probeHost = preferredProbeHost(advertisedIp, resolvedHost)
    val serviceName = serviceInfo.serviceName.takeIf { it.isNotBlank() } ?: "SyncFlow Desktop"

    return DiscoveredServiceCandidate(
      serviceKey = serviceKey,
      deviceId = attributes["id"]?.takeIf { it.isNotBlank() } ?: serviceName,
      name = attributes["name"]?.takeIf { it.isNotBlank() } ?: serviceName,
      type = when (attributes["type"]) {
        "win" -> "win"
        else -> "mac"
      },
      ip = initialIp,
      probeHost = probeHost,
      port = serviceInfo.port.takeIf { it > 0 } ?: DEFAULT_PROTOCOL_PORT,
      protoVersion = attributes["proto"]?.toIntOrNull() ?: PROTOCOL_VERSION,
      authMode = attributes["auth"]?.takeIf { it == "code" } ?: "code",
      shareEnabled = attributes["share"] == "1",
      shareName = attributes["shareName"]?.takeIf { it.isNotBlank() },
      lastSeenAt = isoNow(),
    )
  }

  private fun probeReachability(
    candidate: DiscoveredServiceCandidate,
    generation: Long,
  ) {
    if (candidate.probeHost.isBlank()) {
      val shouldEmit = synchronized(discoveryLock) {
        if (generation != discoveryGeneration) {
          recordNativeLog(
            "Discovery",
            "probe skipped blank host ignored stale generation name=${candidate.name} probeGeneration=$generation currentGeneration=$discoveryGeneration",
          )
          return@synchronized false
        }
        reachableCandidates.remove(candidate.serviceKey) != null
      }
      if (shouldEmit) {
        emitReachableDevices()
      }
      return
    }

    recordNativeLog(
      "Discovery",
      "probe start name=${candidate.name} host=${candidate.probeHost} port=${candidate.port} generation=$generation",
    )
    thread(name = "NativeSyncEngineDiscoveryProbe", isDaemon = true) {
      try {
        var reachableForRefresh: DiscoveredServiceCandidate? = null
        var shouldEmit = false
        Socket().use { socket ->
          socket.connect(
            InetSocketAddress(candidate.probeHost, candidate.port),
            DISCOVERY_PROBE_TIMEOUT_MS,
          )
          socket.soTimeout = DISCOVERY_PROBE_TIMEOUT_MS
          recordNativeLog(
            "Discovery",
            "probe connect success name=${candidate.name} host=${candidate.probeHost} port=${candidate.port} generation=$generation",
          )

          val probedHost = socket.inetAddress?.hostAddress.orEmpty()
          synchronized(discoveryLock) {
            val latestCandidate = discoveredCandidates[candidate.serviceKey]
            val latestCandidateMatchesProbeEndpoint = latestCandidate?.let {
              it.probeHost == candidate.probeHost && it.port == candidate.port
            } == true
            val resolution = AndroidSyncPrimitives.resolveDiscoveryProbeCandidate(
              probeGeneration = generation,
              currentGeneration = discoveryGeneration,
              hasOriginalCandidate = generation == discoveryGeneration && latestCandidate != null,
              latestCandidateMatchesProbeEndpoint = latestCandidateMatchesProbeEndpoint,
            )
            val selectedCandidate = when (resolution) {
              AndroidDiscoveryProbeResolution.CURRENT_CANDIDATE -> latestCandidate ?: candidate
              AndroidDiscoveryProbeResolution.LATEST_CANDIDATE -> {
                recordNativeLog(
                  "Discovery",
                  "probe stale generation reused latest candidate name=${latestCandidate?.name ?: candidate.name} probeGeneration=$generation currentGeneration=$discoveryGeneration",
                )
                latestCandidate
              }
              AndroidDiscoveryProbeResolution.IGNORE_STALE_GENERATION -> {
                recordNativeLog(
                  "Discovery",
                  "probe ignored stale generation name=${candidate.name} probeGeneration=$generation currentGeneration=$discoveryGeneration latestEndpointMatches=$latestCandidateMatchesProbeEndpoint",
                )
                null
              }
              AndroidDiscoveryProbeResolution.IGNORE_MISSING_CANDIDATE -> {
                recordNativeLog(
                  "Discovery",
                  "probe ignored missing candidate name=${candidate.name} generation=$generation",
                )
                null
              }
            }
            if (selectedCandidate == null) {
              return@synchronized
            }
            val resolvedIp = preferredDisplayHost(selectedCandidate.ip, probedHost)
            val reachable = selectedCandidate.copy(
              ip = resolvedIp,
              lastSeenAt = isoNow(),
            )
            reachableCandidates[candidate.serviceKey] = reachable
            reachableForRefresh = reachable
            shouldEmit = true
            recordNativeLog(
              "Discovery",
              "probe stored reachable name=${reachable.name} reachableCount=${reachableCandidates.size}",
            )
          }
        }
        val reachable = reachableForRefresh
        if (reachable != null) {
          recordNativeLog("Discovery", "reachable ${reachable.name} via ${reachable.probeHost}")
          refreshBoundBindingFromDiscoveryCandidate(reachable)
        }
        if (shouldEmit) {
          emitReachableDevices()
        }
      } catch (error: Throwable) {
        recordNativeLog(
          "Discovery",
          "reachability failed ${candidate.name} via ${candidate.probeHost}: ${error.javaClass.simpleName} ${error.message.orEmpty()}",
          Log.WARN,
        )
        val shouldEmit = synchronized(discoveryLock) {
          if (generation != discoveryGeneration) {
            recordNativeLog(
              "Discovery",
              "probe failure ignored stale generation name=${candidate.name} probeGeneration=$generation currentGeneration=$discoveryGeneration",
            )
            return@synchronized false
          }
          reachableCandidates.remove(candidate.serviceKey) != null
        }
        if (shouldEmit) {
          emitReachableDevices()
        }
      }
    }
  }

  private fun scheduleSubnetDiscoveryFallback(generation: Long) {
    thread(name = "NativeSyncEngineDiscoveryFallback", isDaemon = true) {
      var delayMs = DISCOVERY_FALLBACK_DELAY_MS
      while (true) {
        try {
          Thread.sleep(delayMs)
        } catch (_: InterruptedException) {
          return@thread
        }

        val shouldScan = synchronized(discoveryLock) {
          if (generation != discoveryGeneration) {
            return@thread
          }
          reachableCandidates.isEmpty()
        }
        if (!shouldScan) {
          return@thread
        }

        runSubnetDiscoveryFallback(generation)
        delayMs = DISCOVERY_FALLBACK_RETRY_INTERVAL_MS
      }
    }
  }

  private fun runSubnetDiscoveryFallback(generation: Long) {
    val network = currentClientIPv4Network()
    if (network == null) {
      recordNativeLog("Discovery", "fallback skipped: no IPv4 network", Log.WARN)
      return
    }

    val hosts = AndroidSyncPrimitives.buildSubnetProbeHosts(
      clientIp = network.address,
      prefixLength = network.prefixLength,
      maxHosts = DISCOVERY_FALLBACK_MAX_HOSTS,
    )
    if (hosts.isEmpty()) {
      recordNativeLog(
        "Discovery",
        "fallback skipped: unsupported subnet ip=${network.address} prefix=${network.prefixLength}",
        Log.WARN,
      )
      return
    }

    recordNativeLog(
      "Discovery",
      "fallback probing ${hosts.size} hosts from ${network.address}/${network.prefixLength}",
    )
    val latch = CountDownLatch(hosts.size)
    val executor = Executors.newFixedThreadPool(DISCOVERY_FALLBACK_CONCURRENCY)
    for (host in hosts) {
      executor.execute {
        try {
          val candidate = probeFallbackHost(host)
          if (candidate != null) {
            val shouldEmit = synchronized(discoveryLock) {
              val hasBonjourCandidate = reachableCandidates.values.any {
                !it.serviceKey.startsWith(FALLBACK_SERVICE_KEY_PREFIX)
              }
              if (generation != discoveryGeneration || hasBonjourCandidate) {
                recordNativeLog(
                  "Discovery",
                  "fallback reachable ignored host=$host staleGeneration=${generation != discoveryGeneration} hasBonjourCandidate=$hasBonjourCandidate reachableCount=${reachableCandidates.size}",
                )
                return@synchronized false
              }
              discoveredCandidates[candidate.serviceKey] = candidate
              reachableCandidates[candidate.serviceKey] = candidate
              recordNativeLog(
                "Discovery",
                "fallback stored reachable host=$host reachableCount=${reachableCandidates.size}",
              )
              true
            }
            if (shouldEmit) {
              recordNativeLog("Discovery", "fallback reachable ${candidate.name} via $host")
              refreshBoundBindingFromDiscoveryCandidate(candidate)
              emitReachableDevices()
            }
          }
        } finally {
          latch.countDown()
        }
      }
    }

    try {
      latch.await(DISCOVERY_FALLBACK_SCAN_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
      // Stop waiting; executor shutdown below will cancel queued probes.
    } finally {
      executor.shutdownNow()
    }
  }

  private fun probeFallbackHost(host: String): DiscoveredServiceCandidate? {
    val url = URL("http", host, DEFAULT_SIDECAR_HTTP_PORT, "/health")
    val connection = (url.openConnection() as? HttpURLConnection) ?: return null
    return try {
      connection.requestMethod = "GET"
      connection.connectTimeout = DISCOVERY_FALLBACK_HTTP_TIMEOUT_MS
      connection.readTimeout = DISCOVERY_FALLBACK_HTTP_TIMEOUT_MS
      val status = connection.responseCode
      if (status !in 200..299) {
        return null
      }
      val body = readResponseBody(connection, status)
      val json = JSONObject(body)
      if (!json.optBoolean("ok", false) || json.optString("service") != "syncflow-sidecar") {
        return null
      }
      val helloResponse = readFallbackHello(host)
      AndroidSyncPrimitives.requireCompatibleDesktopAppVersion(
        helloResponse.optInt("appCompatibilityVersion", -1),
      )
      val serverCapabilities = helloResponse.optJSONObject("serverCapabilities")
      val serverId = helloResponse.optString("serverId")
        .takeIf { it.isNotBlank() }
        ?: "fallback-$host"
      val serverName = AndroidSyncPrimitives.fallbackDiscoveryName(
        serverName = helloResponse.optString("serverName"),
        host = host,
      )
      val shareName = serverCapabilities?.optString("shareName")
        ?.takeIf { it.isNotBlank() }
      val now = isoNow()
      DiscoveredServiceCandidate(
        serviceKey = "$FALLBACK_SERVICE_KEY_PREFIX$host",
        deviceId = serverId,
        name = serverName,
        type = "mac",
        ip = host,
        probeHost = host,
        port = DEFAULT_PROTOCOL_PORT,
        protoVersion = PROTOCOL_VERSION,
        authMode = "code",
        shareEnabled = shareName != null,
        shareName = shareName,
        lastSeenAt = now,
      )
    } catch (_: Throwable) {
      null
    } finally {
      connection.disconnect()
    }
  }

  private fun readFallbackHello(host: String): JSONObject {
    Socket().use { socket ->
      socket.connect(
        InetSocketAddress(host, DEFAULT_PROTOCOL_PORT),
        DISCOVERY_FALLBACK_HELLO_TIMEOUT_MS,
      )
      socket.soTimeout = DISCOVERY_FALLBACK_HELLO_TIMEOUT_MS

      val input = DataInputStream(socket.getInputStream())
      val output = DataOutputStream(socket.getOutputStream())
      val payload = JSONObject(
        AndroidSyncPrimitives.buildClientHelloPayloadFields(
          clientId = getOrCreateClientId(),
          clientName = getClientDisplayNameValue(),
          clientPlatform = "android",
          appVersion = getVersionName(),
          appState = "active",
          stableDeviceId = getOrCreateStableDeviceId(),
          clientIp = currentClientIPv4(),
        ),
      )
      writeJsonFrame(output, TYPE_HELLO_REQ, payload)
      return readJsonFrame(input, TYPE_HELLO_RES)
    }
  }

  private fun emitReachableDevices() {
    val snapshot = synchronized(discoveryLock) {
      val payload = buildReachableDevicesPayloadLocked()
      payload to reachableCandidates.size
    }
    recordNativeLog(
      "Discovery",
      "emit reachable devices reachableCount=${snapshot.second} emittedCount=${snapshot.first.size()}",
    )
    emitDiscoveredDevicesChanged(snapshot.first)
  }

  private fun buildReachableDevicesPayloadLocked(): WritableArray {
    val latestByDeviceId = linkedMapOf<String, DiscoveredServiceCandidate>()
    for (candidate in reachableCandidates.values) {
      val existing = latestByDeviceId[candidate.deviceId]
      if (existing == null || candidate.lastSeenAt > existing.lastSeenAt) {
        latestByDeviceId[candidate.deviceId] = candidate
      }
    }

    val sorted = latestByDeviceId.values.sortedWith(
      compareBy<DiscoveredServiceCandidate>(
        { it.name.lowercase(Locale.US) },
        { it.deviceId.lowercase(Locale.US) },
      ),
    )

    return Arguments.createArray().apply {
      for (candidate in sorted) {
        pushMap(candidate.toWritableMap())
      }
    }
  }

  private fun refreshBoundBindingFromDiscoveryCandidate(candidate: DiscoveredServiceCandidate) {
    val binding = loadBinding() ?: return
    if (binding.deviceId != candidate.deviceId) {
      return
    }

    val nextState = AndroidSyncPrimitives.deriveBindingConnectionStateFromProbe(
      currentState = binding.connectionState,
      reachable = true,
    )
    val nextHost = candidate.ip.takeIf { it.isNotBlank() } ?: binding.host
    val nextPort = candidate.port.takeIf { it > 0 } ?: binding.port
    val updated = binding.copy(
      host = nextHost,
      port = nextPort,
      deviceName = candidate.name.takeIf { it.isNotBlank() } ?: binding.deviceName,
      shareEnabled = candidate.shareEnabled,
      shareName = candidate.shareName,
      connectionState = nextState,
    )
    if (updated == binding) {
      return
    }

    recordNativeLog(
      "SyncEngine",
      "bound device discovery refreshed ${binding.connectionState} -> ${updated.connectionState} host=${binding.host}:${binding.port} -> ${updated.host}:${updated.port}",
    )
    saveBinding(updated)
    emitBindingStateChanged(updated)
    if (!syncInProgress) {
      emitIdleSyncState(updated)
    }
    if (updated.connectionState == "connected") {
      cancelPresenceRecoveryProbe(reason = "discovery_refreshed_connected")
      sendPresenceHeartbeatAsync(updated, reason = "bound_device_discovery_refreshed", recoverOnFailure = true)
      startPresenceHeartbeatTimer(updated)
      wakeManualUploadAfterDiscoveryReconnectIfNeeded(
        previousConnectionState = binding.connectionState,
        updatedBinding = updated,
        reason = "bound_device_discovery_refreshed",
      )
    }
  }

  private fun refreshBoundPresenceFromDiscoveryCandidate(
    candidate: DiscoveredServiceCandidate,
    reason: String,
  ) {
    val binding = loadBinding() ?: return
    if (!AndroidSyncPrimitives.shouldRefreshBoundPresenceFromDiscovery(
        bindingDeviceId = binding.deviceId,
        candidateDeviceId = candidate.deviceId,
        connectionState = binding.connectionState,
      )
    ) {
      return
    }

    val nextHost = candidate.ip.takeIf { it.isNotBlank() } ?: binding.host
    val nextPort = candidate.port.takeIf { it > 0 } ?: binding.port
    val updated = binding.copy(
      host = nextHost,
      port = nextPort,
      deviceName = candidate.name.takeIf { it.isNotBlank() } ?: binding.deviceName,
      shareEnabled = candidate.shareEnabled,
      shareName = candidate.shareName,
    )
    if (updated != binding) {
      recordNativeLog(
        "SyncEngine",
        "bound device discovery metadata refreshed state=${binding.connectionState} host=${binding.host}:${binding.port} -> ${updated.host}:${updated.port}",
      )
      saveBinding(updated)
      emitBindingStateChanged(updated)
      emitIdleSyncState(updated)
    }

    recordDiagnosticsLog(
      "SyncEngine",
      "bound device discovery triggered presence refresh state=${updated.connectionState} host=${updated.host}",
    )
    sendPresenceHeartbeatAsync(updated, reason = reason, recoverOnFailure = false)
  }

  private fun restartDiscoveryAfterPresenceRecoveryExhausted(
    binding: StoredBinding,
    reason: String,
  ) {
    if (!AndroidSyncPrimitives.shouldRestartDiscoveryAfterPresenceRecoveryExhausted(
        bindingDeviceId = binding.deviceId,
        connectionState = binding.connectionState,
        reason = reason,
      )
    ) {
      return
    }

    if (shouldRequestNearbyWifiPermission()) {
      recordNativeLog(
        "Discovery",
        "presence recovery exhausted but nearby wifi permission is required; discovery restart skipped",
        Log.WARN,
      )
      return
    }

    val restarted = startDiscoveryInternal()
    if (restarted) {
      recordDiagnosticsLog(
        "Discovery",
        "presence recovery exhausted restarted discovery deviceId=${binding.deviceId}",
      )
    }
  }

  private fun parseTxtAttributes(serviceInfo: NsdServiceInfo): Map<String, String> {
    val attributes = mutableMapOf<String, String>()
    for ((key, value) in serviceInfo.attributes) {
      attributes[key] = value?.toString(StandardCharsets.UTF_8).orEmpty()
    }
    return attributes
  }

  private fun serviceKeyFor(serviceInfo: NsdServiceInfo): String {
    val serviceType = normalizeServiceType(serviceInfo.serviceType)
    return "${serviceInfo.serviceName}|$serviceType"
  }

  private fun normalizeServiceType(serviceType: String): String {
    var normalized = serviceType.trim().lowercase(Locale.US)
    while (normalized.endsWith(".")) {
      normalized = normalized.dropLast(1)
    }
    normalized = normalized.removeSuffix(".local")
    while (normalized.endsWith(".")) {
      normalized = normalized.dropLast(1)
    }
    return normalized
  }

  private fun isTargetServiceType(serviceType: String): Boolean {
    val normalized = normalizeServiceType(serviceType)
    return normalized.isEmpty() || normalized == BONJOUR_SERVICE_TYPE
  }

  private fun acquireMulticastLockLocked() {
    if (multicastLock?.isHeld == true) {
      return
    }

    val wifiManager = reactApplicationContext.applicationContext
      .getSystemService(Context.WIFI_SERVICE) as? WifiManager
      ?: return

    try {
      multicastLock = wifiManager.createMulticastLock("syncflow:discovery").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (error: SecurityException) {
      recordNativeLog(
        "Discovery",
        "multicast lock denied: ${error.message ?: error.javaClass.simpleName}",
        Log.WARN,
      )
    }
  }

  private fun releaseMulticastLockLocked() {
    try {
      if (multicastLock?.isHeld == true) {
        multicastLock?.release()
      }
    } catch (_: Throwable) {
      // Ignore multicast cleanup failures.
    } finally {
      multicastLock = null
    }
  }

  private fun shouldRequestNearbyWifiPermission(): Boolean =
    AndroidSyncPrimitives.shouldRequestNearbyWifiPermission(
      sdkInt = Build.VERSION.SDK_INT,
      permissionGranted = reactApplicationContext.checkSelfPermission(
        Manifest.permission.NEARBY_WIFI_DEVICES,
      ) == PackageManager.PERMISSION_GRANTED,
    )

  private fun preferredProbeHost(advertisedIp: String, resolvedHost: String): String {
    if (isIPv4Address(advertisedIp)) {
      return advertisedIp
    }
    return resolvedHost
  }

  private fun preferredDisplayHost(primaryHost: String, fallbackHost: String): String {
    if (isIPv4Address(fallbackHost)) {
      return fallbackHost
    }
    if (isIPv4Address(primaryHost)) {
      return primaryHost
    }
    if (fallbackHost.isNotBlank()) {
      return fallbackHost
    }
    return primaryHost
  }

  private fun isIPv4Address(host: String): Boolean {
    return host.isNotEmpty() &&
      host.matches(Regex("^\\d{1,3}(?:\\.\\d{1,3}){3}$"))
  }

  private data class JsonFrame(
    val type: Int,
    val payload: JSONObject,
  )

  private class ProtocolConnection(
    private val socket: Socket,
    val input: DataInputStream,
    val output: DataOutputStream,
  ) : AutoCloseable {
    override fun close() {
      socket.close()
    }

    companion object {
      fun open(binding: StoredBinding): ProtocolConnection {
        val socket = Socket()
        socket.connect(InetSocketAddress(binding.host, binding.port), SOCKET_TIMEOUT_MS)
        socket.soTimeout = SOCKET_TIMEOUT_MS
        return ProtocolConnection(
          socket = socket,
          input = DataInputStream(socket.getInputStream()),
          output = DataOutputStream(socket.getOutputStream()),
        )
      }
    }
  }

  private data class StoredBinding(
    val deviceId: String,
    val deviceName: String,
    val deviceAlias: String,
    val host: String,
    val port: Int,
    val pairingId: String,
    val pairingToken: String,
    val shareEnabled: Boolean,
    val shareName: String?,
    val lastBoundAt: String,
    val connectionState: String,
    val wake: AndroidWakeCapability? = null,
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putString("deviceId", deviceId)
        putString("deviceName", deviceName)
        putString("deviceAlias", deviceAlias)
        putString("host", host)
        putInt("port", port)
        putString("pairingId", pairingId)
        putBoolean("shareEnabled", shareEnabled)
        if (shareName.isNullOrBlank()) {
          putNull("shareName")
        } else {
          putString("shareName", shareName)
        }
        putString("lastBoundAt", lastBoundAt)
        putString("connectionState", connectionState)
        if (wake == null) {
          putNull("wake")
        } else {
          putMap("wake", wake.toWritableMap())
        }
      }
    }

    private fun AndroidWakeCapability.toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putBoolean("supported", supported)
        putString("updatedAt", updatedAt)
        putArray(
          "targets",
          Arguments.createArray().apply {
            for (target in targets) {
              pushMap(
                Arguments.createMap().apply {
                  putString("interfaceName", target.interfaceName)
                  putString("macAddress", target.macAddress)
                  putString("ipv4Address", target.ipv4Address)
                  putString("broadcastAddress", target.broadcastAddress)
                  putArray(
                    "ports",
                    Arguments.createArray().apply {
                      target.ports.forEach { pushInt(it) }
                    },
                  )
                },
              )
            }
          },
        )
        if (publicTarget == null) {
          putNull("publicTarget")
        } else {
          putMap(
            "publicTarget",
            Arguments.createMap().apply {
              putString("kind", publicTarget.kind)
              putString("host", publicTarget.host)
              putInt("port", publicTarget.port)
              putBoolean("enabled", publicTarget.enabled)
              putString("updatedAt", publicTarget.updatedAt)
            }
          )
        }
      }
    }

    fun toJson(): JSONObject {
      return JSONObject().apply {
        put("deviceId", deviceId)
        put("deviceName", deviceName)
        put("deviceAlias", deviceAlias)
        put("host", host)
        put("port", port)
        put("pairingId", pairingId)
        put("pairingToken", pairingToken)
        put("shareEnabled", shareEnabled)
        put("shareName", shareName ?: JSONObject.NULL)
        put("lastBoundAt", lastBoundAt)
        put("connectionState", connectionState)
        put("wake", wake?.toJson() ?: JSONObject.NULL)
      }
    }

    fun toDiagnosticsJson(): JSONObject {
      return JSONObject().apply {
        put("deviceId", deviceId)
        put("deviceName", deviceName)
        put("deviceAlias", deviceAlias)
        put("host", host)
        put("port", port)
        put("pairingId", pairingId)
        put("shareEnabled", shareEnabled)
        put("shareName", shareName ?: JSONObject.NULL)
        put("lastBoundAt", lastBoundAt)
        put("connectionState", connectionState)
        put("wakeSupported", wake?.supported ?: false)
        put("wakeTargetCount", wake?.targets?.size ?: 0)
      }
    }

    companion object {
      fun fromJson(json: JSONObject): StoredBinding {
        return StoredBinding(
          deviceId = json.optString("deviceId"),
          deviceName = json.optString("deviceName"),
          deviceAlias = json.optString("deviceAlias")
            .ifBlank { json.optString("deviceName") },
          host = json.optString("host"),
          port = json.optInt("port", DEFAULT_PROTOCOL_PORT),
          pairingId = json.optString("pairingId"),
          pairingToken = json.optString("pairingToken"),
          shareEnabled = json.optBoolean("shareEnabled", false),
          shareName = json.optString("shareName").takeIf { it.isNotBlank() },
          lastBoundAt = json.optString("lastBoundAt"),
          connectionState = json.optString("connectionState")
            .ifBlank { "bound" },
          wake = AndroidSyncPrimitives.parseWakeCapability(json.optJSONObject("wake")),
        )
      }
    }
  }

  private data class SharedFilesReachability(
    val deviceId: String,
    val state: String,
    val route: String?,
    val reason: String,
    val updatedAt: String,
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putString("deviceId", deviceId)
        putString("state", state)
        if (route == null) {
          putNull("route")
        } else {
          putString("route", route)
        }
        putString("reason", reason)
        putString("updatedAt", updatedAt)
      }
    }
  }

  private data class DiscoveredServiceCandidate(
    val serviceKey: String,
    val deviceId: String,
    val name: String,
    val type: String,
    val ip: String,
    val probeHost: String,
    val port: Int,
    val protoVersion: Int,
    val authMode: String,
    val shareEnabled: Boolean,
    val shareName: String?,
    val lastSeenAt: String,
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putString("deviceId", deviceId)
        putString("name", name)
        putString("type", type)
        putString("ip", ip)
        putInt("port", port)
        putInt("protoVersion", protoVersion)
        putString("authMode", authMode)
        putBoolean("shareEnabled", shareEnabled)
        if (shareName.isNullOrBlank()) {
          putNull("shareName")
        } else {
          putString("shareName", shareName)
        }
        putString("lastSeenAt", lastSeenAt)
      }
    }
  }

  private data class IPv4Network(
    val address: String,
    val prefixLength: Int,
  )

  private data class AutoUploadConfig(
    val enabled: Boolean,
    val state: String,
    val timeRangeMode: String,
    val customTimeFrom: String?,
  )

  private class NativeBridgeException(
    val nativeCode: String,
    message: String,
  ) : Exception(message)

  private class AutoUploadRoundStoppedException(
    val autoUploadState: String,
  ) : Exception("Auto upload stopped: $autoUploadState")

  private class ForegroundSyncStoppedException : Exception("Foreground sync stopped")

  private data class P2PTunnelStartSnapshot(
    val generation: Long,
    val signalingUrl: String,
    val accessToken: String,
    val iceServersJSON: String,
  )

  private data class SharedFileRoute(
    val scope: String,
    val kind: String,
    val path: String,
    val url: URL,
    val urlHost: String,
    val port: Int,
    val authorizationToken: String?,
    val displayHost: String,
    val isTunnel: Boolean,
    val reachabilityRoute: String,
    val tunnelActive: Boolean,
    val tunnelStarting: Boolean,
    val activeTunnelPort: Int?,
  )

  private data class P2PTunnelRouteSnapshot(
    val hasCredentials: Boolean,
    val isActive: Boolean,
    val isStarting: Boolean,
    val port: Int?,
  )

  companion object {
    private const val MODULE_NAME = "NativeSyncEngine"
    @Volatile private var foregroundSyncStopCallback: (() -> Unit)? = null
    private const val MAX_DIAGNOSTICS_LOG_LINES = 2_000
    private const val PHOTO_PERMISSION_REQUEST_CODE = 39_394
    private const val DISCOVERY_PERMISSION_REQUEST_CODE = 39_395
    private const val DIAGNOSTICS_UPLOAD_TIMEOUT_MS = 30_000
    private const val ANDROID_14_API = 34
    private const val PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED =
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
    const val PREFS_NAME = "syncflow.android.native_sync_engine"
    private const val PREF_BINDING = "binding"
    private const val PREF_CLIENT_ID = "client_id"
    private const val PREF_CLIENT_DISPLAY_NAME = "client_display_name"
    private const val PREF_KNOWN_DEVICE_IDS = "known_device_ids"
    private const val PREF_AUTO_UPLOAD_ENABLED = "auto_upload_enabled"
    private const val PREF_AUTO_UPLOAD_STATE = "auto_upload_state"
    private const val PREF_AUTO_UPLOAD_TIME_RANGE_MODE = "auto_upload_time_range_mode"
    private const val PREF_AUTO_UPLOAD_CUSTOM_TIME_FROM = "auto_upload_custom_time_from"
    /** Auth-layer EncryptedSharedPreferences file (react-native-keychain service).
     *  Mirror of the iOS Keychain service `cn.vividrop.auth`. */
    const val AUTH_KEYCHAIN_PREFS_NAME = "cn.vividrop.auth"
    /** UserDefaults/SharedPrefs key — seeded on first launch, survives only as
     *  long as the app install does, so a missing marker uniquely identifies
     *  a fresh / reinstalled app. */
    const val PREF_INSTALL_MARKER = "vivi_install_marker"
    /** 2-phase wipe flag. Set before clearing, removed after. If present on
     *  cold start the wipe was killed mid-way and the sentinel retries. */
    const val PREF_WIPE_IN_PROGRESS = "vivi_wipe_in_progress"
    /** Numeric auth user id last bound to this sync identity. Absent means
     *  "no owner recorded" (fresh install / post-wipe). */
    const val PREF_OWNER_USER_ID = "lastSyncOwnerUserId"
    private const val SOCKET_TIMEOUT_MS = 5_000
    private const val BINDING_PROBE_TIMEOUT_MS = 1_200
    private const val PRESENCE_HEARTBEAT_TIMEOUT_MS = 5_000
    private const val PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000L
    private const val PRESENCE_RECOVERY_MAX_ATTEMPTS = 60
    private const val PRESENCE_RECOVERY_INTERVAL_MS = 1_000L
    private const val HEADER_SIZE = 12
    private const val MAX_BODY_LENGTH = 64 * 1024 * 1024
    private const val DEFAULT_PROTOCOL_PORT = 39_393
    private const val DEFAULT_SIDECAR_HTTP_PORT = 39_394
    private const val BONJOUR_SERVICE_TYPE = "_syncflow._tcp"
    private const val DISCOVERY_PROBE_TIMEOUT_MS = 2_000
    private const val DISCOVERY_FALLBACK_DELAY_MS = 2_500L
    private const val DISCOVERY_FALLBACK_HTTP_TIMEOUT_MS = 350
    private const val DISCOVERY_FALLBACK_HELLO_TIMEOUT_MS = 700
    private const val DISCOVERY_FALLBACK_RETRY_INTERVAL_MS = 5_000L
    private const val DISCOVERY_FALLBACK_SCAN_TIMEOUT_MS = 6_000L
    private const val DISCOVERY_FALLBACK_MAX_HOSTS = 2_000
    private const val DISCOVERY_FALLBACK_CONCURRENCY = 64
    private const val FALLBACK_SERVICE_KEY_PREFIX = "fallback|"
    private const val SHARED_HTTP_TIMEOUT_MS = 15_000
    private const val SHARED_DOWNLOAD_TIMEOUT_MS = 300_000
    private const val SHARED_TUNNEL_ROUTE_WAIT_MS = 4_000L
    private const val SHARED_TUNNEL_ROUTE_POLL_MS = 120L
    private const val SHARED_LAN_WAKE_POLL_TIMEOUT_MS = 25_000L
    private const val SHARED_LAN_WAKE_POLL_INTERVAL_MS = 1_000L
    private const val SHARED_LAN_WAKE_HEALTH_TIMEOUT_MS = 1_000
    private const val FILE_CHUNK_SIZE = 1024 * 1024
    private const val SPEED_SAMPLE_INTERVAL_MS = 500L
    private val MAGIC_BYTES = byteArrayOf('L'.code.toByte(), 'M'.code.toByte(), 'U'.code.toByte(), 'P'.code.toByte())
    private const val PROTOCOL_VERSION = 2
    private const val TYPE_HELLO_REQ = 0x0001
    private const val TYPE_HELLO_RES = 0x0002
    private const val TYPE_PAIR_REQ = 0x0003
    private const val TYPE_PAIR_RES = 0x0004
    private const val TYPE_SYNC_BEGIN_REQ = 0x0005
    private const val TYPE_SYNC_BEGIN_RES = 0x0006
    private const val TYPE_FILE_INIT_REQ = 0x0007
    private const val TYPE_FILE_INIT_RES = 0x0008
    private const val TYPE_FILE_DATA = 0x0009
    private const val TYPE_FILE_ACK = 0x000A
    private const val TYPE_FILE_END_REQ = 0x000B
    private const val TYPE_FILE_END_RES = 0x000C
    private const val TYPE_SYNC_END_REQ = 0x000D
    private const val TYPE_SYNC_END_RES = 0x000E
    private const val TYPE_ERROR = 0x0011
    private const val TYPE_AUTH_REQ = 0x0012
    private const val TYPE_AUTH_RES = 0x0013
    private val ACTIVE_UPLOAD_STATUSES = setOf(
      "queued",
      "discovered",
      "preparing",
      "ready",
      "cloud_downloading",
      "uploading",
      "completed",
    )

    /**
     * Keys that survive a wipe. Everything else stored in this prefs file
     * — current or future — is treated as sync-identity and cleared. The
     * allowlist shape is preventive: if Android later grows a local
     * upload queue / history / auto-upload config under a new pref key,
     * wipe will pick it up automatically instead of silently leaving a
     * per-account artifact behind.
     *
     * Preserved:
     *  - `client_display_name` — device label (not account data)
     *  - `vivi_install_marker` — reinstall sentinel (stays set for the
     *    lifetime of the install; cleared only by app deletion)
     *  - `vivi_wipe_in_progress` — 2-phase self-heal flag; managed by
     *    wipe itself (set at top, cleared at bottom)
     */
    private val SYNC_IDENTITY_PRESERVED_KEYS: Set<String> = setOf(
      PREF_CLIENT_DISPLAY_NAME,
      PREF_INSTALL_MARKER,
      PREF_WIPE_IN_PROGRESS,
    )

    /**
     * Clear every sync-identity field in SharedPreferences. Uses an
     * allowlist of keys to preserve (see `SYNC_IDENTITY_PRESERVED_KEYS`)
     * rather than an explicit per-key removal list, so future sync-state
     * additions are covered by default.
     *
     * Uses a 2-phase `PREF_WIPE_IN_PROGRESS` flag so a crash mid-wipe can
     * be detected and retried by the reinstall sentinel.
     *
     * Called from both the JS-facing `wipeSyncIdentity` bridge method and
     * from `MainApplication.onCreate` (reinstall / self-heal paths —
     * before the React context exists).
     */
    fun performWipeSyncIdentity(prefs: android.content.SharedPreferences) {
      // Synchronous write — the 2-phase self-heal contract relies on this
      // flag being observable on disk if we are killed between here and
      // the clear-flag at the bottom. `apply()` would only queue it in
      // memory and defer the flush, defeating the retry mechanism.
      prefs.edit().putString(PREF_WIPE_IN_PROGRESS, "1").commit()
      val keysToRemove = prefs.all.keys
        .filterNot { it in SYNC_IDENTITY_PRESERVED_KEYS }
      val editor = prefs.edit()
      for (key in keysToRemove) {
        editor.remove(key)
      }
      editor.apply()
      // Async flush is acceptable here — if we die between here and the
      // disk flush, next cold start just sees the flag still set and runs
      // wipe again, which is idempotent against already-cleared state.
      prefs.edit().remove(PREF_WIPE_IN_PROGRESS).apply()
    }

    /**
     * Remove the auth-layer EncryptedSharedPreferences file. Mirror of
     * `AuthKeychainCleaner.clearPersistedTokens()` on iOS. Safe to call when
     * the file does not exist (returns false, logged as no-op).
     *
     * Uses `Context.deleteSharedPreferences` (API 24+, well below the RN
     * 0.84 minSdk floor).
     */
    fun clearAuthKeychainStorage(context: android.content.Context) {
      val removed = context.deleteSharedPreferences(AUTH_KEYCHAIN_PREFS_NAME)
      android.util.Log.i(
        "NativeSyncEngineModule",
        if (removed) "cleared auth keychain prefs ($AUTH_KEYCHAIN_PREFS_NAME)"
        else "no auth keychain prefs to clear ($AUTH_KEYCHAIN_PREFS_NAME)",
      )
    }

    fun requestForegroundSyncStop() {
      foregroundSyncStopCallback?.invoke()
    }
  }
}
