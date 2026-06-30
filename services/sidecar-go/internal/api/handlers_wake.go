package api

import "net/http"

// Proxy wake depended on official-account remote assistance. The OSS runtime
// keeps local wake metadata in presence responses but disables proxy wake.
func (s *Server) handleProxyWake(w http.ResponseWriter, r *http.Request) {
	s.writeOSSCommercialDisabled(w, r, "wake.proxy")
}
