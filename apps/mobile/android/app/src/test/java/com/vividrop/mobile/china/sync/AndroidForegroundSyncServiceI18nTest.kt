package com.vividrop.mobile.china.sync

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidForegroundSyncServiceI18nTest {
  @Test
  fun foregroundSyncNotificationStringsExistInDefaultSimplifiedAndTraditionalResources() {
    val requiredKeys = setOf(
      "background_sync_notification_channel_name",
      "background_sync_notification_channel_description",
      "background_sync_notification_title",
      "background_sync_notification_stopping_title",
      "background_sync_notification_stopping_text",
      "background_sync_notification_manual_text",
      "background_sync_notification_reconnect_text",
      "background_sync_notification_auto_text",
      "background_sync_notification_stop_action",
    )

    for (resourceDir in listOf("values", "values-zh-rCN", "values-zh-rTW")) {
      val stringsFile = androidAppDir()
        .resolve("src/main/res")
        .resolve(resourceDir)
        .resolve("strings.xml")
      val names = readStringResourceNames(stringsFile)

      val missing = requiredKeys - names
      assertTrue("$resourceDir is missing notification strings: $missing", missing.isEmpty())
    }
  }

  @Test
  fun foregroundSyncServiceDoesNotHardcodeNotificationCopy() {
    val source = androidAppDir()
      .resolve("src/main/java/com/vividrop/mobile/china/sync/AndroidForegroundSyncService.kt")
      .readText()

    val blockedCopy = listOf(
      "Vivi Drop 正在背景同步",
      "Vivi Drop 正在停止同步",
      "背景同步",
      "背景上傳",
      "正在上傳佇列中的檔案",
      "正在自動上傳新的相簿檔案",
      "Vivi Drop is syncing in the background",
    )

    for (copy in blockedCopy) {
      assertFalse("Notification copy must come from Android string resources: $copy", source.contains(copy))
    }
  }

  private fun readStringResourceNames(stringsFile: File): Set<String> {
    assertTrue("Missing Android strings file: ${stringsFile.path}", stringsFile.isFile)

    val document = DocumentBuilderFactory
      .newInstance()
      .newDocumentBuilder()
      .parse(stringsFile)
    val strings = document.getElementsByTagName("string")
    return (0 until strings.length)
      .mapNotNull { index -> strings.item(index).attributes?.getNamedItem("name")?.nodeValue }
      .toSet()
  }

  private fun androidAppDir(): File {
    val start = File(requireNotNull(System.getProperty("user.dir"))).absoluteFile
    return generateSequence(start) { it.parentFile }
      .map { candidate ->
        when {
          candidate.resolve("src/main/res/values/strings.xml").isFile -> candidate
          candidate.resolve("apps/mobile/android/app/src/main/res/values/strings.xml").isFile ->
            candidate.resolve("apps/mobile/android/app")
          else -> null
        }
      }
      .firstOrNull { it != null }
      ?: error("Unable to locate apps/mobile/android/app from ${start.path}")
  }
}
