package com.vividrop.mobile.china.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.vividrop.mobile.china.MainActivity
import com.vividrop.mobile.china.R

class AndroidForegroundSyncService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      NativeSyncEngineModule.requestForegroundSyncStop()
      startForeground(
        NOTIFICATION_ID,
        buildNotification(
          title = "Vivi Drop 正在停止同步",
          text = "目前檔案會中斷並保留在佇列中。",
        ),
      )
      return START_NOT_STICKY
    }

    val reason = intent?.getStringExtra(EXTRA_REASON).orEmpty()
    startForeground(
      NOTIFICATION_ID,
      buildNotification(
        title = "Vivi Drop 正在背景同步",
        text = notificationTextForReason(reason),
      ),
    )
    return START_NOT_STICKY
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "背景同步",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Vivi Drop 背景上傳檔案時顯示的常駐通知。"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, text: String): Notification {
    val openIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val stopIntent = PendingIntent.getService(
      this,
      1,
      Intent(this, AndroidForegroundSyncService::class.java).apply {
        action = ACTION_STOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_vividrop_sync)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(openIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .addAction(R.drawable.ic_stat_vividrop_sync, "停止", stopIntent)
      .build()
  }

  private fun notificationTextForReason(reason: String): String =
    when (reason) {
      "manual_upload", "manual_trigger" -> "正在上傳佇列中的檔案。"
      "manual_reconnect" -> "重新連線後繼續上傳未完成檔案。"
      else -> "正在自動上傳新的相簿檔案。"
    }

  companion object {
    private const val CHANNEL_ID = "vividrop_background_sync"
    private const val NOTIFICATION_ID = 39_393
    private const val ACTION_START = "com.vividrop.mobile.sync.START_BACKGROUND_SYNC"
    private const val ACTION_STOP = "com.vividrop.mobile.sync.STOP_BACKGROUND_SYNC"
    private const val EXTRA_REASON = "reason"

    fun start(context: Context, reason: String) {
      val intent = Intent(context, AndroidForegroundSyncService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_REASON, reason)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    fun finish(context: Context) {
      context.stopService(Intent(context, AndroidForegroundSyncService::class.java))
    }
  }
}
