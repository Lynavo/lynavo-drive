package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// Rotation thresholds for the sidecar log file. Rotation is performed
// in-process (stdlib only) to avoid adding an external dependency.
const (
	logFileName    = "sidecar.log"
	rotateMaxBytes = 10 * 1024 * 1024 // 10 MiB per file
	rotateMaxKeep  = 5                // keep sidecar.log + sidecar.log.1..5
)

var (
	fileMu       sync.Mutex
	currentFile  *os.File
	currentPath  string
	currentBytes int64
)

// Setup configures slog with a JSON handler that writes to stdout and,
// when logDir is non-empty, to a size-rotated file at logDir/sidecar.log.
//
// Writing to a file is critical for remote diagnostics: the desktop app
// only captures sidecar stdout when it spawns the process itself.  Any
// standalone run (dev harness, launchd, post-crash forensics) would
// otherwise leave no log trail at all.
func Setup(level string, logDir string) {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	var writer io.Writer = os.Stdout
	if logDir != "" {
		if fw, err := openLogFile(logDir); err == nil {
			writer = io.MultiWriter(os.Stdout, fw)
		} else {
			// Fall back to stdout-only; surface the failure but do not exit.
			slog.Warn("failed to open sidecar log file; stdout only", "dir", logDir, "err", err)
		}
	}

	handler := slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: lvl})
	slog.SetDefault(slog.New(handler))
}

// LogFilePath returns the absolute path of the active sidecar log file,
// or an empty string when file logging has not been enabled.
func LogFilePath() string {
	fileMu.Lock()
	defer fileMu.Unlock()
	return currentPath
}

func openLogFile(logDir string) (io.Writer, error) {
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, err
	}

	path := filepath.Join(logDir, logFileName)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}

	fileMu.Lock()
	currentFile = f
	currentPath = path
	if info, statErr := f.Stat(); statErr == nil {
		currentBytes = info.Size()
	}
	fileMu.Unlock()

	return rotatingWriter{}, nil
}

// rotatingWriter is a thin wrapper that delegates to the current sidecar
// log file and rotates it before each write when the size threshold is
// crossed.  slog calls Write once per record so the rotation check is
// cheap and bounded.
type rotatingWriter struct{}

func (rotatingWriter) Write(p []byte) (int, error) {
	fileMu.Lock()
	defer fileMu.Unlock()

	if currentFile == nil {
		return len(p), nil
	}

	if currentBytes+int64(len(p)) > rotateMaxBytes {
		if err := rotateLocked(); err != nil {
			// Rotation failure must not drop the record — keep writing to
			// the existing file and retry on the next call.
			n, werr := currentFile.Write(p)
			currentBytes += int64(n)
			if werr != nil {
				return n, werr
			}
			return n, nil
		}
	}

	n, err := currentFile.Write(p)
	currentBytes += int64(n)
	return n, err
}

func rotateLocked() error {
	if currentFile == nil {
		return nil
	}

	if err := currentFile.Close(); err != nil {
		return err
	}
	currentFile = nil

	// Shift sidecar.log.N → sidecar.log.N+1 (oldest first).
	for i := rotateMaxKeep; i >= 1; i-- {
		older := rotatedPath(currentPath, i+1)
		newer := rotatedPath(currentPath, i)
		if i == rotateMaxKeep {
			_ = os.Remove(older)
			continue
		}
		if _, err := os.Stat(newer); err == nil {
			_ = os.Rename(newer, older)
		}
	}
	_ = os.Rename(currentPath, rotatedPath(currentPath, 1))

	f, err := os.OpenFile(currentPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	currentFile = f
	currentBytes = 0
	return nil
}

func rotatedPath(base string, index int) string {
	return base + "." + itoa(index)
}

// Tiny helper to avoid importing strconv (keeps the init-path surface small).
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [8]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
