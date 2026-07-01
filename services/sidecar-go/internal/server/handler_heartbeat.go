package server

import "github.com/lynavo/lynavo-drive/services/sidecar-go/internal/protocol"

// handlePing responds to a PING frame with a PONG frame.
func (c *connection) handlePing() error {
	return c.sendFrame(protocol.TypePong, nil)
}
