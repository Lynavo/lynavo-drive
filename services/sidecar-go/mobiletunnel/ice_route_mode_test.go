package mobiletunnel

import (
	"testing"

	"github.com/pion/webrtc/v4"
)

func TestShouldSignalICECandidateFiltersPrivateHostCandidatesInWANMode(t *testing.T) {
	tests := []struct {
		name      string
		candidate *webrtc.ICECandidate
		want      bool
	}{
		{
			name: "drops link-local host",
			candidate: &webrtc.ICECandidate{
				Typ:     webrtc.ICECandidateTypeHost,
				Address: "169.254.188.171",
			},
			want: false,
		},
		{
			name: "drops private IPv4 host",
			candidate: &webrtc.ICECandidate{
				Typ:     webrtc.ICECandidateTypeHost,
				Address: "172.16.20.108",
			},
			want: false,
		},
		{
			name: "keeps public IPv6 host",
			candidate: &webrtc.ICECandidate{
				Typ:     webrtc.ICECandidateTypeHost,
				Address: "240e:111:222:333::1",
			},
			want: true,
		},
		{
			name: "keeps server-reflexive candidate",
			candidate: &webrtc.ICECandidate{
				Typ:     webrtc.ICECandidateTypeSrflx,
				Address: "203.0.113.10",
			},
			want: true,
		},
		{
			name: "keeps relay candidate",
			candidate: &webrtc.ICECandidate{
				Typ:     webrtc.ICECandidateTypeRelay,
				Address: "203.0.113.20",
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldSignalICECandidate(iceRouteModeWAN, tt.candidate); got != tt.want {
				t.Fatalf("shouldSignalICECandidate() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestShouldAcceptRemoteICECandidateFiltersPrivateHostCandidatesInWANMode(t *testing.T) {
	if shouldAcceptRemoteICECandidate(iceRouteModeWAN, webrtc.ICECandidateInit{
		Candidate: "candidate:1 1 udp 2130706431 169.254.98.106 51414 typ host",
	}) {
		t.Fatal("expected WAN mode to reject remote link-local host candidate")
	}

	if !shouldAcceptRemoteICECandidate(iceRouteModeWAN, webrtc.ICECandidateInit{
		Candidate: "candidate:2 1 udp 2130706431 240e:111:222:333::1 51414 typ host",
	}) {
		t.Fatal("expected WAN mode to accept remote public IPv6 host candidate")
	}

	if !shouldAcceptRemoteICECandidate(iceRouteModeWAN, webrtc.ICECandidateInit{
		Candidate: "candidate:3 1 udp 1694498815 203.0.113.10 51414 typ srflx raddr 172.16.20.108 rport 51414",
	}) {
		t.Fatal("expected WAN mode to accept remote server-reflexive candidate")
	}
}

func TestSelectedHostICERouteClassifiesPublicIPv4Direct(t *testing.T) {
	if got := selectedHostICERoute("198.51.100.10", "203.0.113.20"); got != "public_ipv4_direct" {
		t.Fatalf("expected public IPv4 host route, got %q", got)
	}
}
