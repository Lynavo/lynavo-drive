package com.lynavo.drive.mobile.demo.sync

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class AndroidMediaAsset(
  val assetLocalId: String,
  val filename: String,
  val mediaType: String,
  val mimeType: String,
  val fileSize: Long,
  val createdAt: String,
  val modifiedAt: String,
  val uri: String,
  val bucketId: String,
  val bucketName: String,
)

class AndroidMediaStoreRepository(private val context: Context) {
  fun scanAssets(clientId: String, createdAfterEpochMillis: Long? = null): List<AndroidUploadItem> =
    queryAssets(
      mediaFilter = "all",
      collectionId = null,
      createdAfterEpochMillis = createdAfterEpochMillis,
    )
      .map { asset -> asset.toUploadItem(clientId = clientId, source = "auto", batchId = null) }

  fun findAssetsByIds(assetLocalIds: List<String>, clientId: String, source: String, batchId: String): List<AndroidUploadItem> {
    if (assetLocalIds.isEmpty()) {
      return emptyList()
    }
    val assetById = queryAssets(mediaFilter = "all", collectionId = null)
      .associateBy { it.assetLocalId }
    return assetLocalIds.mapNotNull { id ->
      assetById[id]?.toUploadItem(clientId = clientId, source = source, batchId = batchId)
    }
  }

  fun browseAlbum(
    mediaFilter: String,
    transferFilter: String,
    offset: Int,
    limit: Int,
    collectionId: String?,
    items: List<AndroidUploadItem>,
  ): WritableArray {
    val transferredIds = items
      .filter { it.status == "completed" }
      .mapTo(mutableSetOf()) { it.assetLocalId }
    val queuedIds = items
      .filter { it.status in PENDING_STATUSES }
      .mapTo(mutableSetOf()) { it.assetLocalId }

    val sorted = queryAssets(mediaFilter, collectionId)
      .filter { asset ->
        when (transferFilter) {
          "untransferred" -> asset.assetLocalId !in transferredIds
          "transferred" -> asset.assetLocalId in transferredIds
          else -> true
        }
      }
      .sortedWith(
        compareBy<AndroidMediaAsset> { if (it.assetLocalId in transferredIds) 2 else if (it.assetLocalId in queuedIds) 1 else 0 }
          .thenByDescending { it.createdAt },
      )

    val safeOffset = offset.coerceAtLeast(0)
    val safeLimit = limit.coerceIn(1, 200)
    return Arguments.createArray().apply {
      for (asset in sorted.drop(safeOffset).take(safeLimit)) {
        pushMap(asset.toAlbumMap(
          isTransferred = asset.assetLocalId in transferredIds,
          isQueued = asset.assetLocalId in queuedIds,
        ))
      }
    }
  }

  fun getStats(items: List<AndroidUploadItem>): WritableMap {
    val assets = queryAssets(mediaFilter = "all", collectionId = null)
    val transferredIds = items
      .filter { it.status == "completed" }
      .mapTo(mutableSetOf()) { it.assetLocalId }
    val queuedIds = items
      .filter { it.status in PENDING_STATUSES }
      .mapTo(mutableSetOf()) { it.assetLocalId }
    return Arguments.createMap().apply {
      putInt("totalCount", assets.size)
      putInt("transferredCount", transferredIds.size)
      putInt("queuedCount", queuedIds.size)
      putInt("pendingCount", (assets.size - transferredIds.size).coerceAtLeast(0))
    }
  }

  fun getCollections(mediaFilter: String): WritableArray {
    val grouped = queryAssets(mediaFilter = mediaFilter, collectionId = null)
      .filter { it.bucketId.isNotBlank() }
      .groupBy { it.bucketId }
      .map { (bucketId, assets) ->
        Triple(
          bucketId,
          assets.firstOrNull()?.bucketName?.takeIf { it.isNotBlank() } ?: "Album",
          assets.size,
        )
      }
      .sortedWith(compareByDescending<Triple<String, String, Int>> { it.third }.thenBy { it.second.lowercase(Locale.US) })

    return Arguments.createArray().apply {
      for ((bucketId, title, count) in grouped) {
        pushMap(Arguments.createMap().apply {
          putString("collectionId", bucketId)
          putString("title", title)
          putInt("count", count)
        })
      }
    }
  }

  fun getPreview(assetLocalId: String): WritableMap {
    val uri = runCatching { Uri.parse(assetLocalId) }.getOrNull()
    val asset = if (uri != null) {
      queryAssetByUri(uri)
    } else {
      null
    }
    return Arguments.createMap().apply {
      if (asset == null) {
        putString("uri", "")
        putString("mediaType", "image")
        putString("error", "not_found")
      } else {
        putString("uri", asset.uri)
        putString("mediaType", asset.mediaType)
      }
    }
  }

  fun openInputStream(item: AndroidUploadItem) =
    context.contentResolver.openInputStream(Uri.parse(item.uri))

  private fun queryAssetByUri(uri: Uri): AndroidMediaAsset? {
    val collectionUri = when {
      uri.toString().contains("/video/", ignoreCase = true) -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      else -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    }
    val id = ContentUris.parseId(uri)
    val projection = assetProjection()
    val selection = "${MediaStore.MediaColumns._ID}=?"
    val args = arrayOf(id.toString())
    context.contentResolver.query(collectionUri, projection, selection, args, null)?.use { cursor ->
      return if (cursor.moveToFirst()) readAsset(cursor, collectionUri) else null
    }
    return null
  }

