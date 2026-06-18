package mobiletunnel

import (
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

func TestParseICEServersJSONUsesProvidedTurnServers(t *testing.T) {
	servers := parseICEServersJSON(`[{"urls":["turn:review-api.vividrop.cn:3478?transport=udp"],"username":"u","credential":"p"}]`)

	if len(servers) != 2 {
		t.Fatalf("expected STUN plus TURN ICE servers, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != defaultSTUNServer {
		t.Fatalf("expected default STUN first, got %s", got)
	}
	if got := servers[1].URLs[0]; got != "turn:review-api.vividrop.cn:3478?transport=udp" {
		t.Fatalf("unexpected ICE URL: %s", got)
	}
	if servers[1].Username != "u" || servers[1].Credential != "p" {
		t.Fatalf("unexpected TURN credentials: %#v", servers[1])
	}
}

func TestParseICEServersJSONFallsBackToDefaultStun(t *testing.T) {
	servers := parseICEServersJSON("")

	if len(servers) != 1 {
		t.Fatalf("expected default ICE server, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != defaultSTUNServer {
		t.Fatalf("unexpected default ICE URL: %s", got)
	}
}

func TestParseICEServersJSONDoesNotDuplicateDefaultStun(t *testing.T) {
	servers := parseICEServersJSON(`[{"urls":["stun:stun.cloudflare.com:3478"]},{"urls":["turn:review-api.vividrop.cn:3478?transport=udp"],"username":"u","credential":"p"}]`)

	if len(servers) != 2 {
		t.Fatalf("expected existing STUN plus TURN ICE servers, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != defaultSTUNServer {
		t.Fatalf("expected existing default STUN first, got %s", got)
	}
	if got := servers[1].URLs[0]; got != "turn:review-api.vividrop.cn:3478?transport=udp" {
		t.Fatalf("unexpected ICE URL: %s", got)
	}
}

func TestParseTunnelOptionsJSONReadsRouteModeWrapper(t *testing.T) {
	options := parseTunnelOptionsJSON(`{"routeMode":"wan","iceServers":[{"urls":["turn:turn.vividrop.cn:3478?transport=udp"],"username":"u","credential":"p"}]}`)

	if options.routeMode != iceRouteModeWAN {
		t.Fatalf("expected WAN route mode, got %q", options.routeMode)
	}
	if len(options.iceServers) != 2 {
		t.Fatalf("expected STUN plus TURN ICE servers, got %d", len(options.iceServers))
	}
	if got := options.iceServers[1].URLs[0]; got != "turn:turn.vividrop.cn:3478?transport=udp" {
		t.Fatalf("unexpected ICE URL: %s", got)
	}
}

func TestSummarizeTURNEndpointsIncludesTransportAndLiteralIPWithoutCredentials(t *testing.T) {
	endpoints := summarizeTURNEndpoints([]webrtc.ICEServer{
		{
			URLs: []string{
				"stun:stun.cloudflare.com:3478",
				"turn:user:secret@43.129.81.231:3478?transport=udp",
				"turn:turn.vividrop.cn:3478?transport=tcp",
			},
			Username:   "turn-user",
			Credential: "turn-pass",
		},
	})

	if len(endpoints) != 2 {
		t.Fatalf("expected 2 TURN endpoints, got %#v", endpoints)
	}
	if got := endpoints[0]; got != "scheme=turn host=43.129.81.231 port=3478 transport=udp literalIP=true" {
		t.Fatalf("unexpected literal IP endpoint: %s", got)
	}
	if got := endpoints[1]; got != "scheme=turn host=turn.vividrop.cn port=3478 transport=tcp literalIP=false" {
		t.Fatalf("unexpected DNS endpoint: %s", got)
	}
	joined := strings.Join(endpoints, ";")
	if strings.Contains(joined, "secret") || strings.Contains(joined, "turn-pass") || strings.Contains(joined, "turn-user") {
		t.Fatalf("TURN endpoint diagnostics leaked credentials: %s", joined)
	}
}

func TestSanitizePionICELogMessageRedactsTurnCredentials(t *testing.T) {
	msg := "failed to allocate on TURN client turn:turn-user:turn-pass@43.129.81.231:3478?transport=udp username=turn-user credential=turn-pass password=turn-pass"

	got := sanitizePionICELogMessage(msg)

	if strings.Contains(got, "turn-user") || strings.Contains(got, "turn-pass") {
		t.Fatalf("Pion ICE diagnostics leaked TURN credentials: %s", got)
	}
	if !strings.Contains(got, "turn:43.129.81.231:3478?transport=udp") {
		t.Fatalf("Pion ICE diagnostics lost sanitized TURN endpoint: %s", got)
	}
	if !strings.Contains(got, "username=<redacted>") || !strings.Contains(got, "credential=<redacted>") || !strings.Contains(got, "password=<redacted>") {
		t.Fatalf("Pion ICE diagnostics did not redact credential fields: %s", got)
	}
}
