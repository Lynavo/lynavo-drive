// BackgroundTransitionRefCount.swift
//
// M8 (FU5) — pure ref-count helper for the UIApplication background-task
// assertion used during sync-engine background transitions.
//
// Extracted out of SyncEngineManager so the ref-count state machine can be
// exercised without pulling in UIKit / Photos / UploadStore. The helper is
// generic over the token type so tests can drive it with a plain `Int` while
// production code binds it to `UIBackgroundTaskIdentifier`. The caller
// injects the real "acquire" / "release" via closures; this class only owns
// the counter, the currently-held token (if any), and the diagnostic log
// sink.
//
// Semantics mirror the original SyncEngineManager methods verbatim:
//
//   begin():
//     refCount += 1
//     if refCount == 1 && !holdingToken -> acquire(), remember token
//     else -> pure increment
//
//   end():
//     if refCount <= 0 -> ignore (over-release guard)
//     refCount -= 1
//     if refCount == 0 && holdingToken -> release(token), forget token
//     else -> pure decrement
//
//   forceEnd():
//     refCount = 0
//     if holdingToken -> release(token), forget token
//
// All mutations are guarded by an internal NSLock so nested callers from
// different queues (e.g. appDidEnterBackground on main + async upload
// pipeline on a worker queue) cannot race the counter.

import Foundation

final class BackgroundTransitionRefCount<Token: Equatable> {
    private let lock = NSLock()
    private var refCount: Int = 0
    private var heldToken: Token
    private let invalidToken: Token
    private let acquire: () -> Token
    private let release: (Token) -> Void
    private let log: (String, String, Int) -> Void

    /// - Parameters:
    ///   - invalidToken: sentinel value that represents "no token"; equality
    ///     against this value determines whether we hold a real assertion.
    ///   - acquire: called when the refCount transitions 0 -> 1; the returned
    ///     token is retained until the matching release.
    ///   - release: called when the refCount transitions back to 0 (via end)
    ///     or is clamped to 0 (via forceEnd), with the previously-acquired
    ///     token.
    ///   - log: called with (`event`, `reason`, `newRefCount`) for every
    ///     transition so the caller can forward to its own diagnostic log
    ///     sinks (NSLog + syncDiagnosticsLog in production).
    init(
        invalidToken: Token,
        acquire: @escaping () -> Token,
        release: @escaping (Token) -> Void,
        log: @escaping (String, String, Int) -> Void
    ) {
        self.invalidToken = invalidToken
        self.heldToken = invalidToken
        self.acquire = acquire
        self.release = release
        self.log = log
    }

    /// Ref-counted begin. Increments; acquires the assertion on the 0 -> 1
    /// transition only.
    func begin(reason: String) {
        lock.lock()
        refCount += 1
        let shouldAcquire = refCount == 1 && heldToken == invalidToken
        let newRefCount = refCount
        lock.unlock()

        if shouldAcquire {
            let token = acquire()
            lock.lock()
            heldToken = token
            lock.unlock()
            log("began", reason, newRefCount)
        } else {
            log("nestedBegin", reason, newRefCount)
        }
    }

    /// Ref-counted end. Decrements; releases the assertion only when the
    /// count hits zero. Extra `end` calls past zero are ignored — a stray
    /// double-end can never release a live assertion the outer caller still
    /// needs.
    func end(reason: String) {
        lock.lock()
        if refCount <= 0 {
            lock.unlock()
            return
        }
        refCount -= 1
        let shouldRelease = refCount == 0 && heldToken != invalidToken
        let tokenToRelease = heldToken
        if shouldRelease {
            heldToken = invalidToken
        }
        let newRefCount = refCount
        lock.unlock()

        if shouldRelease {
            release(tokenToRelease)
            log("ended", reason, newRefCount)
        } else {
            log("nestedEnd", reason, newRefCount)
        }
    }

    /// Force-release used by terminal cleanup paths that must guarantee the
    /// assertion is gone no matter what. Clamps the refCount to 0 and
    /// releases the physical assertion if any was held.
    func forceEnd(reason: String) {
        lock.lock()
        let tokenToRelease = heldToken
        heldToken = invalidToken
        refCount = 0
        lock.unlock()

        if tokenToRelease != invalidToken {
            release(tokenToRelease)
            log("forceEnded", reason, 0)
        }
    }

    /// Test / diagnostic accessor.
    func snapshot() -> (refCount: Int, hasToken: Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (refCount, heldToken != invalidToken)
    }
}
