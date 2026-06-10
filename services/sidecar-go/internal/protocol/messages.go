package protocol

// HelloReq is sent by the client to initiate a connection.
type HelloReq struct {
	ClientID                string `json:"clientId"`
	ClientName              string `json:"clientName"`
	ClientIP                string `json:"clientIp,omitempty"`
	ClientPlatform          string `json:"clientPlatform"`
	AppVersion              string `json:"appVersion"`
	AppCompatibilityVersion int    `json:"appCompatibilityVersion,omitempty"`
	PairingToken            string `json:"pairingToken,omitempty"`
	PreviousSessionID       string `json:"previousSessionId,omitempty"`
	AppState                string `json:"appState"`
	DeviceAlias             string `json:"deviceAlias,omitempty"`
	StableDeviceID          string `json:"stableDeviceId,omitempty"`
}

// HelloRes is the server's response to HelloReq.
type HelloRes struct {
	ServerID                string             `json:"serverId"`
	ServerName              string             `json:"serverName"`
	ServerType              string             `json:"serverType"`
	ServerAppVersion        string             `json:"serverAppVersion,omitempty"`
	AppCompatibilityVersion int                `json:"appCompatibilityVersion"`
	ProtoVersion            int                `json:"protoVersion"`
	AuthRequired            bool               `json:"authRequired"`
	Bound                   bool               `json:"bound"`
	Resume                  *ResumeInfo        `json:"resume"`
	ServerCapabilities      ServerCapabilities `json:"serverCapabilities"`
	Nonce                   string             `json:"nonce"`
}

// ResumeInfo carries session resume metadata when a client reconnects.
type ResumeInfo struct {
	Accepted      bool   `json:"accepted"`
	SessionID     string `json:"sessionId"`
	ActiveFileKey string `json:"activeFileKey,omitempty"`
	ResumeOffset  int64  `json:"resumeOffset"`
}

// WakeTarget describes one LAN interface target for Wake-on-LAN packets.
type WakeTarget struct {
	InterfaceName    string `json:"interfaceName"`
	MACAddress       string `json:"macAddress"`
	IPv4Address      string `json:"ipv4Address"`
	BroadcastAddress string `json:"broadcastAddress"`
	Ports            []int  `json:"ports"`
}

// WakeCapability is advertised while the sidecar is awake and cached by mobile.
type WakeCapability struct {
	Supported bool         `json:"supported"`
	Targets   []WakeTarget `json:"targets"`
	UpdatedAt string       `json:"updatedAt"`
}

// ServerCapabilities advertises feature flags to the client.
type ServerCapabilities struct {
	ShareEnabled        bool            `json:"shareEnabled"`
	ShareName           string          `json:"shareName"`
	LowDiskPauseEnabled bool            `json:"lowDiskPauseEnabled"`
	Wake                *WakeCapability `json:"wake,omitempty"`
}

// AuthReq is sent by a returning (already-paired) client after receiving
// a nonce in HelloRes. The Auth field is HMAC-SHA256(pairingToken, nonce).
type AuthReq struct {
	ClientID string `json:"clientId"`
	Auth     string `json:"auth"`
}

// PairReq is sent by a new (unpaired) client to initiate pairing.
type PairReq struct {
	ClientID       string `json:"clientId"`
	ClientName     string `json:"clientName"`
	ClientIP       string `json:"clientIp,omitempty"`
	ConnectionCode string `json:"connectionCode"`
	DeviceAlias    string `json:"deviceAlias,omitempty"`
	StableDeviceID string `json:"stableDeviceId,omitempty"`
}

// PairRes is the server's response to PairReq.
type PairRes struct {
	OK           bool       `json:"ok"`
	Error        string     `json:"error,omitempty"`
	PairingID    string     `json:"pairingId"`
	PairingToken string     `json:"pairingToken"`
	ServerInfo   ServerInfo `json:"serverInfo"`
}

// ServerInfo contains identifying information about the server.
type ServerInfo struct {
	ServerID   string `json:"serverId"`
	ServerName string `json:"serverName"`
	ShareName  string `json:"shareName"`
}

// SyncBeginReq initiates a sync session.
type SyncBeginReq struct {
	SessionID       string `json:"sessionId"`
	QueueTotalCount int    `json:"queueTotalCount"`
	QueueTotalBytes int64  `json:"queueTotalBytes"`
}

// SyncBeginRes acknowledges sync session start.
type SyncBeginRes struct {
	OK bool `json:"ok"`
}

// SyncEndRes acknowledges sync session end.
type SyncEndRes struct {
	OK bool `json:"ok"`
}

// FileInitReq declares a file the client intends to upload.
type FileInitReq struct {
	SessionID        string `json:"sessionId"`
	FileKey          string `json:"fileKey"`
	OriginalFilename string `json:"originalFilename"`
	MediaType        string `json:"mediaType"`
	MimeType         string `json:"mimeType"`
	FileSize         int64  `json:"fileSize"`
	CreatedAt        string `json:"createdAt"`
	ModifiedAt       string `json:"modifiedAt"`
	QueueIndex       int    `json:"queueIndex"`
	QueueTotalCount  int    `json:"queueTotalCount"`
}

// FileInitRes tells the client how to proceed with the declared file.
// Action is one of: UPLOAD, RESUME, SKIP, REJECT.
type FileInitRes struct {
	Action       string `json:"action"`
	ResumeOffset int64  `json:"resumeOffset,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

// FileAck acknowledges receipt of a FILE_DATA chunk.
type FileAck struct {
	FileKey         string `json:"fileKey"`
	CommittedOffset int64  `json:"committedOffset"`
}

// FileEndReq signals that the client has finished sending all data for a file.
type FileEndReq struct {
	FileKey  string `json:"fileKey"`
	FileSize int64  `json:"fileSize"`
	SHA256   string `json:"sha256"`
}

// FileEndRes is the server's verification result for a completed file.
type FileEndRes struct {
	OK                   bool   `json:"ok"`
	FileKey              string `json:"fileKey"`
	Reason               string `json:"reason,omitempty"`
	RelativePath         string `json:"relativePath"`
	LedgerDate           string `json:"ledgerDate,omitempty"`
	StoredBytes          int64  `json:"storedBytes"`
	ActiveTransmissionMs int64  `json:"activeTransmissionMs"`
}

// ErrorMsg is sent when a protocol-level error occurs.
type ErrorMsg struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
