package com.vividrop.mobile.china.sync

import android.content.Context
import android.content.pm.PackageManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
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
    promise.resolve(currentPhotoPermissionState())
  }

  @ReactMethod
  fun startDiscovery(promise: Promise) {
    val manager = reactApplicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
    if (manager == null) {
      emitDiscoveredDevicesChanged()
      emitError(
        code = "ANDROID_DISCOVERY_UNAVAILABLE",
        message = "Android 系统未提供局域网发现服务，无法扫描电脑端设备。",
      )
      promise.resolve(null)
      return
    }

    val listener: NsdManager.DiscoveryListener
    synchronized(discoveryLock) {
      stopDiscoveryLocked()
      nsdManager = manager
      acquireMulticastLockLocked()
      discoveryGeneration += 1
      listener = createDiscoveryListener(
        manager = manager,
        generation = discoveryGeneration,
      )
      discoveryListener = listener
    }

    emitDiscoveredDevicesChanged()
    try {
      manager.discoverServices(BONJOUR_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (error: Throwable) {
      synchronized(discoveryLock) {
        stopDiscoveryLocked()
      }
      emitError(
        code = "ANDROID_DISCOVERY_START_FAILED",
        message = "启动 Android 局域网发现失败：${error.message ?: "unknown error"}",
      )
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun stopDiscovery(promise: Promise) {
    stopDiscoveryInternal(emitUpdate = true)
    promise.resolve(null)
  }

  @ReactMethod
  fun pairDevice(params: ReadableMap, promise: Promise) {
    runAsync(promise) {
      val host = params.getString("host")?.trim().orEmpty()
      val port = if (params.hasKey("port")) params.getInt("port") else DEFAULT_PROTOCOL_PORT
      val fallbackDeviceId = params.getString("deviceId")?.trim().orEmpty()
      val connectionCode = params.getString("connectionCode")?.trim().orEmpty()

      if (host.isBlank()) {
        throw IllegalArgumentException("Missing host for pairing")
      }
      if (connectionCode.length != CONNECTION_CODE_LENGTH) {
        throw IllegalArgumentException("Connection code must be 6 digits")
      }

      val helloPayload = JSONObject().apply {
        put("clientId", getOrCreateClientId())
        put("clientName", getClientDisplayNameValue())
        put("clientPlatform", "android")
        put("appVersion", getVersionName())
        put("appState", "active")
      }

      val resolvedBinding = performPairing(
        host = host,
        port = port,
        fallbackDeviceId = fallbackDeviceId,
        connectionCode = connectionCode,
        helloPayload = helloPayload,
      )

      saveBinding(resolvedBinding)
      emitBindingStateChanged(resolvedBinding)
      emitIdleSyncState(resolvedBinding)
      emitQueueUpdated(Arguments.createArray())
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun disconnectAndUnbind(promise: Promise) {
    clearBinding()
    emitBindingStateCleared()
    emitIdleSyncState(null)
    emitQueueUpdated(Arguments.createArray())
    promise.resolve(null)
  }

  @ReactMethod
  fun getBindingState(promise: Promise) {
    promise.resolve(loadBinding()?.toWritableMap())
  }

  @ReactMethod
  fun getSyncOverview(promise: Promise) {
    promise.resolve(buildIdleSyncSummary(loadBinding()))
  }

  @ReactMethod
  fun getReadOnlyQueue(promise: Promise) {
    promise.resolve(Arguments.createArray())
  }

  @ReactMethod
  fun getHistoryDays(cursor: String?, promise: Promise) {
    val result = Arguments.createMap().apply {
      putArray("items", Arguments.createArray())
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
      putString("supportLevel", "shell")
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun exportDiagnostics(promise: Promise) {
    runAsync(promise) {
      val archive = File(
        reactApplicationContext.cacheDir,
        "syncflow-android-diagnostics-${System.currentTimeMillis()}.json",
      )
      val payload = JSONObject().apply {
        put("generatedAt", isoNow())
        put("platform", "android")
        put("supportLevel", "shell")
        put("clientId", getOrCreateClientId())
        put("clientDisplayName", getClientDisplayNameValue())
        put(
          "appInfo",
          JSONObject().apply {
            put("version", getVersionName())
            put("build", getVersionCode())
          },
        )
        put("binding", loadBinding()?.toJson() ?: JSONObject.NULL)
      }
      archive.writeText(payload.toString(2), StandardCharsets.UTF_8)
      promise.resolve(archive.absolutePath)
    }
  }

  @ReactMethod
  fun getClientDisplayName(promise: Promise) {
    promise.resolve(getClientDisplayNameValue())
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
    emitError(
      code = "ANDROID_SYNC_NOT_IMPLEMENTED",
      message = "Android 端原生同步引擎尚未接入，当前版本仅提供基础壳层与配对入口。",
    )
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
  fun resetAllStatus(promise: Promise) {
    emitIdleSyncState(loadBinding())
    emitQueueUpdated(Arguments.createArray())
    promise.resolve(null)
  }

  // ---------------------------------------------------------------------------
  // Account Identity Reset (Phase 1 / 2 / 3)
  //
  // Android shell has no upload queue / history DB, so "wipe" reduces to
  // clearing the sync identity fields in SharedPreferences. We mirror the
  // iOS 2-phase sentinel so a crash mid-wipe is recoverable on next launch
  // (see MainApplication.onCreate).
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

  // ---------------------------------------------------------------------------
  // Stub methods — Android native sync engine is not yet implemented.
  // These stubs return safe defaults so JS screens don't crash when calling
  // bridge methods that only have real implementations on iOS.
  // ---------------------------------------------------------------------------

  @ReactMethod
  fun browseAlbum(params: ReadableMap, promise: Promise) {
    promise.resolve(Arguments.createArray())
  }

  @ReactMethod
  fun getAlbumStats(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putInt("totalCount", 0)
      putInt("transferredCount", 0)
      putInt("queuedCount", 0)
      putInt("pendingCount", 0)
    })
  }

  @ReactMethod
  fun getAlbumCollections(mediaFilter: String, promise: Promise) {
    promise.resolve(Arguments.createArray())
  }

  @ReactMethod
  fun submitManualUpload(params: ReadableMap, promise: Promise) {
    promise.reject("ANDROID_NOT_IMPLEMENTED", "手动上传功能暂未在 Android 端实现")
  }

  @ReactMethod
  fun cancelManualBatch(batchId: String, promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun pauseAutoUpload(promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun disableAutoUpload(promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun resumeAutoUpload(promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun getAutoUploadConfig(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putBoolean("enabled", false)
      putString("state", "disabled")
      putString("timeRangeMode", "all")
    })
  }

  @ReactMethod
  fun saveAutoUploadConfig(params: ReadableMap, promise: Promise) {
    promise.resolve(null)
  }

  @ReactMethod
  fun browseSharedFiles(path: String, promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putString("path", path)
      putArray("files", Arguments.createArray())
    })
  }

  @ReactMethod
  fun downloadSharedFile(path: String, promise: Promise) {
    promise.reject("ANDROID_NOT_IMPLEMENTED", "共享文件下载功能暂未在 Android 端实现")
  }

  @ReactMethod
  fun getSharedFileStreamUrl(path: String, promise: Promise) {
    promise.reject("ANDROID_NOT_IMPLEMENTED", "共享文件流功能暂未在 Android 端实现")
  }

  @ReactMethod
  fun shareFile(localPath: String, promise: Promise) {
    promise.reject("ANDROID_NOT_IMPLEMENTED", "文件分享功能暂未在 Android 端实现")
  }

  @ReactMethod
  fun getPhotoAuthorizationStatus(promise: Promise) {
    // Reuse the same permission check as requestPhotoPermission so both
    // bridge methods agree on what "authorized" means.
    val state = currentPhotoPermissionState()
    promise.resolve(if (state == "granted") "authorized" else "denied")
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
        promise.reject("NATIVE_SYNC_ENGINE_ERROR", error.message, error)
      }
    }
  }

  private fun performPairing(
    host: String,
    port: Int,
    fallbackDeviceId: String,
    connectionCode: String,
    helloPayload: JSONObject,
  ): StoredBinding {
    Socket().use { socket ->
      socket.connect(InetSocketAddress(host, port), SOCKET_TIMEOUT_MS)
      socket.soTimeout = SOCKET_TIMEOUT_MS

      val input = DataInputStream(socket.getInputStream())
      val output = DataOutputStream(socket.getOutputStream())

      writeJsonFrame(output, TYPE_HELLO_REQ, helloPayload)
      val helloResponse = readJsonFrame(input, TYPE_HELLO_RES)

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
          shareEnabled = shareName != null,
          shareName = shareName,
          lastBoundAt = isoNow(),
          connectionState = "bound",
        )
      }

      val pairPayload = JSONObject().apply {
        put("clientId", getOrCreateClientId())
        put("clientName", getClientDisplayNameValue())
        put("connectionCode", connectionCode)
      }
      writeJsonFrame(output, TYPE_PAIR_REQ, pairPayload)
      val pairResponse = readJsonFrame(input, TYPE_PAIR_RES)

      if (!pairResponse.optBoolean("ok", false)) {
        throw IllegalStateException("Pairing rejected")
      }

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
        shareEnabled = serverInfo?.optString("shareName")?.isNotBlank() == true,
        shareName = serverInfo?.optString("shareName")?.takeIf { it.isNotBlank() },
        lastBoundAt = isoNow(),
        connectionState = "bound",
      )
    }
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
    if (actualType != expectedType) {
      throw IllegalStateException("Unexpected frame type: $actualType")
    }

    val bodyLength = header.int
    if (bodyLength < 0 || bodyLength > MAX_BODY_LENGTH) {
      throw IllegalStateException("Invalid frame size: $bodyLength")
    }

    if (bodyLength == 0) {
      return JSONObject()
    }

    val body = ByteArray(bodyLength)
    input.readFully(body)
    return JSONObject(String(body, StandardCharsets.UTF_8))
  }

  private fun currentPhotoPermissionState(): String {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val hasImages = reactApplicationContext.checkSelfPermission(
        android.Manifest.permission.READ_MEDIA_IMAGES,
      ) == PackageManager.PERMISSION_GRANTED
      val hasVideo = reactApplicationContext.checkSelfPermission(
        android.Manifest.permission.READ_MEDIA_VIDEO,
      ) == PackageManager.PERMISSION_GRANTED
      if (hasImages && hasVideo) "granted" else "denied"
    } else {
      val granted = reactApplicationContext.checkSelfPermission(
        android.Manifest.permission.READ_EXTERNAL_STORAGE,
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
    emitEvent("onSyncStateChanged", buildIdleSyncSummary(binding))
  }

  private fun emitError(code: String, message: String) {
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

  private fun buildIdleSyncSummary(binding: StoredBinding?): WritableMap {
    return Arguments.createMap().apply {
      putString("currentDeviceId", binding?.deviceId)
      putString("currentDeviceName", binding?.deviceAlias ?: binding?.deviceName)
      putDouble("currentSpeedMbps", 0.0)
      putDouble("transferredBytes", 0.0)
      putDouble("totalBytes", 0.0)
      putDouble("progressPercent", 0.0)
      putString("uploadState", "idle")
      putString("performanceHint", "none")
      putNull("performanceMessage")
      putString("thermalState", "unknown")
      putString("activeTuningProfile", "idle")
      putBoolean("isThermalLimited", false)
      putDouble("completedCount", 0.0)
      putDouble("totalCount", 0.0)
      putDouble("completedBytes", 0.0)
      putDouble("currentFileConfirmedBytes", 0.0)
      putDouble("currentFileTotalBytes", 0.0)
      putString("sessionId", "")
      putString("state", "idle")
    }
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
  }

  private fun clearBinding() {
    prefs.edit().remove(PREF_BINDING).apply()
  }

  private fun isoNow(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date())
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

      override fun onDiscoveryStarted(serviceType: String) = Unit

      override fun onDiscoveryStopped(serviceType: String) = Unit

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        if (!isTargetServiceType(serviceInfo.serviceType)) {
          return
        }
        resolveService(manager, generation, serviceInfo)
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
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
            emitError(
              code = "ANDROID_DISCOVERY_RESOLVE_FAILED",
              message = "解析局域网服务失败（$errorCode）",
            )
          }

          override fun onServiceResolved(resolvedServiceInfo: NsdServiceInfo) {
            val candidate = buildDiscoveredCandidate(resolvedServiceInfo)
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
        emitReachableDevices()
      } catch (_: Throwable) {
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

    multicastLock = wifiManager.createMulticastLock("syncflow:discovery").apply {
      setReferenceCounted(false)
      acquire()
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

  private data class StoredBinding(
    val deviceId: String,
    val deviceName: String,
    val deviceAlias: String,
    val host: String,
    val port: Int,
    val pairingId: String,
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

  companion object {
    private const val MODULE_NAME = "NativeSyncEngine"
    const val PREFS_NAME = "syncflow.android.native_sync_engine"
    private const val PREF_BINDING = "binding"
    private const val PREF_CLIENT_ID = "client_id"
    private const val PREF_CLIENT_DISPLAY_NAME = "client_display_name"
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
    private const val HEADER_SIZE = 12
    private const val MAX_BODY_LENGTH = 64 * 1024 * 1024
    private const val DEFAULT_PROTOCOL_PORT = 39_393
    private const val BONJOUR_SERVICE_TYPE = "_syncflow._tcp"
    private const val CONNECTION_CODE_LENGTH = 6
    private const val DISCOVERY_PROBE_TIMEOUT_MS = 2_000
    private val MAGIC_BYTES = byteArrayOf('L'.code.toByte(), 'M'.code.toByte(), 'U'.code.toByte(), 'P'.code.toByte())
    private const val PROTOCOL_VERSION = 2
    private const val TYPE_HELLO_REQ = 0x0001
    private const val TYPE_HELLO_RES = 0x0002
    private const val TYPE_PAIR_REQ = 0x0003
    private const val TYPE_PAIR_RES = 0x0004

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
