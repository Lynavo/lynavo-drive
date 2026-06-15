package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDeviceBlockLifecycle(t *testing.T) {
	s := newTestStore(t)

	state, err := s.RecordConnectionAttempt(ConnectionAttempt{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		ClientName:      stringPtr("Alice iPhone"),
		Result:          "wrong_code",
		FailureReason:   stringPtr("invalid_code"),
		AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("RecordConnectionAttempt first wrong_code: %v", err)
	}
	if state.Blocked {
		t.Fatal("expected first wrong_code not to block")
	}
	if state.FailedAttemptCount != 1 {
		t.Fatalf("expected failed count 1, got %d", state.FailedAttemptCount)
	}
	if state.RemainingAttempts != 4 {
		t.Fatalf("expected 4 remaining attempts, got %d", state.RemainingAttempts)
	}

	for i := 0; i < 4; i++ {
		state, err = s.RecordConnectionAttempt(ConnectionAttempt{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			Result:          "wrong_code",
			FailureReason:   stringPtr("invalid_code"),
			AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
		})
		if err != nil {
			t.Fatalf("RecordConnectionAttempt wrong_code #%d: %v", i+2, err)
		}
	}
	if !state.Blocked {
		t.Fatal("expected fifth wrong_code to block")
	}
	if state.FailedAttemptCount != 5 {
		t.Fatalf("expected failed count 5, got %d", state.FailedAttemptCount)
	}
	if state.RemainingAttempts != 0 {
		t.Fatalf("expected 0 remaining attempts, got %d", state.RemainingAttempts)
	}

	got, err := s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState: %v", err)
	}
	if !got.Blocked {
		t.Fatal("expected stored block state to be active")
	}

	got, err = s.RecordConnectionAttempt(ConnectionAttempt{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		Result:          "success",
		AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("RecordConnectionAttempt success while blocked: %v", err)
	}
	if !got.Blocked {
		t.Fatal("expected success attempt not to clear active block")
	}

	if err := s.ClearConnectionAttempts("desktop-1", "client-1"); err != nil {
		t.Fatalf("ClearConnectionAttempts while blocked: %v", err)
	}
	got, err = s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState after clear while blocked: %v", err)
	}
	if !got.Blocked {
		t.Fatal("expected ClearConnectionAttempts not to clear active block")
	}
	if got.FailedAttemptCount != 5 {
		t.Fatalf("expected ClearConnectionAttempts to preserve failed count 5 while blocked, got %d", got.FailedAttemptCount)
	}

	if err := s.UnblockDevice("desktop-1", "client-1"); err != nil {
		t.Fatalf("UnblockDevice: %v", err)
	}
	got, err = s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState after unblock: %v", err)
	}
	if got.Blocked {
		t.Fatal("expected unblock to clear active blocked state")
	}
	if got.FailedAttemptCount != 0 {
		t.Fatalf("expected unblock to reset failed count, got %d", got.FailedAttemptCount)
	}
	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("Marshal DeviceBlockState: %v", err)
	}
	if strings.Contains(string(payload), "manuallyUnblockedAt") {
		t.Fatalf("DeviceBlockState JSON must not expose manuallyUnblockedAt: %s", string(payload))
	}
}

func TestDeviceBlockDesktopIsolation(t *testing.T) {
	s := newTestStore(t)

	for i := 0; i < 5; i++ {
		_, err := s.RecordConnectionAttempt(ConnectionAttempt{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			Result:          "wrong_code",
			FailureReason:   stringPtr("invalid_code"),
			AttemptedAt:     time.Now().UTC().Format(time.RFC3339),
		})
		if err != nil {
			t.Fatalf("RecordConnectionAttempt desktop-1 #%d: %v", i+1, err)
		}
	}

	desktopOne, err := s.GetDeviceBlockState("desktop-1", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState desktop-1: %v", err)
	}
	if !desktopOne.Blocked {
		t.Fatal("expected desktop-1/client-1 to be blocked")
	}

	desktopTwo, err := s.GetDeviceBlockState("desktop-2", "client-1")
	if err != nil {
		t.Fatalf("GetDeviceBlockState desktop-2: %v", err)
	}
	if desktopTwo.Blocked {
		t.Fatal("expected desktop-2/client-1 to remain unblocked")
	}
	if desktopTwo.FailedAttemptCount != 0 {
		t.Fatalf("expected desktop-2 failed count 0, got %d", desktopTwo.FailedAttemptCount)
	}
}
