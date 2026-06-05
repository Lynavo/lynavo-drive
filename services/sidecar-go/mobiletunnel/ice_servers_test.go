package mobiletunnel

import "testing"

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
