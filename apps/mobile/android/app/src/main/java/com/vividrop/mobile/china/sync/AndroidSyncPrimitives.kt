package com.vividrop.mobile.china.sync

import java.io.BufferedOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class AndroidUploadItem(
  val assetLocalId: String,
  val fileKey: String,
  val filename: String,
  val mediaType: String,
  val mimeType: String,
  val fileSize: Long,
  val createdAt: String,
  val modifiedAt: String,
  val uri: String,
  val status: String,
  val source: String,
  val batchId: String?,
  val ackedOffset: Long,
  val updatedAt: String,
) {
  companion object
}

data class AndroidSyncOverviewInput(
  val currentDeviceId: String? = null,
  val currentDeviceName: String? = null,
  val uploadState: String = "idle",
  val state: String? = null,
  val sessionId: String = "",
  val completedCount: Int = 0,
  val totalCount: Int = 0,
  val completedBytes: Long = 0,
  val totalBytes: Long = 0,
  val currentFileKey: String? = null,
  val currentFilename: String? = null,
  val currentFileConfirmedBytes: Long = 0,
  val currentFileTotalBytes: Long = 0,
  val currentSpeedMbps: Double = 0.0,
  val retryAttempt: Int? = null,
  val retryDelaySec: Int? = null,
  val lastErrorCode: String? = null,
  val lastErrorMessage: String? = null,
  val performanceHint: String = "none",
  val performanceMessage: String? = null,
  val thermalState: String = "unknown",
  val activeTuningProfile: String = "idle",
  val isThermalLimited: Boolean = false,
  val currentTaskSource: String? = null,
  val lastCompletedTaskSource: String? = null,
  val autoUploadState: String = "disabled",
  val manualPending: Int = 0,
  val autoPending: Int = 0,
  val roundBaselineCompletedCount: Int = 0,
  val roundBaselineCompletedBytes: Long = 0,
)

data class AndroidSyncOverviewFields(
  val currentDeviceId: String?,
  val currentDeviceName: String?,
  val currentSpeedMbps: Double,
  val transferredBytes: Double,
  val totalBytes: Double,
  val progressPercent: Double,
  val uploadState: String,
  val performanceHint: String,
  val performanceMessage: String?,
  val thermalState: String,
  val activeTuningProfile: String,
  val isThermalLimited: Boolean,
  val completedCount: Double,
  val totalCount: Double,
  val completedBytes: Double,
  val roundBaselineCompletedCount: Double,
  val roundBaselineCompletedBytes: Double,
  val currentFile: String?,
  val currentFilename: String?,
  val currentFileConfirmedBytes: Double,
  val currentFileTotalBytes: Double,
  val sessionId: String,
  val state: String,
  val retryAttempt: Double?,
  val retryDelaySec: Double?,
  val lastErrorCode: String?,
  val lastErrorMessage: String?,
  val currentTaskSource: String?,
  val lastCompletedTaskSource: String?,
  val autoUploadState: String,
  val manualPending: Double,
  val autoPending: Double,
)

object AndroidSyncPrimitives {
  fun normalizePairingConnectionCode(rawCode: String?): String {
    val trimmed = rawCode?.trim().orEmpty()
    require(trimmed.isEmpty() || trimmed.length == CONNECTION_CODE_LENGTH) {
      "Connection code must be empty or $CONNECTION_CODE_LENGTH digits"
    }
    return trimmed
  }

  fun shouldUseStoredPairingToken(connectionCode: String): Boolean =
    connectionCode.trim().isEmpty()

  fun shouldStartAutoUploadRound(
    previousEnabled: Boolean,
    previousState: String,
    nextEnabled: Boolean,
    nextState: String,
  ): Boolean =
    nextEnabled &&
      nextState == "active" &&
      (!previousEnabled || previousState != "active")

  fun shouldContinueAutoUploadRound(
    roundReason: String,
    itemSource: String,
    autoUploadState: String,
  ): Boolean {
    if (roundReason == "manual_upload" || itemSource != "auto") {
      return true
    }
    return autoUploadState == "active"
  }

