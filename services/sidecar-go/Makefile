.PHONY: build run test clean dev

BINARY := lynavo-drive-sidecar
CMD := ./cmd/syncflow-sidecar/

# Build the sidecar binary
build:
	go build -o $(BINARY) $(CMD)

# Run in development mode (build + run)
dev: build
	./$(BINARY)

# Run without building (uses go run)
run:
	go run $(CMD)

# Run all tests
test:
	go test ./...

# Run tests with verbose output
test-v:
	go test -v ./...

# Clean build artifacts and database
clean:
	rm -f $(BINARY)
	rm -f syncflow.db syncflow.db-wal syncflow.db-shm

# Format code
fmt:
	go fmt ./...

# Vet code
vet:
	go vet ./...

# All checks
check: fmt vet test
