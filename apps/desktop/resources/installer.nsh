; =============================================================
; Lynavo Drive - Windows Firewall rules
; Injected into the NSIS installer via nsis.include.
;
; Rule setup is idempotent: current Lynavo Drive rules are deleted
; before the current rules are added with the updated $INSTDIR path.
; =============================================================

!define SF_RULE_TCP  "Lynavo Drive Sidecar TCP"
!define SF_RULE_HTTP "Lynavo Drive Sidecar HTTP"
!define SF_RULE_MDNS "Lynavo Drive mDNS UDP"

; -------------------------------------------------------------
; Install / Upgrade
; -------------------------------------------------------------
!macro customInstall
  DetailPrint "Configuring Windows Firewall rules for Lynavo Drive..."

  ; Delete stale rules first.  netsh exits non-zero when no matching rule
  ; exists – that is expected on a fresh install, so we ignore the return code.
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="${SF_RULE_TCP}"'
  Pop $R0
  Pop $R1
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="${SF_RULE_HTTP}"'
  Pop $R0
  Pop $R1
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="${SF_RULE_MDNS}"'
  Pop $R0
  Pop $R1
  ; TCP 39593 – mobile → sidecar file-transfer.
  ; remoteip is intentionally unrestricted: in a typical home or office LAN the
  ; port is not exposed to the internet (NAT blocks it), so allowing any local
  ; source is safe.  Restricting to localsubnet would break cross-segment
  ; transfers (e.g. iPhone on 172.16.22.x connecting to Windows on 172.16.8.x).
  ; Scope to the sidecar executable when present for additional defence-in-depth.
  IfFileExists "$INSTDIR\resources\lynavo-drive-sidecar.exe" 0 +3
    nsExec::ExecToStack 'netsh advfirewall firewall add rule name="${SF_RULE_TCP}" dir=in action=allow protocol=TCP localport=39593 program="$INSTDIR\resources\lynavo-drive-sidecar.exe" description="Lynavo Drive sidecar file transfer (TCP 39593)"'
    Goto tcp_rule_done
  nsExec::ExecToStack 'netsh advfirewall firewall add rule name="${SF_RULE_TCP}" dir=in action=allow protocol=TCP localport=39593 description="Lynavo Drive sidecar file transfer (TCP 39593)"'
  tcp_rule_done:
  Pop $R0
  Pop $R1

  ; TCP 39594 – mobile discovery fallback and desktop health/API access.
  ; Android subnet fallback probes /health on the sidecar HTTP API before
  ; opening the LMUP TCP session, so Windows must allow this inbound port too.
  ; Scope to the sidecar executable when present for additional defence-in-depth.
  IfFileExists "$INSTDIR\resources\lynavo-drive-sidecar.exe" 0 +3
    nsExec::ExecToStack 'netsh advfirewall firewall add rule name="${SF_RULE_HTTP}" dir=in action=allow protocol=TCP localport=39594 program="$INSTDIR\resources\lynavo-drive-sidecar.exe" description="Lynavo Drive sidecar HTTP health and API (TCP 39594)"'
    Goto http_rule_done
  nsExec::ExecToStack 'netsh advfirewall firewall add rule name="${SF_RULE_HTTP}" dir=in action=allow protocol=TCP localport=39594 description="Lynavo Drive sidecar HTTP health and API (TCP 39594)"'
  http_rule_done:
  Pop $R0
  Pop $R1

  ; UDP 5353 – Bonjour/mDNS multicast used by mDNSResponder (Bonjour Service).
  ; remoteip is intentionally unrestricted (no localsubnet scope) because:
  ;   1. mDNS queries arrive at 224.0.0.251:5353 with the SENDER's unicast source
  ;      IP; when a router mDNS-proxy bridges WiFi ↔ wired, the source may come
  ;      from a different subnet (e.g. iPhone on 172.16.22.x querying Windows on
  ;      172.16.8.x).  Limiting to localsubnet would drop those queries and
  ;      prevent cross-segment discovery.
  ;   2. Restricting by localsubnet is safe for TCP but not for mDNS multicast.
  nsExec::ExecToStack 'netsh advfirewall firewall add rule name="${SF_RULE_MDNS}" dir=in action=allow protocol=UDP localport=5353 description="Lynavo Drive Bonjour/mDNS discovery (UDP 5353)"'
  Pop $R0
  Pop $R1

  DetailPrint "Windows Firewall rules configured."
!macroend

; -------------------------------------------------------------
; Uninstall
; -------------------------------------------------------------
!macro customUnInstall
  DetailPrint "Removing Lynavo Drive Windows Firewall rules..."
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="${SF_RULE_TCP}"'
  Pop $R0
  Pop $R1
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="${SF_RULE_HTTP}"'
  Pop $R0
  Pop $R1
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="${SF_RULE_MDNS}"'
  Pop $R0
  Pop $R1
!macroend
