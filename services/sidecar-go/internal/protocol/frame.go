package protocol

import (
	"encoding/binary"
	"fmt"
	"io"
	"sync"
)

const (
	MagicBytes = "LMUP"
	Version    = 2
	HeaderSize = 12
	MaxBodyLen = 64 * 1024 * 1024 // 64 MiB max frame body (supports 32 MiB chunks + metadata)
	// Reuse one large buffer size that matches high-throughput FILE_DATA chunking.
	pooledBodyCap = 32*1024*1024 + 4*1024
)

var bodyPool = sync.Pool{
	New: func() any {
		return make([]byte, pooledBodyCap)
	},
}

// Message type constants matching @syncflow/contracts
const (
	TypeHelloReq           uint16 = 0x0001
	TypeHelloRes           uint16 = 0x0002
	TypePairReq            uint16 = 0x0003
	TypePairRes            uint16 = 0x0004
	TypeSyncBeginReq       uint16 = 0x0005
	TypeSyncBeginRes       uint16 = 0x0006
	TypeFileInitReq        uint16 = 0x0007
	TypeFileInitRes        uint16 = 0x0008
	TypeFileData           uint16 = 0x0009
	TypeFileAck            uint16 = 0x000A
	TypeFileEndReq         uint16 = 0x000B
	TypeFileEndRes         uint16 = 0x000C
	TypeSyncEndReq         uint16 = 0x000D
	TypeSyncEndRes         uint16 = 0x000E
	TypePing               uint16 = 0x000F
	TypePong               uint16 = 0x0010
	TypeError              uint16 = 0x0011
	TypeAuthReq            uint16 = 0x0012 // nonce-HMAC auth request from client
	TypeAuthRes            uint16 = 0x0013 // auth result from server
	TypePairingInvalidated uint16 = 0x0014 // explicit pairing invalidation from server
)

// FrameHeader represents the parsed header of an LMUP/2 frame.
type FrameHeader struct {
	Type   uint16
	Length uint32
}

// ReadFrame reads a complete LMUP/2 frame from r. It validates the magic bytes,
// protocol version, and ensures the body does not exceed MaxBodyLen.
func ReadFrame(r io.Reader) (*FrameHeader, []byte, error) {
	var hdr [HeaderSize]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, nil, err
	}
	if string(hdr[0:4]) != MagicBytes {
		return nil, nil, fmt.Errorf("invalid magic: %q", hdr[0:4])
	}
	ver := binary.BigEndian.Uint16(hdr[4:6])
	if ver != Version {
		return nil, nil, fmt.Errorf("unsupported version: %d", ver)
	}
	typ := binary.BigEndian.Uint16(hdr[6:8])
	length := binary.BigEndian.Uint32(hdr[8:12])
	if length > MaxBodyLen {
		return nil, nil, fmt.Errorf("frame too large: %d bytes", length)
	}
	body := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, body); err != nil {
			return nil, nil, err
		}
	}
	return &FrameHeader{Type: typ, Length: length}, body, nil
}

// ReadFrameBorrowed reads a frame and may return a pooled body buffer.
// If release is non-nil, caller must invoke it once body is no longer used.
func ReadFrameBorrowed(r io.Reader) (*FrameHeader, []byte, func(), error) {
	var hdr [HeaderSize]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, nil, nil, err
	}
	if string(hdr[0:4]) != MagicBytes {
		return nil, nil, nil, fmt.Errorf("invalid magic: %q", hdr[0:4])
	}
	ver := binary.BigEndian.Uint16(hdr[4:6])
	if ver != Version {
		return nil, nil, nil, fmt.Errorf("unsupported version: %d", ver)
	}
	typ := binary.BigEndian.Uint16(hdr[6:8])
	length := binary.BigEndian.Uint32(hdr[8:12])
	if length > MaxBodyLen {
		return nil, nil, nil, fmt.Errorf("frame too large: %d bytes", length)
	}

	h := &FrameHeader{Type: typ, Length: length}
	if length == 0 {
		return h, nil, nil, nil
	}

	if int(length) <= pooledBodyCap {
		pooled := bodyPool.Get().([]byte)
		body := pooled[:int(length)]
		if _, err := io.ReadFull(r, body); err != nil {
			bodyPool.Put(pooled)
			return nil, nil, nil, err
		}
		release := func() {
			bodyPool.Put(pooled)
		}
		return h, body, release, nil
	}

	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, nil, nil, err
	}
	return h, body, nil, nil
}

// WriteFrame writes a complete LMUP/2 frame to w with the given message type
// and body payload.
func WriteFrame(w io.Writer, typ uint16, body []byte) error {
	var hdr [HeaderSize]byte
	copy(hdr[0:4], MagicBytes)
	binary.BigEndian.PutUint16(hdr[4:6], Version)
	binary.BigEndian.PutUint16(hdr[6:8], typ)
	binary.BigEndian.PutUint32(hdr[8:12], uint32(len(body)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	if len(body) > 0 {
		if _, err := w.Write(body); err != nil {
			return err
		}
	}
	return nil
}
