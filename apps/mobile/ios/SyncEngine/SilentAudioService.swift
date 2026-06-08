import Foundation
import AVFoundation

/// Plays inaudible audio so we can test whether the audio background mode
/// keeps the app process alive after the app moves to the background.
class SilentAudioService {
    static let shared = SilentAudioService()

    private var audioPlayer: AVAudioPlayer?
    private var _isPlaying = false
    private let stateLock = NSLock()

    var isPlaying: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _isPlaying
    }

    private init() {}

    @discardableResult
    func start() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }

        guard !_isPlaying else { return true }

        do {
            // Configure audio session for background playback
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)

            // Generate a tiny silent WAV in memory (1 second, mono, 8kHz, 16-bit signed PCM).
            let sampleRate: Int = 8000
            let duration: Int = 1
            let bytesPerSample: Int = 2
            let channelCount: Int = 1
            let numSamples = sampleRate * duration
            let silence = Data(count: numSamples * bytesPerSample)

            var wavData = Data()
            // WAV header
            wavData.append(contentsOf: "RIFF".utf8)
            wavData.append(uint32LE: UInt32(36 + silence.count))
            wavData.append(contentsOf: "WAVE".utf8)
            wavData.append(contentsOf: "fmt ".utf8)
            wavData.append(uint32LE: 16)              // chunk size
            wavData.append(uint16LE: 1)               // PCM
            wavData.append(uint16LE: 1)               // mono
            wavData.append(uint32LE: UInt32(sampleRate))
            wavData.append(uint32LE: UInt32(sampleRate * channelCount * bytesPerSample)) // byte rate
            wavData.append(uint16LE: UInt16(channelCount * bytesPerSample)) // block align
            wavData.append(uint16LE: UInt16(bytesPerSample * 8)) // bits per sample
            wavData.append(contentsOf: "data".utf8)
            wavData.append(uint32LE: UInt32(silence.count))
            wavData.append(silence)

            audioPlayer = try AVAudioPlayer(data: wavData)
            audioPlayer?.numberOfLoops = -1 // loop forever
            audioPlayer?.volume = 1.0
            guard audioPlayer?.play() == true else {
                audioPlayer = nil
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
                slog("[SilentAudio] failed to start: AVAudioPlayer refused playback")
                return false
            }
            _isPlaying = true
            slog("[SilentAudio] started background audio")
            return true
        } catch {
            audioPlayer = nil
            _isPlaying = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            slog("[SilentAudio] failed to start: %@", "\(error)")
            return false
        }
    }

    func stop() {
        stateLock.lock()
        defer { stateLock.unlock() }

        guard _isPlaying else { return }
        audioPlayer?.stop()
        audioPlayer = nil
        _isPlaying = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        slog("[SilentAudio] stopped")
    }
}

// MARK: - Data helpers for WAV encoding

private extension Data {
    mutating func append(uint32LE value: UInt32) {
        var v = value.littleEndian
        append(Data(bytes: &v, count: 4))
    }
    mutating func append(uint16LE value: UInt16) {
        var v = value.littleEndian
        append(Data(bytes: &v, count: 2))
    }
}
