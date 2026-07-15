package protocol

import (
	"encoding/json"
	"testing"
)

func TestHelloReqMarshalRoundtrip(t *testing.T) {
	orig := HelloReq{
		ClientID:          "device-abc-123",
		ClientName:        "iPhone 16 Pro",
		ClientIP:          "192.168.1.88",
		ClientPlatform:    "ios",
		AppVersion:        "1.0.0",
		PairingToken:      "tok_abc",
		PreviousSessionID: "sess-old",
		AppState:          "foreground",
		DeviceAlias:       "My Phone",
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got HelloReq
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}

func TestHelloReqOmitsEmptyOptionals(t *testing.T) {
	msg := HelloReq{
		ClientID:       "dev-1",
		ClientName:     "iPhone",
		ClientPlatform: "ios",
		AppVersion:     "1.0.0",
		AppState:       "foreground",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("Unmarshal to map: %v", err)
	}

	for _, key := range []string{"pairingToken", "previousSessionId", "deviceAlias", "clientIp"} {
		if _, ok := m[key]; ok {
			t.Errorf("expected %q to be omitted when empty", key)
		}
	}
}

func TestHelloResWithResume(t *testing.T) {
	msg := HelloRes{
		ServerID:     "server-1",
		ServerName:   "My Mac",
		ServerType:   "mac",
		ProtoVersion: 2,
		AuthRequired: false,
		Bound:        true,
		Resume: &ResumeInfo{
			Accepted:      true,
			SessionID:     "sess-123",
			ActiveFileKey: "file-abc",
			ResumeOffset:  4096,
		},
		ServerCapabilities: ServerCapabilities{
			ShareEnabled:        true,
			ShareName:           "LynavoDrive",
			LowDiskPauseEnabled: true,
		},
		Nonce: "deadbeef",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got HelloRes
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got.Resume == nil {
		t.Fatal("Resume should not be nil")
	}
	if got.Resume.ResumeOffset != 4096 {
		t.Errorf("ResumeOffset = %d, want 4096", got.Resume.ResumeOffset)
	}
	if !got.ServerCapabilities.ShareEnabled {
		t.Error("ShareEnabled should be true")
	}
}

func TestHelloResWithWakeCapability(t *testing.T) {
	msg := HelloRes{
		ServerID:     "server-1",
		ServerName:   "My Mac",
		ServerType:   "mac",
		ProtoVersion: 2,
		ServerCapabilities: ServerCapabilities{
			ShareEnabled:        true,
			ShareName:           "My Computer",
			LowDiskPauseEnabled: true,
			Wake: &WakeCapability{
				Supported: true,
				UpdatedAt: "2026-06-09T03:00:00Z",
				Targets: []WakeTarget{
					{
						InterfaceName:    "en0",
						MACAddress:       "aa:bb:cc:dd:ee:ff",
						IPv4Address:      "192.168.1.20",
						BroadcastAddress: "192.168.1.255",
						Ports:            []int{9, 7},
					},
				},
			},
		},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("Unmarshal map: %v", err)
	}
	caps := body["serverCapabilities"].(map[string]any)
	wake := caps["wake"].(map[string]any)
	if wake["supported"] != true {
		t.Fatalf("wake.supported = %v, want true", wake["supported"])
	}
	targets := wake["targets"].([]any)
	target := targets[0].(map[string]any)
	if target["broadcastAddress"] != "192.168.1.255" {
		t.Fatalf("broadcastAddress = %v, want 192.168.1.255", target["broadcastAddress"])
	}

	var got HelloRes
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.ServerCapabilities.Wake == nil || !got.ServerCapabilities.Wake.Supported {
		t.Fatal("expected wake capability to roundtrip")
	}
}

func TestHelloResNilResume(t *testing.T) {
	msg := HelloRes{
		ServerID:     "server-1",
		ServerName:   "My Mac",
		ServerType:   "mac",
		ProtoVersion: 2,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got HelloRes
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got.Resume != nil {
		t.Error("Resume should be nil when not set")
	}
}

func TestFileInitReqMarshalRoundtrip(t *testing.T) {
	orig := FileInitReq{
		SessionID:        "sess-1",
		FileKey:          "photo-2026-03-21-001",
		OriginalFilename: "IMG_0001.HEIC",
		MediaType:        "photo",
		MimeType:         "image/heic",
		FileSize:         5242880,
		CreatedAt:        "2026-03-21T10:00:00Z",
		ModifiedAt:       "2026-03-21T10:00:00Z",
		QueueIndex:       0,
		QueueTotalCount:  42,
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got FileInitReq
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}

func TestFileAckMarshalRoundtrip(t *testing.T) {
	orig := FileAck{
		FileKey:         "file-xyz",
		CommittedOffset: 8388608,
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got FileAck
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}

func TestAuthReqMarshalRoundtrip(t *testing.T) {
	orig := AuthReq{
		ClientID: "device-abc",
		Auth:     "hmac-sha256-hex-string",
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got AuthReq
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}

func TestErrorMsgMarshalRoundtrip(t *testing.T) {
	orig := ErrorMsg{
		Code:    "PAIR_TOKEN_INVALID",
		Message: "pairing token HMAC verification failed",
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got ErrorMsg
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}

func TestPairResWithServerInfo(t *testing.T) {
	orig := PairRes{
		OK:           true,
		PairingID:    "pair-uuid-1",
		PairingToken: "random-token-hex",
		ServerInfo: ServerInfo{
			ServerID:   "server-1",
			ServerName: "My MacBook",
			ShareName:  "LynavoDrive",
		},
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got PairRes
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got.ServerInfo.ServerName != "My MacBook" {
		t.Errorf("ServerInfo.ServerName = %q, want 'My MacBook'", got.ServerInfo.ServerName)
	}
}

func TestFileEndReqRoundtrip(t *testing.T) {
	orig := FileEndReq{
		FileKey:  "file-123",
		FileSize: 10485760,
		SHA256:   "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got FileEndReq
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}

func TestFileEndResRoundtrip(t *testing.T) {
	orig := FileEndRes{
		OK:                   true,
		FileKey:              "file-123",
		RelativePath:         "My Phone/2026-03-21/IMG_0001.HEIC",
		LedgerDate:           "2026-03-21",
		StoredBytes:          10485760,
		ActiveTransmissionMs: 2500,
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got FileEndRes
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got != orig {
		t.Errorf("roundtrip mismatch:\n  got  = %+v\n  want = %+v", got, orig)
	}
}
