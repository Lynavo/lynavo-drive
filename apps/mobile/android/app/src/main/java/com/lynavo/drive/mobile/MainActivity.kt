package com.lynavo.drive.mobile.demo

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    captureVisualQaIntentExtras(intent)
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    captureVisualQaIntentExtras(intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "LynavoDriveDemo"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  private fun captureVisualQaIntentExtras(intent: Intent?) {
    visualQaLaunchExtras = VISUAL_QA_KEYS.mapNotNull { key ->
      intent?.getStringExtra(key)?.let { value -> key to value }
    }.toMap()
  }

  companion object {
    private val VISUAL_QA_KEYS =
        listOf(
            "LYNAVO_VISUAL_QA",
            "LYNAVO_VISUAL_QA_HOME_EMPTY",
            "LYNAVO_VISUAL_QA_ROUTE",
            "LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW",
        )

    @Volatile private var visualQaLaunchExtras: Map<String, String> = emptyMap()

    fun getVisualQaLaunchExtras(): Map<String, String> = visualQaLaunchExtras
  }
}
