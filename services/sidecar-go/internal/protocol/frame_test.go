package protocol

import (
	"bytes"
	"encoding/binary"
	"io"
	"strings"
	"testing"
)

func TestWriteReadRoundtrip(t *testing.T) {
	body := []byte(`{"hello":"world"}`)

	var buf bytes.Buffer
	if err := WriteFrame(&buf, TypeHelloReq, body); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	hdr, got, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if hdr.Type != TypeHelloReq {
		t.Errorf("type = 0x%04x, want 0x%04x", hdr.Type, TypeHelloReq)
	}
	if hdr.Length != uint32(len(body)) {
		t.Errorf("length = %d, want %d", hdr.Length, len(body))
	}
	if !bytes.Equal(got, body) {
		t.Errorf("body = %q, want %q", got, body)
	}
}

func TestWriteReadEmptyBody(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteFrame(&buf, TypePing, nil); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	hdr, body, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if hdr.Type != TypePing {
		t.Errorf("type = 0x%04x, want 0x%04x", hdr.Type, TypePing)
	}
	if hdr.Length != 0 {
		t.Errorf("length = %d, want 0", hdr.Length)
	}
	if len(body) != 0 {
		t.Errorf("body length = %d, want 0", len(body))
	}
}

func TestReadFrameInvalidMagic(t *testing.T) {
	var hdr [HeaderSize]byte
	copy(hdr[0:4], "BAAD")
	binary.BigEndian.PutUint16(hdr[4:6], Version)
	binary.BigEndian.PutUint16(hdr[6:8], TypeHelloReq)
	binary.BigEndian.PutUint32(hdr[8:12], 0)

	_, _, err := ReadFrame(bytes.NewReader(hdr[:]))
	if err == nil {
		t.Fatal("expected error for invalid magic")
	}
	if !strings.Contains(err.Error(), "invalid magic") {
		t.Errorf("error = %q, want 'invalid magic'", err)
	}
}

func TestReadFrameVersionMismatch(t *testing.T) {
	var hdr [HeaderSize]byte
	copy(hdr[0:4], MagicBytes)
	binary.BigEndian.PutUint16(hdr[4:6], 99) // wrong version
	binary.BigEndian.PutUint16(hdr[6:8], TypeHelloReq)
	binary.BigEndian.PutUint32(hdr[8:12], 0)

	_, _, err := ReadFrame(bytes.NewReader(hdr[:]))
	if err == nil {
		t.Fatal("expected error for version mismatch")
	}
	if !strings.Contains(err.Error(), "unsupported version") {
		t.Errorf("error = %q, want 'unsupported version'", err)
	}
}

func TestReadFrameOversized(t *testing.T) {
	var hdr [HeaderSize]byte
	copy(hdr[0:4], MagicBytes)
	binary.BigEndian.PutUint16(hdr[4:6], Version)
	binary.BigEndian.PutUint16(hdr[6:8], TypeFileData)
	binary.BigEndian.PutUint32(hdr[8:12], MaxBodyLen+1) // exceeds limit

	_, _, err := ReadFrame(bytes.NewReader(hdr[:]))
	if err == nil {
		t.Fatal("expected error for oversized frame")
	}
	if !strings.Contains(err.Error(), "frame too large") {
		t.Errorf("error = %q, want 'frame too large'", err)
	}
}

func TestReadFrameTruncatedHeader(t *testing.T) {
	// Only 6 bytes — not enough for a full 12-byte header
	partial := make([]byte, 6)
	copy(partial[0:4], MagicBytes)

	_, _, err := ReadFrame(bytes.NewReader(partial))
	if err == nil {
		t.Fatal("expected error for truncated header")
	}
	if err != io.ErrUnexpectedEOF {
		t.Errorf("error = %v, want io.ErrUnexpectedEOF", err)
	}
}

func TestReadFrameTruncatedBody(t *testing.T) {
	var hdr [HeaderSize]byte
	copy(hdr[0:4], MagicBytes)
	binary.BigEndian.PutUint16(hdr[4:6], Version)
	binary.BigEndian.PutUint16(hdr[6:8], TypeHelloReq)
	binary.BigEndian.PutUint32(hdr[8:12], 100) // claims 100 bytes body

	// Provide header but only 5 bytes of body
	data := append(hdr[:], []byte("short")...)
	_, _, err := ReadFrame(bytes.NewReader(data))
	if err == nil {
		t.Fatal("expected error for truncated body")
	}
}

func TestWriteReadAllMessageTypes(t *testing.T) {
	types := []uint16{
		TypeHelloReq, TypeHelloRes, TypePairReq, TypePairRes,
		TypeSyncBeginReq, TypeSyncBeginRes, TypeFileInitReq, TypeFileInitRes,
		TypeFileData, TypeFileAck, TypeFileEndReq, TypeFileEndRes,
		TypeSyncEndReq, TypeSyncEndRes, TypePing, TypePong,
		TypeError, TypeAuthReq,
	}

	for _, typ := range types {
		var buf bytes.Buffer
		body := []byte("test")
		if err := WriteFrame(&buf, typ, body); err != nil {
			t.Fatalf("WriteFrame(0x%04x): %v", typ, err)
		}
		hdr, got, err := ReadFrame(&buf)
		if err != nil {
			t.Fatalf("ReadFrame(0x%04x): %v", typ, err)
		}
		if hdr.Type != typ {
			t.Errorf("type = 0x%04x, want 0x%04x", hdr.Type, typ)
		}
		if !bytes.Equal(got, body) {
			t.Errorf("body mismatch for type 0x%04x", typ)
		}
	}
}

func TestHeaderLayout(t *testing.T) {
	body := []byte("hello")
	var buf bytes.Buffer
	if err := WriteFrame(&buf, TypePairReq, body); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	raw := buf.Bytes()
	if len(raw) != HeaderSize+len(body) {
		t.Fatalf("total length = %d, want %d", len(raw), HeaderSize+len(body))
	}
	// Verify raw header bytes
	if string(raw[0:4]) != MagicBytes {
		t.Errorf("magic = %q", raw[0:4])
	}
	if binary.BigEndian.Uint16(raw[4:6]) != Version {
		t.Error("version mismatch in raw bytes")
	}
	if binary.BigEndian.Uint16(raw[6:8]) != TypePairReq {
		t.Error("type mismatch in raw bytes")
	}
	if binary.BigEndian.Uint32(raw[8:12]) != uint32(len(body)) {
		t.Error("length mismatch in raw bytes")
	}
	if string(raw[12:]) != "hello" {
		t.Errorf("body in raw bytes = %q", raw[12:])
	}
}
