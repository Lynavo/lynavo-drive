import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Phase 3 — Reinstall sentinel.
    //
    // The auth Keychain item (`cn.vividrop.auth`) and the SyncEngine Keychain
    // items (`com.vividrop.mobile.china`) survive app deletion on iOS. Without
    // this, a user who deletes and reinstalls the app silently restores the
    // previous account's tokens / bindings. We drive detection off a marker
    // in UserDefaults — which IS cleared by app deletion — so `marker == nil`
    // uniquely identifies a fresh install. Runs BEFORE RCTBridge so the JS
    // hydrate path can never read residual tokens.
    //
    // Ordering: we write the marker BEFORE running the wipe, and flush it
    // synchronously via `synchronize()`. Rationale — if we wrote the marker
    // last, a crash (or OS process kill) between `wipeSyncIdentity()` and the
    // marker write would leave `marker == nil` again on next cold start and
    // the wipe would re-run forever, bootlooping the user out of React
    // Native. With the marker written first, the worst case becomes "marker
    // set, wipe not yet run or incomplete", which the existing
    // `vivi_wipe_in_progress` 2-phase self-heal below handles correctly.
    // `UserDefaults.standard.set(...)` is normally batched to disk, so we
    // call `synchronize()` here to make sure the marker is durable before
    // the wipe touches anything — `synchronize()` is formally deprecated but
    // remains safe for this one-shot fresh-install code path.
    let defaults = UserDefaults.standard
    if defaults.string(forKey: "vivi_install_marker") == nil {
      defaults.set("1", forKey: "vivi_install_marker")
      defaults.synchronize()
      SyncEngineManager.shared.wipeSyncIdentity()
      AuthKeychainCleaner.clearPersistedTokens()
      NSLog("[AppDelegate] reinstall sentinel fired: wiped residual identity + tokens")
    } else if defaults.string(forKey: "vivi_wipe_in_progress") == "1" {
      NSLog("[AppDelegate] prior wipe interrupted — re-running wipeSyncIdentity")
      SyncEngineManager.shared.wipeSyncIdentity()
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    // Register background task handlers before app finishes launching
    SyncEngineManager.shared.backgroundService.registerBackgroundTasks()

    factory.startReactNative(
      withModuleName: "SyncFlow",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