  fun buildClientHelloPayloadFields(
    clientId: String,
    clientName: String,
    clientPlatform: String,
    appVersion: String,
    appState: String,
    clientIp: String? = null,
    pairingToken: String? = null,
  ): Map<String, String> {
    val fields = linkedMapOf(
      "clientId" to clientId,
      "clientName" to clientName,
      "clientPlatform" to clientPlatform,
      "appVersion" to appVersion,
      "appState" to appState,
    )
    clientIp?.trim()?.takeIf { it.isNotBlank() }?.let {
      fields["clientIp"] = it
    }
    pairingToken?.trim()?.takeIf { it.isNotBlank() }?.let {
      fields["pairingToken"] = it
    }
    return fields
  }

  fun shouldProbeBindingConnectionState(currentState: String): Boolean =
    currentState.trim().ifBlank { "bound" } in LIVE_BINDING_STATES

  fun deriveBindingConnectionStateFromProbe(
    currentState: String,
    reachable: Boolean,
  ): String {
    val normalized = currentState.trim().ifBlank { "bound" }
    if (normalized !in LIVE_BINDING_STATES && !(normalized == "offline" && reachable)) {
      return normalized
    }
    return if (reachable) "connected" else "offline"
  }

  fun shouldRequestNearbyWifiPermission(
    sdkInt: Int,
    permissionGranted: Boolean,
  ): Boolean = sdkInt >= ANDROID_13_API && !permissionGranted

  fun buildSubnetProbeHosts(
    clientIp: String,
    prefixLength: Int,
    maxHosts: Int,
  ): List<String> {
    if (prefixLength !in 1..30 || maxHosts <= 0) {
      return emptyList()
    }

    val client = ipv4ToLong(clientIp) ?: return emptyList()
    val mask = (IPV4_MASK shl (32 - prefixLength)) and IPV4_MASK
    val network = client and mask
    val broadcast = network or (mask.inv() and IPV4_MASK)
    val firstHost = network + 1
    val lastHost = broadcast - 1
    val hostCount = lastHost - firstHost + 1
    if (hostCount <= 0 || hostCount > maxHosts) {
      return emptyList()
    }

    val hosts = mutableListOf<String>()
    var current = firstHost
    while (current <= lastHost) {
      if (current != client) {
        hosts.add(longToIpv4(current))
      }
      current += 1
    }
    return hosts
  }

  fun fallbackDiscoveryName(
    serverName: String?,
    host: String,
  ): String {
    val normalizedServerName = serverName?.trim().orEmpty()
    if (normalizedServerName.isNotBlank()) {
      return normalizedServerName
    }
    return "Vivi Drop ${host.trim()}"
  }

  fun buildPresenceHeartbeatUrl(
    host: String,
    port: Int,
    clientId: String,
  ): String {
    val normalizedHost = host.trim()
    val normalizedClientId = clientId.trim()
    require(normalizedHost.isNotBlank()) { "Presence heartbeat host is required" }
    require(port in 1..65_535) { "Presence heartbeat port is invalid" }
    require(normalizedClientId.isNotBlank() && '/' !in normalizedClientId) {
      "Presence heartbeat clientId is invalid"
    }

    val hostPart = if (':' in normalizedHost && !normalizedHost.startsWith("[")) {
      "[$normalizedHost]"
    } else {
      normalizedHost
    }
    return "http://$hostPart:$port/presence/$normalizedClientId"
  }

  fun shouldStartPresenceRecoveryAfterHeartbeatFailure(
    connectionState: String,
    syncInProgress: Boolean,
  ): Boolean =
    connectionState.trim() == "connected" && !syncInProgress

  fun shouldRefreshBoundPresenceFromDiscovery(
    bindingDeviceId: String,
    candidateDeviceId: String,
    connectionState: String,
  ): Boolean {
    val normalizedBindingDeviceId = bindingDeviceId.trim()
    val normalizedCandidateDeviceId = candidateDeviceId.trim()
    if (normalizedBindingDeviceId.isBlank() || normalizedBindingDeviceId != normalizedCandidateDeviceId) {
      return false
    }
    return connectionState.trim() != "connected"
  }

  fun computeFileKey(
    clientId: String,
    assetLocalId: String,
    mediaType: String,
  ): String = sha256Hex("$clientId|$assetLocalId|$mediaType".toByteArray(Charsets.UTF_8))

