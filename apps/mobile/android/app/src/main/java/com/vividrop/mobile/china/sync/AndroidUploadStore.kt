package com.vividrop.mobile.china.sync

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject

data class AndroidHistoryLedger(
  val ledgerDate: String,
  val deviceId: String,
  val deviceName: String,
  val deviceIp: String,
  val fileCount: Int,
  val totalBytes: Long,
  val activeTransmissionMs: Long,
  val updatedAt: String,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("ledgerDate", ledgerDate)
    put("deviceId", deviceId)
    put("deviceName", deviceName)
    put("deviceIp", deviceIp)
    put("fileCount", fileCount)
    put("totalBytes", totalBytes)
    put("activeTransmissionMs", activeTransmissionMs)
    put("transmissionMs", activeTransmissionMs)
    put("updatedAt", updatedAt)
  }

  fun toWritableMap(): WritableMap = Arguments.createMap().apply {
    putString("ledgerDate", ledgerDate)
    putString("dateKey", ledgerDate)
    putString("deviceId", deviceId)
    putString("deviceName", deviceName)
    putString("deviceIp", deviceIp)
    putInt("fileCount", fileCount)
    putDouble("totalFileCount", fileCount.toDouble())
    putDouble("totalBytes", totalBytes.toDouble())
    putDouble("activeTransmissionMs", activeTransmissionMs.toDouble())
    putDouble("transmissionMs", activeTransmissionMs.toDouble())
    putDouble("activeTransmissionSeconds", activeTransmissionMs.toDouble() / 1000.0)
    putString("updatedAt", updatedAt)
  }

  companion object {
    fun fromJson(json: JSONObject): AndroidHistoryLedger = AndroidHistoryLedger(
      ledgerDate = json.optString("ledgerDate"),
      deviceId = json.optString("deviceId"),
      deviceName = json.optString("deviceName"),
      deviceIp = json.optString("deviceIp"),
      fileCount = json.optInt("fileCount", 0),
      totalBytes = json.optLong("totalBytes", 0),
      activeTransmissionMs = json.optLong(
        "activeTransmissionMs",
        json.optLong("transmissionMs", 0),
      ),
      updatedAt = json.optString("updatedAt"),
    )
  }
}

class AndroidUploadStore(context: Context) {
  private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  @Synchronized
  fun getAllItems(): List<AndroidUploadItem> = readItems()

  @Synchronized
  fun getPendingItems(limit: Int = 100): List<AndroidUploadItem> =
    AndroidSyncPrimitives.sortedPendingItems(readItems()).take(limit)

  @Synchronized
  fun getItemByAssetId(assetLocalId: String): AndroidUploadItem? =
    readItems().firstOrNull { it.assetLocalId == assetLocalId }

  @Synchronized
  fun upsertItems(items: List<AndroidUploadItem>) {
    if (items.isEmpty()) {
      return
    }
    val merged = linkedMapOf<String, AndroidUploadItem>()
    for (item in readItems()) {
      merged[item.fileKey] = item
    }
    for (item in items) {
      merged[item.fileKey] = item
    }
    writeItems(merged.values.toList())
  }

  @Synchronized
  fun updateStatus(fileKey: String, status: String, updatedAt: String) {
    writeItems(
      readItems().map { item ->
        if (item.fileKey == fileKey) {
          item.copy(status = status, updatedAt = updatedAt)
        } else {
          item
        }
      },
    )
  }

  @Synchronized
  fun updateOffset(fileKey: String, ackedOffset: Long, updatedAt: String) {
    writeItems(
      readItems().map { item ->
        if (item.fileKey == fileKey) {
          item.copy(ackedOffset = ackedOffset, updatedAt = updatedAt)
        } else {
          item
        }
      },
    )
  }

  @Synchronized
  fun cancelManualBatch(batchId: String, updatedAt: String) {
    writeItems(
      readItems().map { item ->
        if (item.batchId == batchId && item.source == "manual" && item.status in PENDING_STATUSES) {
          item.copy(status = "cancelled", updatedAt = updatedAt)
        } else {
          item
        }
      },
    )
  }

  @Synchronized
  fun cancelAllManual(updatedAt: String) {
    writeItems(
      readItems().map { item ->
        if (item.source == "manual" && item.status in PENDING_STATUSES) {
          item.copy(status = "cancelled", updatedAt = updatedAt)
        } else {
          item
        }
      },
    )
  }

  @Synchronized
  fun cancelPendingAutoItems(updatedAt: String) {
    writeItems(AndroidSyncPrimitives.cancelPendingAutoItems(readItems(), updatedAt))
  }

  @Synchronized
  fun resetQueue() {
    prefs.edit().remove(PREF_QUEUE).apply()
  }

  @Synchronized
  fun upsertLedger(ledger: AndroidHistoryLedger) {
    val ledgers = linkedMapOf<String, AndroidHistoryLedger>()
    for (item in readLedgers()) {
      ledgers[item.ledgerDate] = item
    }
    val existing = ledgers[ledger.ledgerDate]
    ledgers[ledger.ledgerDate] = if (existing == null) {
      ledger
    } else {
      existing.copy(
        fileCount = existing.fileCount + ledger.fileCount,
        totalBytes = existing.totalBytes + ledger.totalBytes,
        activeTransmissionMs = existing.activeTransmissionMs + ledger.activeTransmissionMs,
        updatedAt = ledger.updatedAt,
        deviceId = ledger.deviceId,
        deviceName = ledger.deviceName,
        deviceIp = ledger.deviceIp,
      )
    }
    writeLedgers(ledgers.values.sortedByDescending { it.ledgerDate })
  }

