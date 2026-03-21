import Foundation

protocol UploadQueueManagerDelegate: AnyObject {
    func queueDidUpdateProgress(fileKey: String, progress: Double)
    func queueDidCompleteFile(fileKey: String)
    func queueDidFailFile(fileKey: String, error: Error)
    func queueDidComplete()
}

class UploadQueueManager {
    private var queue: [ScannedAsset] = []
    private var currentIndex = 0
    private var isRunning = false

    weak var delegate: UploadQueueManagerDelegate?
    var exportService: AssetExportService?

    var totalCount: Int { queue.count }
    var completedCount: Int { currentIndex }

    func setQueue(_ assets: [ScannedAsset]) {
        queue = assets
        currentIndex = 0
    }

    func start() {
        guard !isRunning, currentIndex < queue.count else { return }
        isRunning = true
        processNext()
    }

    func stop() {
        isRunning = false
    }

    func resume(fromIndex: Int) {
        currentIndex = fromIndex
        start()
    }

    private func processNext() {
        guard isRunning, currentIndex < queue.count else {
            isRunning = false
            delegate?.queueDidComplete()
            return
        }

        let asset = queue[currentIndex]

        Task {
            do {
                // 1. Export asset to temp file
                guard let exportService else { return }
                let exported = try await exportService.exportAsset(asset.asset)

                // 2. Send FILE_INIT_REQ via transport
                // 3. Read response (UPLOAD/RESUME/SKIP/REJECT)
                // 4. If UPLOAD/RESUME: stream FILE_DATA chunks
                // 5. Send FILE_END_REQ with SHA256
                // 6. Cleanup temp file

                // For now: stub — mark complete and move to next
                print("[UploadQueueManager] would upload: \(exported.originalFilename)")
                exportService.cleanup(tempURL: exported.tempURL)

                delegate?.queueDidCompleteFile(fileKey: asset.fileKey)
                currentIndex += 1
                processNext()
            } catch {
                delegate?.queueDidFailFile(fileKey: asset.fileKey, error: error)
                currentIndex += 1
                processNext()
            }
        }
    }
}