  fun computeAuthHmac(
    pairingToken: String,
    nonceHex: String,
  ): String {
    val tokenHash = MessageDigest.getInstance("SHA-256")
      .digest(pairingToken.toByteArray(Charsets.UTF_8))
    val nonceBytes = hexToBytes(nonceHex)
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(tokenHash, "HmacSHA256"))
    return mac.doFinal(nonceBytes).toHex()
  }

  fun sortedPendingItems(items: List<AndroidUploadItem>): List<AndroidUploadItem> =
    items
      .filter { it.status in PENDING_STATUSES }
      .sortedWith(
        compareByDescending<AndroidUploadItem> { it.source == "manual" }
          .thenBy { it.updatedAt }
          .thenBy { it.fileKey },
      )

  fun classifyMediaType(mimeType: String, filename: String): String {
    val normalizedMime = mimeType.lowercase()
    val ext = filename.substringAfterLast('.', "").lowercase()
    return when {
      normalizedMime.startsWith("video/") -> "video"
      normalizedMime.startsWith("image/") -> "image"
      ext in setOf("mp4", "mov", "m4v", "avi", "mkv") -> "video"
      else -> "image"
    }
  }

  fun mimeTypeForFilename(filename: String, fallback: String = "application/octet-stream"): String {
    return when (filename.substringAfterLast('.', "").lowercase()) {
      "jpg", "jpeg" -> "image/jpeg"
      "png" -> "image/png"
      "heic" -> "image/heic"
      "heif" -> "image/heif"
      "gif" -> "image/gif"
      "webp" -> "image/webp"
      "mp4" -> "video/mp4"
      "mov" -> "video/quicktime"
      "m4v" -> "video/x-m4v"
      else -> fallback
    }
  }

  fun writeZipArchive(archive: File, entries: Map<String, ByteArray>) {
    require(entries.isNotEmpty()) { "Diagnostics archive must contain at least one entry" }
    archive.parentFile?.mkdirs()
    ZipOutputStream(BufferedOutputStream(archive.outputStream())).use { zip ->
      for ((entryName, bytes) in entries) {
        require(entryName.isNotBlank() && !entryName.startsWith("/")) {
          "Invalid zip entry name"
        }
        zip.putNextEntry(ZipEntry(entryName))
        zip.write(bytes)
        zip.closeEntry()
      }
    }
  }

  fun buildDiagnosticsArchiveEntries(
    diagnosticsJson: String,
    queueJson: String,
    historyJson: String,
    engineLogLines: List<String>,
  ): Map<String, ByteArray> =
    linkedMapOf(
      "diagnostics.json" to diagnosticsJson.toByteArray(Charsets.UTF_8),
      "queue.json" to queueJson.toByteArray(Charsets.UTF_8),
      "history.json" to historyJson.toByteArray(Charsets.UTF_8),
      "engine.log" to engineLogLines.joinToString(separator = "\n").toByteArray(Charsets.UTF_8),
    )

  fun buildDiagnosticsLogLine(
    timestampIso: String,
    category: String,
    message: String,
  ): String =
    "${timestampIso.trim()} [${normalizeLogCategory(category)}] ${normalizeLogMessage(message)}"

  fun buildConsoleLogMessage(
    localTimestamp: String,
    category: String,
    message: String,
  ): String =
    "[${localTimestamp.trim()}] [${normalizeLogCategory(category)}] ${normalizeLogMessage(message)}"

  fun retainRecentLogLines(lines: List<String>, maxLines: Int): List<String> {
    require(maxLines > 0) { "maxLines must be positive" }
    return if (lines.size <= maxLines) lines else lines.takeLast(maxLines)
  }

  fun computeTransferSpeedMbps(bytesDelta: Long, elapsedMs: Long): Double {
    if (bytesDelta <= 0L || elapsedMs <= 0L) {
      return 0.0
    }
    val elapsedSeconds = elapsedMs.toDouble() / 1_000.0
    return bytesDelta.toDouble() / elapsedSeconds / (1024.0 * 1024.0)
  }

  fun pendingCount(items: List<AndroidUploadItem>, source: String? = null): Int =
    items.count { it.status in PENDING_STATUSES && (source == null || it.source == source) }

  fun buildSyncOverviewFields(input: AndroidSyncOverviewInput): AndroidSyncOverviewFields {
    val clearsActiveFile = input.uploadState == "idle" || input.uploadState == "completed"
    val activeFileConfirmedBytes = if (clearsActiveFile) 0L else input.currentFileConfirmedBytes
    val activeFileTotalBytes = if (clearsActiveFile) 0L else input.currentFileTotalBytes
    val transferredBytes = when (input.uploadState) {
      "completed" -> input.completedBytes
      "idle" -> 0L
      else -> input.completedBytes + activeFileConfirmedBytes
    }
    val progressPercent = when {
      input.uploadState == "completed" -> 100.0
      input.uploadState == "idle" -> 0.0
      input.totalBytes > 0L -> transferredBytes.toDouble() / input.totalBytes.toDouble() * 100.0
      activeFileTotalBytes > 0L -> activeFileConfirmedBytes.toDouble() / activeFileTotalBytes.toDouble() * 100.0
      input.totalCount > 0 && input.completedCount >= input.totalCount -> 100.0
      else -> 0.0
    }.coerceIn(0.0, 100.0)

    return AndroidSyncOverviewFields(
      currentDeviceId = input.currentDeviceId,
      currentDeviceName = input.currentDeviceName,
      currentSpeedMbps = input.currentSpeedMbps,
      transferredBytes = transferredBytes.toDouble(),
      totalBytes = input.totalBytes.toDouble(),
      progressPercent = progressPercent,
      uploadState = input.uploadState,
      performanceHint = input.performanceHint,
      performanceMessage = input.performanceMessage,
      thermalState = input.thermalState,
      activeTuningProfile = input.activeTuningProfile,
      isThermalLimited = input.isThermalLimited,
      completedCount = input.completedCount.toDouble(),
      totalCount = input.totalCount.toDouble(),
      completedBytes = input.completedBytes.toDouble(),
      roundBaselineCompletedCount = input.roundBaselineCompletedCount.toDouble(),
      roundBaselineCompletedBytes = input.roundBaselineCompletedBytes.toDouble(),
      currentFile = if (clearsActiveFile) null else input.currentFileKey,
      currentFilename = if (clearsActiveFile) null else input.currentFilename,
      currentFileConfirmedBytes = activeFileConfirmedBytes.toDouble(),
      currentFileTotalBytes = activeFileTotalBytes.toDouble(),
      sessionId = input.sessionId,
      state = input.state ?: input.uploadState,
      retryAttempt = input.retryAttempt?.toDouble(),
      retryDelaySec = input.retryDelaySec?.toDouble(),
      lastErrorCode = input.lastErrorCode,
      lastErrorMessage = input.lastErrorMessage,
      currentTaskSource = if (clearsActiveFile) null else input.currentTaskSource,
      lastCompletedTaskSource = input.lastCompletedTaskSource,
      autoUploadState = input.autoUploadState,
      manualPending = input.manualPending.toDouble(),
      autoPending = input.autoPending.toDouble(),
    )
  }

  private fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

  private fun normalizeLogCategory(category: String): String =
    category.trim().ifBlank { "NativeSyncEngine" }

  private fun normalizeLogMessage(message: String): String =
    message.trim().ifBlank { "<empty>" }

  private fun ipv4ToLong(ip: String): Long? {
    val parts = ip.trim().split(".")
    if (parts.size != 4) {
      return null
    }

    var result = 0L
    for (part in parts) {
      val octet = part.toIntOrNull() ?: return null
      if (octet !in 0..255) {
        return null
      }
      result = (result shl 8) or octet.toLong()
    }
    return result and IPV4_MASK
  }

  private fun longToIpv4(value: Long): String =
    listOf(
      (value ushr 24) and 0xff,
      (value ushr 16) and 0xff,
      (value ushr 8) and 0xff,
      value and 0xff,
    ).joinToString(".")

  private fun hexToBytes(hex: String): ByteArray {
    val normalized = hex.trim()
    require(normalized.length % 2 == 0) { "Invalid hex length" }
    return ByteArray(normalized.length / 2) { index ->
      normalized.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }
  }

  private fun ByteArray.toHex(): String = joinToString(separator = "") { byte ->
    "%02x".format(byte)
  }

  private val PENDING_STATUSES = setOf(
    "discovered",
    "queued",
    "preparing",
    "ready",
    "cloud_downloading",
    "uploading",
  )

  private const val CONNECTION_CODE_LENGTH = 6
  private const val ANDROID_13_API = 33
  private const val IPV4_MASK = 0xffffffffL
  private val LIVE_BINDING_STATES = setOf("connected", "bound")
}