  @Synchronized
  fun getLedgers(limit: Int = 90): List<AndroidHistoryLedger> =
    readLedgers().sortedByDescending { it.ledgerDate }.take(limit)

  fun queueToWritableArray(items: List<AndroidUploadItem>): WritableArray =
    Arguments.createArray().apply {
      for ((index, item) in items.withIndex()) {
        pushMap(item.toWritableMap(index))
      }
    }

  fun historyToWritableArray(items: List<AndroidHistoryLedger>): WritableArray =
    Arguments.createArray().apply {
      for (item in items) {
        pushMap(item.toWritableMap())
      }
    }

  private fun readItems(): List<AndroidUploadItem> {
    val raw = prefs.getString(PREF_QUEUE, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      buildList {
        for (index in 0 until array.length()) {
          val item = runCatching {
            AndroidUploadItem.fromJson(array.getJSONObject(index))
          }.getOrNull()
          if (item != null) {
            add(item)
          }
        }
      }
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun writeItems(items: List<AndroidUploadItem>) {
    val retained = items
      .sortedWith(
        compareByDescending<AndroidUploadItem> { it.source == "manual" }
          .thenBy { it.updatedAt }
          .thenBy { it.fileKey },
      )
      .take(MAX_STORED_QUEUE_ITEMS)
    val array = JSONArray()
    for (item in retained) {
      array.put(item.toJson())
    }
    prefs.edit().putString(PREF_QUEUE, array.toString()).apply()
  }

  private fun readLedgers(): List<AndroidHistoryLedger> {
    val raw = prefs.getString(PREF_HISTORY, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      buildList {
        for (index in 0 until array.length()) {
          val ledger = runCatching {
            AndroidHistoryLedger.fromJson(array.getJSONObject(index))
          }.getOrNull()
          if (ledger != null && ledger.ledgerDate.isNotBlank()) {
            add(ledger)
          }
        }
      }
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun writeLedgers(items: List<AndroidHistoryLedger>) {
    val array = JSONArray()
    for (item in items.take(MAX_STORED_HISTORY_DAYS)) {
      array.put(item.toJson())
    }
    prefs.edit().putString(PREF_HISTORY, array.toString()).apply()
  }

  companion object {
    private const val PREFS_NAME = NativeSyncEngineModule.PREFS_NAME
    private const val PREF_QUEUE = "android_upload_queue"
    private const val PREF_HISTORY = "android_history_ledgers"
    private const val MAX_STORED_QUEUE_ITEMS = 10_000
    private const val MAX_STORED_HISTORY_DAYS = 180
    private val PENDING_STATUSES = setOf(
      "discovered",
      "queued",
      "preparing",
      "ready",
      "cloud_downloading",
      "uploading",
    )
  }
}

fun AndroidUploadItem.toJson(): JSONObject = JSONObject().apply {
  put("assetLocalId", assetLocalId)
  put("fileKey", fileKey)
  put("filename", filename)
  put("mediaType", mediaType)
  put("mimeType", mimeType)
  put("fileSize", fileSize)
  put("createdAt", createdAt)
  put("modifiedAt", modifiedAt)
  put("uri", uri)
  put("status", status)
  put("source", source)
  put("batchId", batchId ?: JSONObject.NULL)
  put("ackedOffset", ackedOffset)
  put("updatedAt", updatedAt)
}

fun AndroidUploadItem.toWritableMap(index: Int): WritableMap = Arguments.createMap().apply {
  putInt("id", index)
  putString("assetLocalId", assetLocalId)
  putString("fileKey", fileKey)
  putString("filename", filename)
  putString("originalFilename", filename)
  putString("mediaType", mediaType)
  putDouble("fileSize", fileSize.toDouble())
  putDouble("ackedOffset", ackedOffset.toDouble())
  putString("status", bridgeQueueStatus(status))
  putBoolean("isCloudAsset", false)
  putString("source", source)
  if (batchId.isNullOrBlank()) {
    putNull("batchId")
  } else {
    putString("batchId", batchId)
  }
  putDouble("progress", if (fileSize > 0) ackedOffset.toDouble() / fileSize.toDouble() else 0.0)
}

private fun bridgeQueueStatus(status: String): String = when (status) {
  "uploading" -> "uploading"
  "completed" -> "completed"
  "cancelled" -> "cancelled"
  else -> status
}

fun AndroidUploadItem.Companion.fromJson(json: JSONObject): AndroidUploadItem = AndroidUploadItem(
  assetLocalId = json.optString("assetLocalId"),
  fileKey = json.optString("fileKey"),
  filename = json.optString("filename"),
  mediaType = json.optString("mediaType").ifBlank { "image" },
  mimeType = json.optString("mimeType").ifBlank {
    AndroidSyncPrimitives.mimeTypeForFilename(json.optString("filename"))
  },
  fileSize = json.optLong("fileSize", 0),
  createdAt = json.optString("createdAt"),
  modifiedAt = json.optString("modifiedAt"),
  uri = json.optString("uri"),
  status = json.optString("status").ifBlank { "queued" },
  source = json.optString("source").ifBlank { "auto" },
  batchId = json.optString("batchId").takeIf { it.isNotBlank() },
  ackedOffset = json.optLong("ackedOffset", 0),
  updatedAt = json.optString("updatedAt"),
)