  private fun queryAssets(
    mediaFilter: String,
    collectionId: String?,
    createdAfterEpochMillis: Long? = null,
  ): List<AndroidMediaAsset> {
    val collections = when (mediaFilter) {
      "photos", "image", "images" -> listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
      "videos", "video" -> listOf(MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
      else -> listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
    }
    return collections.flatMap { uri -> queryCollection(uri, collectionId, createdAfterEpochMillis) }
      .sortedByDescending { it.createdAt }
  }

  private fun queryCollection(
    collectionUri: Uri,
    collectionId: String?,
    createdAfterEpochMillis: Long?,
  ): List<AndroidMediaAsset> {
    val projection = assetProjection()
    val selectionParts = mutableListOf<String>()
    val selectionArgs = mutableListOf<String>()
    if (!collectionId.isNullOrBlank()) {
      selectionParts.add("${MediaStore.MediaColumns.BUCKET_ID}=?")
      selectionArgs.add(collectionId)
    }
    val creationTimeFilter = AndroidSyncPrimitives.autoUploadCreationTimeFilter(createdAfterEpochMillis)
    if (creationTimeFilter != null) {
      selectionParts.add(creationTimeFilter.selection)
      selectionArgs.add(creationTimeFilter.selectionArg)
    }
    val selection = selectionParts.takeIf { it.isNotEmpty() }?.joinToString(" AND ")
    val sortOrder = "${MediaStore.MediaColumns.DATE_ADDED} DESC"
    val result = mutableListOf<AndroidMediaAsset>()
    context.contentResolver.query(collectionUri, projection, selection, selectionArgs.toTypedArray(), sortOrder)?.use { cursor ->
      while (cursor.moveToNext()) {
        val asset = runCatching { readAsset(cursor, collectionUri) }.getOrNull()
        if (asset != null && asset.fileSize >= 0) {
          result.add(asset)
        }
      }
    }
    return result
  }

  private fun assetProjection(): Array<String> = arrayOf(
    MediaStore.MediaColumns._ID,
    MediaStore.MediaColumns.DISPLAY_NAME,
    MediaStore.MediaColumns.SIZE,
    MediaStore.MediaColumns.MIME_TYPE,
    MediaStore.MediaColumns.DATE_ADDED,
    MediaStore.MediaColumns.DATE_MODIFIED,
    MediaStore.MediaColumns.BUCKET_ID,
    MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
  )

  private fun readAsset(cursor: Cursor, collectionUri: Uri): AndroidMediaAsset {
    val id = cursor.long(MediaStore.MediaColumns._ID)
    val filename = cursor.string(MediaStore.MediaColumns.DISPLAY_NAME)
      .takeIf { it.isNotBlank() }
      ?: "asset-$id"
    val uri = ContentUris.withAppendedId(collectionUri, id)
    val mimeType = cursor.string(MediaStore.MediaColumns.MIME_TYPE)
      .takeIf { it.isNotBlank() }
      ?: AndroidSyncPrimitives.mimeTypeForFilename(filename)
    val mediaType = AndroidSyncPrimitives.classifyMediaType(mimeType, filename)
    val addedSeconds = cursor.long(MediaStore.MediaColumns.DATE_ADDED)
    val modifiedSeconds = cursor.long(MediaStore.MediaColumns.DATE_MODIFIED)
    return AndroidMediaAsset(
      assetLocalId = uri.toString(),
      filename = filename,
      mediaType = mediaType,
      mimeType = mimeType,
      fileSize = cursor.long(MediaStore.MediaColumns.SIZE),
      createdAt = secondsToIso(addedSeconds),
      modifiedAt = secondsToIso(modifiedSeconds.takeIf { it > 0 } ?: addedSeconds),
      uri = uri.toString(),
      bucketId = cursor.string(MediaStore.MediaColumns.BUCKET_ID),
      bucketName = cursor.string(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME),
    )
  }

  private fun AndroidMediaAsset.toUploadItem(clientId: String, source: String, batchId: String?): AndroidUploadItem {
    val now = isoNow()
    return AndroidUploadItem(
      assetLocalId = assetLocalId,
      fileKey = AndroidSyncPrimitives.computeFileKey(clientId, assetLocalId, mediaType),
      filename = filename,
      mediaType = mediaType,
      mimeType = mimeType,
      fileSize = fileSize,
      createdAt = createdAt,
      modifiedAt = modifiedAt,
      uri = uri,
      status = "queued",
      source = source,
      batchId = batchId,
      ackedOffset = 0,
      updatedAt = now,
    )
  }

  private fun AndroidMediaAsset.toAlbumMap(isTransferred: Boolean, isQueued: Boolean): WritableMap =
    Arguments.createMap().apply {
      putString("assetLocalId", assetLocalId)
      putString("filename", filename)
      putString("mediaType", mediaType)
      putDouble("fileSize", fileSize.toDouble())
      putString("creationDate", createdAt)
      putString("thumbnailUri", uri)
      putBoolean("isTransferred", isTransferred)
      putBoolean("isQueued", isQueued)
    }

  private fun Cursor.string(column: String): String {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getString(index).orEmpty() else ""
  }

  private fun Cursor.long(column: String): Long {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getLong(index) else 0L
  }

  private fun secondsToIso(seconds: Long): String =
    isoFormatter().format(Date(seconds.coerceAtLeast(0) * 1000))

  private fun isoNow(): String = isoFormatter().format(Date())

  private fun isoFormatter(): SimpleDateFormat {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter
  }

  companion object {
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
