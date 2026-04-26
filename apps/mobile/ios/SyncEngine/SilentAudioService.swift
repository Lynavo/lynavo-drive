import Foundation
import AVFoundation

/// Plays inaudible audio to keep the app alive in the background.
/// Start when sync pipeline begins, stop only when app is terminated.
class SilentAudioService {
    static let shared = SilentAudioService()

    private var audioPlayer: AVAudioPlayer?
    private var isPlaying = false

    private init() {}

    func start() {
        guard !isPlaying else { return }

        do {
            // Configure audio session for background playback
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)

            // Generate a tiny silent WAV in memory (1 second, mono, 8kHz, 8-bit)
            let sampleRate: Int = 8000
            let duration: Int = 1
            let numSamples = sampleRate * duration
            let silence = Data(count: numSamples) // all zeros = silence

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
            wavData.append(uint32LE: UInt32(sampleRate)) // byte rate
            wavData.append(uint16LE: 1)               // block align
            wavData.append(uint16LE: 8)               // bits per sample
            wavData.append(contentsOf: "data".utf8)
            wavData.append(uint32LE: UInt32(silence.count))
            wavData.append(silence)

            audioPlayer = try AVAudioPlayer(data: wavData)
            audioPlayer?.numberOfLoops = -1 // loop forever
            audioPlayer?.volume = 0.0
            audioPlayer?.play()
            isPlaying = true
            slog("[SilentAudio] started background audio")
        } catch {
            slog("[SilentAudio] failed to start: %@", "\(error)")
        }
    }

    func stop() {
        guard isPlaying else { return }
        audioPlayer?.stop()
        audioPlayer = nil
        isPlaying = false
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
