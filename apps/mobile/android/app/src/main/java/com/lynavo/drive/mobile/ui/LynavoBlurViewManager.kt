package com.lynavo.drive.mobile.demo.ui

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class LynavoBlurViewManager(
  private val reactContext: ReactApplicationContext,
) : SimpleViewManager<LynavoBlurView>() {
  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): LynavoBlurView =
    LynavoBlurView(reactContext)

  @ReactProp(name = "blurStyle")
  fun setBlurStyle(view: LynavoBlurView, blurStyle: String?) {
    view.setBlurStyle(blurStyle)
  }

  @ReactProp(name = "intensity", defaultFloat = 0.08f)
  fun setIntensity(view: LynavoBlurView, intensity: Float) {
    view.setIntensity(intensity)
  }

  companion object {
    const val REACT_CLASS = "LynavoBlurView"
  }
}
