package com.lynavo.drive.mobile

import android.app.Application
import android.content.Context
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.mrousavy.camera.react.CameraPackage
import com.lynavo.drive.mobile.runtime.NativeAppRuntimeConfigPackage
import com.lynavo.drive.mobile.sync.NativeSyncEngineModule
import com.lynavo.drive.mobile.sync.NativeSyncEnginePackage
import com.lynavo.drive.mobile.ui.LynavoUiPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(CameraPackage())
          add(NativeAppRuntimeConfigPackage())
          add(NativeSyncEnginePackage())
          add(LynavoUiPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Phase 3 — Reinstall sentinel.
    //
    // EncryptedSharedPreferences (used by react-native-keychain for auth
    // tokens) and our own sync-identity SharedPreferences both survive app
    // deletion on some launcher implementations / backup restore flows. The
    // install marker lives in the same prefs file and is deleted with it —
    // so "marker absent" uniquely identifies a fresh / reinstalled app and
    // lets us clear any surviving identity before React starts.
    //
    // Also handles the 2-phase self-heal: if a prior wipe was killed after
    // setting `lynavo_wipe_in_progress` but before clearing it, retry now.
    runInstallSentinel(this)

    loadReactNative(this)
  }

  private fun runInstallSentinel(context: Context) {
    val prefs = context.getSharedPreferences(
      NativeSyncEngineModule.PREFS_NAME,
      Context.MODE_PRIVATE,
    )
    val markerPresent = prefs.contains(NativeSyncEngineModule.PREF_INSTALL_MARKER)

    if (!markerPresent) {
      // Ordering: write the marker BEFORE running the wipe, and use
      // `commit()` (blocking) rather than `apply()` (async). Rationale — if
      // the marker were written last with `apply()`, a process kill between
      // `performWipeSyncIdentity` completing and the marker reaching disk
      // would leave `markerPresent == false` on next launch, re-running the
      // wipe AND `clearAuthKeychainStorage` on top of tokens the user may
      // have just re-acquired. Writing the marker first (and synchronously)
      // collapses the worst case down to "marker set, wipe incomplete",
      // which the `PREF_WIPE_IN_PROGRESS` branch below already heals.
      prefs.edit()
        .putString(NativeSyncEngineModule.PREF_INSTALL_MARKER, "1")
        .commit()
      NativeSyncEngineModule.performWipeSyncIdentity(prefs)
      NativeSyncEngineModule.clearAuthKeychainStorage(context)
      Log.i(
        "MainApplication",
        "reinstall sentinel fired: wiped residual identity + auth keychain prefs",
      )
    } else if (prefs.contains(NativeSyncEngineModule.PREF_WIPE_IN_PROGRESS)) {
      Log.i("MainApplication", "prior wipe interrupted — re-running wipeSyncIdentity")
      NativeSyncEngineModule.performWipeSyncIdentity(prefs)
    }
  }
}
