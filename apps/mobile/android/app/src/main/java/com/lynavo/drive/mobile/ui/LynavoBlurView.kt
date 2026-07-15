package com.lynavo.drive.mobile.demo.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class LynavoBlurView(
  private val reactContext: ReactApplicationContext,
) : View(reactContext) {
  // Tuned for short-lived modal backdrops; avoid broad reuse on scrolling or persistent surfaces.
  private val drawPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
  private val viewLocation = IntArray(2)
  private val rootLocation = IntArray(2)
  private val refreshRunnable = Runnable { refreshBlur() }

  private var blurredBitmap: Bitmap? = null
  private var intensity: Float = DEFAULT_INTENSITY

  init {
    setWillNotDraw(false)
    isClickable = false
    isFocusable = false
  }

  fun setBlurStyle(@Suppress("UNUSED_PARAMETER") blurStyle: String?) {
    scheduleRefresh()
  }

  fun setIntensity(value: Float) {
    intensity = value.coerceIn(0f, 1f)
    scheduleRefresh()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    scheduleRefresh()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(refreshRunnable)
    blurredBitmap?.recycle()
    blurredBitmap = null
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    if (width != oldWidth || height != oldHeight) {
      scheduleRefresh()
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val bitmap = blurredBitmap ?: return
    canvas.drawBitmap(bitmap, null, Rect(0, 0, width, height), drawPaint)
  }

  private fun scheduleRefresh() {
    removeCallbacks(refreshRunnable)
    post(refreshRunnable)
    postDelayed(refreshRunnable, 80)
  }

  private fun refreshBlur() {
    val root = reactContext.currentActivity?.window?.decorView?.rootView ?: return
    if (width <= 0 || height <= 0 || root.width <= 0 || root.height <= 0) return

    try {
      getLocationOnScreen(viewLocation)
      root.getLocationOnScreen(rootLocation)

      val bitmapWidth = max(1, width / SAMPLE_FACTOR)
      val bitmapHeight = max(1, height / SAMPLE_FACTOR)
      val source = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
      val sourceCanvas = Canvas(source)
      sourceCanvas.scale(bitmapWidth / width.toFloat(), bitmapHeight / height.toFloat())
      sourceCanvas.translate(
        -(viewLocation[0] - rootLocation[0]).toFloat(),
        -(viewLocation[1] - rootLocation[1]).toFloat(),
      )
      root.draw(sourceCanvas)

      val nextBitmap = boxBlur(source, blurRadius())
      if (nextBitmap !== source) {
        source.recycle()
      }
      blurredBitmap?.recycle()
      blurredBitmap = nextBitmap
      invalidate()
    } catch (_: Throwable) {
      blurredBitmap?.recycle()
      blurredBitmap = null
      invalidate()
    }
  }

  private fun blurRadius(): Int {
    if (intensity <= 0f) return 0
    return max(1, min(MAX_BLUR_RADIUS, (intensity * 18f).roundToInt()))
  }

  private fun boxBlur(source: Bitmap, radius: Int): Bitmap {
    if (radius <= 0) return source.copy(Bitmap.Config.ARGB_8888, false)

    val width = source.width
    val height = source.height
    val src = IntArray(width * height)
    val tmp = IntArray(width * height)
    val dst = IntArray(width * height)
    source.getPixels(src, 0, width, 0, 0, width, height)

    val windowSize = radius * 2 + 1
    for (y in 0 until height) {
      val rowOffset = y * width
      for (x in 0 until width) {
        var alpha = 0
        var red = 0
        var green = 0
        var blue = 0
        for (offset in -radius..radius) {
          val clampedX = (x + offset).coerceIn(0, width - 1)
          val color = src[rowOffset + clampedX]
          alpha += color ushr 24
          red += color shr 16 and 0xff
          green += color shr 8 and 0xff
          blue += color and 0xff
        }
        tmp[rowOffset + x] =
          (alpha / windowSize shl 24) or
            (red / windowSize shl 16) or
            (green / windowSize shl 8) or
            (blue / windowSize)
      }
    }

    for (x in 0 until width) {
      for (y in 0 until height) {
        var alpha = 0
        var red = 0
        var green = 0
        var blue = 0
        for (offset in -radius..radius) {
          val clampedY = (y + offset).coerceIn(0, height - 1)
          val color = tmp[clampedY * width + x]
          alpha += color ushr 24
          red += color shr 16 and 0xff
          green += color shr 8 and 0xff
          blue += color and 0xff
        }
        dst[y * width + x] =
          (alpha / windowSize shl 24) or
            (red / windowSize shl 16) or
            (green / windowSize shl 8) or
            (blue / windowSize)
      }
    }

    return Bitmap.createBitmap(dst, width, height, Bitmap.Config.ARGB_8888)
  }

  companion object {
    private const val DEFAULT_INTENSITY = 0.08f
    private const val SAMPLE_FACTOR = 3
    private const val MAX_BLUR_RADIUS = 8
  }
}
