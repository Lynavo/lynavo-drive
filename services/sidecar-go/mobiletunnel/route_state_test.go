package mobiletunnel

import (
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func TestCurrentSelectedICERouteTracksAndResetsRoute(t *testing.T) {
	resetCurrentSelectedICERoute()
	if got := CurrentSelectedICERoute(); got != "" {
		t.Fatalf("expected empty route before selection, got %q", got)
	}

	setCurrentSelectedICERoute("turn_relay")
	if got := CurrentSelectedICERoute(); got != "turn_relay" {
		t.Fatalf("expected turn_relay route, got %q", got)
	}

	resetCurrentSelectedICERoute()
	if got := CurrentSelectedICERoute(); got != "" {
		t.Fatalf("expected empty route after reset, got %q", got)
	}
}

func TestAppendConnectionStateDiagnosticArgsIncludesSelectedPairSnapshot(t *testing.T) {
	selectedAt := time.Date(2026, 6, 5, 16, 50, 58, 0, time.UTC)
	now := selectedAt.Add(8*time.Second + 250*time.Millisecond)
	connectedAt := selectedAt.Add(-2 * time.Second)
	pair := &webrtc.ICECandidatePair{
		Local: &webrtc.ICECandidate{
			Typ:      webrtc.ICECandidateTypeHost,
			Protocol: webrtc.ICEProtocolUDP,
			Address:  "fe80::1",
			Port:     50123,
		},
		Remote: &webrtc.ICECandidate{
			Typ:      webrtc.ICECandidateTypeSrflx,
			Protocol: webrtc.ICEProtocolUDP,
			Address:  "fe80::2",
			Port:     49876,
		},
	}

	args := appendConnectionStateDiagnosticArgs(
		nil,
		"connected",
		connectedAt,
		selectedPairSnapshot(pair, selectedAt),
		now,
	)
	values := argsToMap(args)

	if values["previousState"] != "connected" {
		t.Fatalf("expected previousState connected, got %#v", values["previousState"])
	}
	if values["connectedForMs"] != int64(10250) {
		t.Fatalf("expected connectedForMs 10250, got %#v", values["connectedForMs"])
	}
	if values["lastSelectedRoute"] != "direct_reflexive" {
		t.Fatalf("expected direct_reflexive route, got %#v", values["lastSelectedRoute"])
	}
	if values["lastSelectedLocalType"] != "host" || values["lastSelectedRemoteType"] != "srflx" {
		t.Fatalf("unexpected candidate types: %#v", values)
	}
	if values["lastSelectedLocalAddress"] != "fe80::1" || values["lastSelectedRemoteAddress"] != "fe80::2" {
		t.Fatalf("unexpected candidate addresses: %#v", values)
	}
	if values["selectedPairAgeMs"] != int64(8250) {
		t.Fatalf("expected selectedPairAgeMs 8250, got %#v", values["selectedPairAgeMs"])
	}
}

func argsToMap(args []any) map[string]any {
	values := make(map[string]any, len(args)/2)
	for i := 0; i+1 < len(args); i += 2 {
		key, ok := args[i].(string)
		if !ok {
			continue
		}
		values[key] = args[i+1]
	}
	return values
}
