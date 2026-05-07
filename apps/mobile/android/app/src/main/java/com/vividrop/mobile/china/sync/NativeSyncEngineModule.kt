package com.vividrop.mobile.china.sync

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import androidx.core.content.FileProvider
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
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
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject

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
  private var pendingPhotoPermissionPromise: Promise? = null
  private var pendingDiscoveryPermissionPromise: Promise? = null
  private val uploadStore by lazy { AndroidUploadStore(reactApplicationContext) }
  private val mediaStoreRepository by lazy { AndroidMediaStoreRepository(reactApplicationContext) }

  override fun getName(): String = MODULE_NAME

  override fun invalidate() {
    stopDiscoveryInternal(emitUpdate = false)
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
    val manager = reactApplicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
    if (manager == null) {
      recordNativeLog("Discovery", "startDiscovery unavailable: NsdManager missing", Log.WARN)
      emitDiscoveredDevicesChanged()
      emitError(
        code = "ANDROID_DISCOVERY_UNAVAILABLE",
        message = "Android 系统未提供局域网发现服务，无法扫描电脑端设备。",
      )
      promise.resolve(null)
      return
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
    promise.resolve(null)
  }

  @ReactMethod
  fun stopDiscovery(promise: Promise) {
    recordNativeLog("Discovery", "stopDiscovery requested")
    stopDiscoveryInternal(emitUpdate = true)
    promise.resolve(null)
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

      val storedPairingToken = if (AndroidSyncPrimitives.shouldUseStoredPairingToken(connectionCode)) {
        pairingTokenForKnownDevice(fallbackDeviceId)
      } else {
        null
      }

      val helloPayload = JSONObject().apply {
        put("clientId", getOrCreateClientId())
        put("clientName", getClientDisplayNameValue())
        put("clientPlatform", "android")
        put("appVersion", getVersionName())
        put("appState", "active")
        if (!storedPairingToken.isNullOrBlank()) {
          put("pairingToken", storedPairingToken)
        }
      }

      val resolvedBinding = performPairing(
        host = host,
        port = port,
        fallbackDeviceId = fallbackDeviceId,
        connectionCode = connectionCode,
        storedPairingToken = storedPairingToken,
        helloPayload = helloPayload,
      )

      saveBinding(resolvedBinding)
      recordNativeLog(
        "Pairing",
        "pairDevice successful deviceId=${resolvedBinding.deviceId} host=${resolvedBinding.host} shareEnabled=${resolvedBinding.shareEnabled}",
        Log.INFO,
      )
      emitBindingStateChanged(resolvedBinding)
      emitIdleSyncState(resolvedBinding)
      emitQueueUpdated(Arguments.createArray())
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun disconnectAndUnbind(promise: Promise) {
    recordNativeLog("Pairing", "disconnectAndUnbind requested")
    clearBinding()
    emitBindingStateCleared()
    emitIdleSyncState(null)
    emitQueueUpdated(Arguments.createArray())
    promise.resolve(null)
  }

  @ReactMethod
  fun getBindingState(promise: Promise) {
    runAsync(promise) {
      promise.resolve(refreshBindingReachability(loadBinding())?.toWritableMap())
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
    thread(name = "NativeSyncEngineSync", isDaemon = true) {
      performSyncRound(reason = "manual_trigger")
    }
    promise.resolve(null)
  }

  private fun startAutoUploadSyncRound(reason: String) {
    recordDiagnosticsLog("AutoUpload", "starting sync round reason=$reason")
    thread(name = "NativeSyncEngineAutoUpload", isDaemon = true) {
      performSyncRound(reason = reason)
    }
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
        thread(name = "NativeSyncEngineManualUpload", isDaemon = true) {
          runCatching { performSyncRound(reason = "manual_upload") }
        }
      }
    }
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
    emitSyncState(loadBinding(), "paused_auto_upload")
    promise.resolve(null)
  }

  @ReactMethod
  fun disableAutoUpload(promise: Promise) {
    recordNativeLog("AutoUpload", "disable requested")
    persistAutoUploadDisabledState()
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
  fun browseSharedFiles(path: String, promise: Promise) {
    runAsync(promise) {
      promise.resolve(fetchSharedDirectory(path))
    }
  }

  @ReactMethod
  fun downloadSharedFile(path: String, promise: Promise) {
    runAsync(promise) {
      promise.resolve(downloadSharedFileToLocalStorage(path))
    }
  }

  @ReactMethod
  fun getSharedFileStreamUrl(path: String, promise: Promise) {
    promise.resolve(sharedFileUrl("stream", path).toString())
  }

  @ReactMethod
  fun shareFile(localPath: String, promise: Promise) {
    try {
      val uri = when {
        localPath.startsWith("content://") -> Uri.parse(localPath)
        localPath.startsWith("file://") -> fileProviderUri(File(Uri.parse(localPath).path ?: ""))
        else -> fileProviderUri(File(localPath))
      }
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = reactApplicationContext.contentResolver.getType(uri) ?: "*/*"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("ANDROID_SHARE_FAILED", error.message, error)
    }
  }

  private fun fileProviderUri(file: File): Uri =
    FileProvider.getUriForFile(
      reactApplicationContext,
      "${reactApplicationContext.packageName}.syncflow.fileprovider",
      file,
    )

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
      } catch (error: Throwable) {
        recordNativeLog("Bridge", "async method failed: ${error.message ?: error.javaClass.simpleName}", Log.ERROR)
        promise.reject("NATIVE_SYNC_ENGINE_ERROR", error.message, error)
      }
    }
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
      val helloResponse = readJsonFrame(input, TYPE_HELLO_RES)
      recordNativeLog(
        "Pairing",
        "HELLO_RES serverId=${helloResponse.optString("serverId").ifBlank { "<missing>" }} authRequired=${helloResponse.optBoolean("authRequired", true)}",
      )

      val serverCapabilities = helloResponse.optJSONObject("serverCapabilities")
      val shareName = serverCapabilities?.optString("shareName")
        ?.takeIf { it.isNotBlank() }
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
        )
      }

      val pairPayload = JSONObject().apply {
        put("clientId", getOrCreateClientId())
        put("clientName", getClientDisplayNameValue())
        put("connectionCode", connectionCode)
        currentClientIPv4()?.let { put("clientIp", it) }
      }
      writeJsonFrame(output, TYPE_PAIR_REQ, pairPayload)
      val pairResponse = readJsonFrame(input, TYPE_PAIR_RES)

      if (!pairResponse.optBoolean("ok", false)) {
        recordNativeLog("Pairing", "PAIR_RES rejected error=${pairResponse.optString("error")}", Log.WARN)
        throw IllegalStateException(pairResponse.optString("error").ifBlank { "Pairing rejected" })
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
      )
    }
  }

  private fun performSyncRound(reason: String) {
    synchronized(syncRunLock) {
      if (syncInProgress) {
        recordDiagnosticsLog("Sync", "round skipped reason=$reason syncInProgress=true")
        return
      }
      syncInProgress = true
    }
    try {
      var binding = loadBinding()
      if (binding == null) {
        recordDiagnosticsLog("Sync", "round paused reason=$reason no binding")
        emitSyncState(null, "paused_no_target")
        emitError("ANDROID_SYNC_NO_BINDING", "尚未绑定桌面端，无法同步。")
        return
      }
      val permissionState = currentPhotoPermissionState()
      if (permissionState == "denied") {
        recordDiagnosticsLog("Sync", "round paused reason=$reason photoPermission=denied")
        emitSyncState(binding, "paused_no_permission")
        emitError("ANDROID_PHOTO_PERMISSION_DENIED", "Android 相簿权限尚未开启，无法扫描同步素材。")
        return
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

      emitSyncState(binding, "scanning")
      val clientId = getOrCreateClientId()
      val existing = uploadStore.getAllItems()
      val existingAssetIds = existing
        .filter { it.status in ACTIVE_UPLOAD_STATUSES }
        .mapTo(mutableSetOf()) { it.assetLocalId }
      val discovered = mediaStoreRepository.scanAssets(clientId)
        .filter { it.assetLocalId !in existingAssetIds }
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
        authenticateConnection(connection, binding)
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
          val current = uploadStore.getItemByAssetId(item.assetLocalId) ?: item
          if (current.status == "cancelled") {
            completedCount += 1
            continue
          }
          val result = uploadOneItem(
            connection = connection,
            binding = binding,
            sessionId = sessionId,
            item = current,
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
    }
  }

  private fun authenticateConnection(connection: ProtocolConnection, binding: StoredBinding) {
    val helloPayload = JSONObject().apply {
      put("clientId", getOrCreateClientId())
      put("clientName", getClientDisplayNameValue())
      put("clientPlatform", "android")
      put("appVersion", getVersionName())
      put("appState", "active")
      put("deviceAlias", binding.deviceAlias)
      if (binding.pairingToken.isNotBlank()) {
        put("pairingToken", binding.pairingToken)
      }
    }
    writeJsonFrame(connection.output, TYPE_HELLO_REQ, helloPayload)
    val helloResponse = readJsonFrame(connection.input, TYPE_HELLO_RES)
    recordNativeLog(
      "SyncPipeline",
      "HELLO_RES received serverId=${helloResponse.optString("serverId").ifBlank { binding.deviceId }} authRequired=${helloResponse.optBoolean("authRequired", false)}",
    )

    val nonce = helloResponse.optString("nonce")
    if (nonce.isNotBlank()) {
      if (binding.pairingToken.isBlank()) {
        throw IllegalStateException("Desktop requires re-pairing")
      }
      writeJsonFrame(
        connection.output,
        TYPE_AUTH_REQ,
        JSONObject().apply {
          put("clientId", getOrCreateClientId())
          put("auth", AndroidSyncPrimitives.computeAuthHmac(binding.pairingToken, nonce))
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
  }

  private fun uploadOneItem(
    connection: ProtocolConnection,
    binding: StoredBinding,
    sessionId: String,
    item: AndroidUploadItem,
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
        streamFileData(connection, binding, sessionId, item, startOffset, completedCount, queueTotalCount, completedBytes, totalBytes)
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
      while (offset < item.fileSize) {
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

  private fun readJsonFrame(input: DataInputStream, expectedType: Int): JSONObject {
    val frame = readJsonFrameAny(input)
    if (frame.type == TYPE_ERROR) {
      throw IllegalStateException(frame.payload.optString("message", "Desktop returned protocol error"))
    }
    if (frame.type != expectedType) {
      throw IllegalStateException("Unexpected frame type: ${frame.type}")
    }
    return frame.payload
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

  private fun fetchSharedDirectory(path: String): WritableMap {
    val json = JSONObject(readHttpString(sharedFileUrl("list", path)))
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
          putString("thumbnailUrl", sharedFileUrl("thumbnail", filePath).toString())
        }
        if (fileType == "video") {
          putString("streamUrl", sharedFileUrl("stream", filePath).toString())
        }
      })
    }
    return Arguments.createMap().apply {
      putString("path", json.optString("path", path))
      putArray("files", files)
      putInt("totalCount", json.optInt("totalCount", sourceFiles.length()))
    }
  }

  private fun downloadSharedFileToLocalStorage(path: String): WritableMap {
    val filename = path.substringAfterLast('/').ifBlank { "shared-file" }
    val mediaType = AndroidSyncPrimitives.classifyMediaType(
      AndroidSyncPrimitives.mimeTypeForFilename(filename),
      filename,
    )
    val url = sharedFileUrl("download", path)
    val connection = url.openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
      connection.readTimeout = SHARED_DOWNLOAD_TIMEOUT_MS
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Sidecar returned HTTP ${connection.responseCode}")
      }
      val mimeType = connection.contentType?.substringBefore(';')
        ?: AndroidSyncPrimitives.mimeTypeForFilename(filename)
      if (mediaType == "image" || mediaType == "video") {
        val collection = if (mediaType == "video") {
          MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
          MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
          put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(
              MediaStore.MediaColumns.RELATIVE_PATH,
              if (mediaType == "video") "${Environment.DIRECTORY_MOVIES}/Vivi Drop" else "${Environment.DIRECTORY_PICTURES}/Vivi Drop",
            )
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
        }
        val uri = reactApplicationContext.contentResolver.insert(collection, values)
          ?: throw IllegalStateException("Unable to create MediaStore item")
        reactApplicationContext.contentResolver.openOutputStream(uri)?.use { output ->
          connection.inputStream.use { input -> input.copyTo(output) }
        } ?: throw IllegalStateException("Unable to write MediaStore item")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          values.clear()
          values.put(MediaStore.MediaColumns.IS_PENDING, 0)
          reactApplicationContext.contentResolver.update(uri, values, null, null)
        }
        return Arguments.createMap().apply {
          putBoolean("savedToPhotos", true)
          putNull("localPath")
        }
      }

      val destDir = File(reactApplicationContext.cacheDir, "syncflow_shared_downloads")
      if (!destDir.exists()) {
        destDir.mkdirs()
      }
      val destFile = File(destDir, filename)
      connection.inputStream.use { input ->
        destFile.outputStream().use { output -> input.copyTo(output) }
      }
      return Arguments.createMap().apply {
        putBoolean("savedToPhotos", false)
        putString("localPath", destFile.absolutePath)
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun readHttpString(url: URL): String {
    val connection = url.openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = SHARED_HTTP_TIMEOUT_MS
      connection.readTimeout = SHARED_HTTP_TIMEOUT_MS
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

  private fun sharedFileUrl(kind: String, path: String): URL {
    val binding = loadBinding() ?: throw IllegalStateException("No bound desktop")
    val normalizedPath = path.trim().trim('/')
    val endpoint = when (kind) {
      "list" -> if (normalizedPath.isBlank()) "/shared/list" else "/shared/list/${encodePath(normalizedPath)}"
      "download" -> "/shared/download/${encodePath(normalizedPath)}"
      "stream" -> "/shared/stream/${encodePath(normalizedPath)}"
      "thumbnail" -> "/shared/thumbnail/${encodePath(normalizedPath)}"
      else -> throw IllegalArgumentException("Unsupported shared endpoint: $kind")
    }
    return URL("http", binding.host, DEFAULT_SIDECAR_HTTP_PORT, endpoint)
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

    return packageInfo.versionName ?: "0.1.0"
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
    emitEvent("onDiscoveredDevicesChanged", devices)
  }

  private fun emitQueueUpdated(queue: WritableArray) {
    emitEvent("onQueueUpdated", queue)
  }

  private fun emitBindingStateChanged(binding: StoredBinding) {
    emitEvent("onBindingStateChanged", binding.toWritableMap())
  }

  private fun emitBindingStateCleared() {
    emitEvent("onBindingStateChanged", null)
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

  private fun updateBindingConnectionState(binding: StoredBinding?, connectionState: String): StoredBinding? {
    if (binding == null) {
      return null
    }
    if (binding.connectionState == connectionState) {
      return binding
    }
    recordNativeLog(
      "SyncEngine",
      "binding connection state ${binding.connectionState} -> $connectionState",
    )
    val updated = binding.copy(connectionState = connectionState)
    saveBinding(updated)
    emitBindingStateChanged(updated)
    return updated
  }

  private fun refreshBindingReachability(binding: StoredBinding?): StoredBinding? {
    if (binding == null) {
      return null
    }
    if (!AndroidSyncPrimitives.shouldProbeBindingConnectionState(binding.connectionState)) {
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
            emitError(
              code = "ANDROID_DISCOVERY_RESOLVE_FAILED",
              message = "解析局域网服务失败（$errorCode）",
            )
          }

          override fun onServiceResolved(resolvedServiceInfo: NsdServiceInfo) {
            val candidate = buildDiscoveredCandidate(resolvedServiceInfo)
            recordNativeLog(
              "Discovery",
              "resolved name=${candidate.name} host=${candidate.ip} probeHost=${candidate.probeHost} port=${candidate.port}",
            )
            synchronized(discoveryLock) {
              pendingResolveKeys.remove(serviceKey)
              if (generation != discoveryGeneration) {
                return
              }
              discoveredCandidates[serviceKey] = candidate
            }
            probeReachability(candidate, generation)
          }
        },
      )
    } catch (error: Throwable) {
      synchronized(discoveryLock) {
        pendingResolveKeys.remove(serviceKey)
      }
      recordNativeLog("Discovery", "resolve submit failed: ${error.message ?: error.javaClass.simpleName}", Log.ERROR)
      emitError(
        code = "ANDROID_DISCOVERY_RESOLVE_FAILED",
        message = "提交局域网服务解析失败：${error.message ?: "unknown error"}",
      )
    }
  }

  private fun buildDiscoveredCandidate(serviceInfo: NsdServiceInfo): DiscoveredServiceCandidate {
    val attributes = parseTxtAttributes(serviceInfo)
    val resolvedHost = serviceInfo.host?.hostAddress.orEmpty()
    val advertisedIp = attributes["ip"].orEmpty()
    val initialIp = preferredDisplayHost(advertisedIp, resolvedHost)
    val probeHost = preferredProbeHost(advertisedIp, resolvedHost)
    val serviceName = serviceInfo.serviceName.takeIf { it.isNotBlank() } ?: "SyncFlow Desktop"

    return DiscoveredServiceCandidate(
      serviceKey = serviceKeyFor(serviceInfo),
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
          return@synchronized false
        }
        reachableCandidates.remove(candidate.serviceKey) != null
      }
      if (shouldEmit) {
        emitReachableDevices()
      }
      return
    }

    thread(name = "NativeSyncEngineDiscoveryProbe", isDaemon = true) {
      try {
        Socket().use { socket ->
          socket.connect(
            InetSocketAddress(candidate.probeHost, candidate.port),
            DISCOVERY_PROBE_TIMEOUT_MS,
          )
          socket.soTimeout = DISCOVERY_PROBE_TIMEOUT_MS

          val probedHost = socket.inetAddress?.hostAddress.orEmpty()
          val resolvedIp = preferredDisplayHost(candidate.ip, probedHost)
          val reachable = candidate.copy(
            ip = resolvedIp,
            lastSeenAt = isoNow(),
          )

          synchronized(discoveryLock) {
            if (generation != discoveryGeneration) {
              return@thread
            }
            if (!discoveredCandidates.containsKey(candidate.serviceKey)) {
              return@thread
            }
            reachableCandidates[candidate.serviceKey] = reachable
          }
        }
        recordNativeLog("Discovery", "reachable ${candidate.name} via ${candidate.probeHost}")
        emitReachableDevices()
      } catch (_: Throwable) {
        recordNativeLog("Discovery", "reachability failed ${candidate.name} via ${candidate.probeHost}", Log.WARN)
        val shouldEmit = synchronized(discoveryLock) {
          if (generation != discoveryGeneration) {
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
      try {
        Thread.sleep(DISCOVERY_FALLBACK_DELAY_MS)
      } catch (_: InterruptedException) {
        return@thread
      }

      val shouldScan = synchronized(discoveryLock) {
        generation == discoveryGeneration && reachableCandidates.isEmpty()
      }
      if (!shouldScan) {
        return@thread
      }

      val network = currentClientIPv4Network()
      if (network == null) {
        recordNativeLog("Discovery", "fallback skipped: no IPv4 network", Log.WARN)
        return@thread
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
        return@thread
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
                  return@synchronized false
                }
                discoveredCandidates[candidate.serviceKey] = candidate
                reachableCandidates[candidate.serviceKey] = candidate
                true
              }
              if (shouldEmit) {
                recordNativeLog("Discovery", "fallback reachable ${candidate.name} via $host")
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
      val now = isoNow()
      DiscoveredServiceCandidate(
        serviceKey = "$FALLBACK_SERVICE_KEY_PREFIX$host",
        deviceId = "fallback-$host",
        name = "Vivi Drop $host",
        type = "mac",
        ip = host,
        probeHost = host,
        port = DEFAULT_PROTOCOL_PORT,
        protoVersion = PROTOCOL_VERSION,
        authMode = "code",
        shareEnabled = false,
        shareName = null,
        lastSeenAt = now,
      )
    } catch (_: Throwable) {
      null
    } finally {
      connection.disconnect()
    }
  }

  private fun emitReachableDevices() {
    val payload = synchronized(discoveryLock) {
      buildReachableDevicesPayloadLocked()
    }
    emitDiscoveredDevicesChanged(payload)
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
        )
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

  companion object {
    private const val MODULE_NAME = "NativeSyncEngine"
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
    private const val HEADER_SIZE = 12
    private const val MAX_BODY_LENGTH = 64 * 1024 * 1024
    private const val DEFAULT_PROTOCOL_PORT = 39_393
    private const val DEFAULT_SIDECAR_HTTP_PORT = 39_394
    private const val BONJOUR_SERVICE_TYPE = "_syncflow._tcp"
    private const val DISCOVERY_PROBE_TIMEOUT_MS = 2_000
    private const val DISCOVERY_FALLBACK_DELAY_MS = 2_500L
    private const val DISCOVERY_FALLBACK_HTTP_TIMEOUT_MS = 350
    private const val DISCOVERY_FALLBACK_SCAN_TIMEOUT_MS = 6_000L
    private const val DISCOVERY_FALLBACK_MAX_HOSTS = 2_000
    private const val DISCOVERY_FALLBACK_CONCURRENCY = 64
    private const val FALLBACK_SERVICE_KEY_PREFIX = "fallback|"
    private const val SHARED_HTTP_TIMEOUT_MS = 15_000
    private const val SHARED_DOWNLOAD_TIMEOUT_MS = 300_000
    private const val FILE_CHUNK_SIZE = 1024 * 1024
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
  }
}
