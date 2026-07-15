package com.lynavo.drive.mobile.runtime

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.lynavo.drive.mobile.MainActivity

class NativeAppRuntimeConfigModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = MODULE_NAME

  override fun getConstants(): Map<String, Any> = MainActivity.getVisualQaLaunchExtras()

  companion object {
    const val MODULE_NAME = "NativeAppRuntimeConfig"
  }
}
