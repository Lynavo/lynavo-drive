package store

// PairedDevice represents a mobile device that has been paired with this sidecar.
type PairedDevice struct {
	ClientID         string  `json:"clientId"`
	ClientName       string  `json:"clientName"`
	DeviceAlias      *string `json:"deviceAlias,omitempty"`
	LastIP           *string `json:"ip,omitempty"`
	Platform         string  `json:"platform"`
	PairingID        string  `json:"pairingId"`
	PairingTokenHash string  `json:"-"`
	CreatedAt        string  `json:"createdAt"`
	LastSeenAt       string  `json:"lastSeenAt"`
	RevokedAt        *string `json:"revokedAt,omitempty"`
	ReceiveDirName   *string `json:"-"` // sanitized dir name on disk
}

// Upload represents a single file upload record.
type Upload struct {
	FileKey              string  `json:"fileKey"`
	SessionID            *string `json:"sessionId,omitempty"`
	ClientID             string  `json:"clientId"`
	OriginalFilename     string  `json:"originalFilename"`
	MediaType            string  `json:"mediaType"`
	FileSize             int64   `json:"fileSize"`
	CreatedAtRemote      *string `json:"createdAtRemote,omitempty"`
	ModifiedAtRemote     *string `json:"modifiedAtRemote,omitempty"`
	Status               string  `json:"status"`
	PartPath             *string `json:"-"`
	FinalPath            *string `json:"finalPath,omitempty"`
	CommittedBytes       int64   `json:"committedBytes"`
	SHA256               *string `json:"sha256,omitempty"`
	ActiveTransmissionMs int64   `json:"activeTransmissionMs"`
	CompletedAt          *string `json:"completedAt,omitempty"`
	UpdatedAt            string  `json:"updatedAt"`
}

// DailyStats represents per-device daily aggregated statistics.
type DailyStats struct {
	StatDate             string `json:"statDate"`
	ClientID             string `json:"clientId"`
	ClientNameSnapshot   string `json:"clientNameSnapshot"`
	ClientIPSnapshot     string `json:"clientIpSnapshot"`
	FileCount            int    `json:"fileCount"`
	TotalBytes           int64  `json:"totalBytes"`
	ActiveTransmissionMs int64  `json:"activeTransmissionMs"`
	UpdatedAt            string `json:"updatedAt"`
}

// ShareConfig represents the singleton SMB share configuration row.
type ShareConfig struct {
	ReceiveRoot     string  `json:"receiveRoot"`
	ShareName       string  `json:"shareName"`
	ShareURL        string  `json:"shareUrl"`
	ShareStatus     string  `json:"shareStatus"`
	LastValidatedAt *string `json:"lastValidatedAt,omitempty"`
	LastError       *string `json:"lastError,omitempty"`
}

// Session represents a sync session between a device and this sidecar.
type Session struct {
	SessionID     string  `json:"sessionId"`
	ClientID      string  `json:"clientId"`
	ClientName    string  `json:"clientName"`
	State         string  `json:"state"`
	ActiveFileKey *string `json:"activeFileKey,omitempty"`
	ActiveOffset  int64   `json:"activeOffset"`
	StartedAt     string  `json:"startedAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

// DashboardSummaryResult holds the aggregated dashboard summary for a given day.
type DashboardSummaryResult struct {
	TotalFiles int   `json:"totalFiles"`
	TotalBytes int64 `json:"totalBytes"`
}

// DashboardDeviceResult holds per-device dashboard data including current transfer info.
// JSON tags match the DashboardDeviceDTO contract expected by the desktop renderer.
type DashboardDeviceResult struct {
	ClientID     string  `json:"deviceId"`
	ClientName   string  `json:"clientName"`
	DeviceAlias  *string `json:"deviceAlias,omitempty"`
	LastIP       *string `json:"ip,omitempty"`
	Platform     string  `json:"platform"`
	LastSeenAt   string  `json:"lastSeenAt"`
	FileCount    int     `json:"todayFileCount"`
	TotalBytes   int64   `json:"todayBytes"`
	CurrentFile  *string `json:"currentFile,omitempty"`
	SessionState *string `json:"sessionState,omitempty"`
}
