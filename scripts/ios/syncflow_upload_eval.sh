#!/usr/bin/env bash
set -euo pipefail

MODE="batch"
ROUNDS=5
FILE_KEY=""
DEVICE=""
APP=""
UPLOAD_CHUNK_MB=""
UPLOAD_WINDOW_MB=""
UPLOAD_PIPELINE_CHUNKS=""
UPLOAD_ACK_TIMEOUT_SEC=""
UPLOAD_PERF_LOG=""
UPLOAD_FORCE_HOST=""
UPLOAD_FORCE_PORT=""
SIDE_DB="$HOME/Library/Application Support/SyncFlow/sidecar.db"
RECV_DIR="$HOME/Library/Application Support/SyncFlow/received"
STAGING_DIR="$HOME/Library/Application Support/SyncFlow/staging"
TMP_ROOT="/tmp/syncflow-upload-eval"
LOG_ROOT="/tmp/syncflow-upload-eval-logs"
RESULTS=""
THRESHOLD_BYTES=$((512 * 1024 * 1024))
ROUND_TIMEOUT_SEC=600
COMPLETE_TIMEOUT_SEC=900
SIDECAR_DIR="/Volumes/workspace/work/sync-flow/services/sidecar-go"
PAUSE_SEC=15

usage() {
  cat <<'EOF'
Usage:
  syncflow_upload_eval.sh --mode <batch|recovery-app|recovery-sidecar|recovery-late-sidecar|recovery-sidecar-pause|recovery-app-suspend|all> \
    --device <DEVICE_UDID> \
    --app <BUNDLE_ID> \
    --file-key <FILE_KEY> \
    [--chunk-mb <N>] \
    [--window-mb <N>] \
    [--pipeline-chunks <N>] \
    [--ack-timeout-sec <N>] \
    [--perf-log <0|1>] \
    [--force-host <HOST>] \
    [--force-port <PORT>] \
    [--rounds <N>] \
    [--side-db <PATH>] \
    [--recv-dir <PATH>] \
    [--staging-dir <PATH>] \
    [--tmp-root <PATH>] \
    [--log-root <PATH>] \
    [--results <CSV_PATH>] \
    [--threshold-bytes <N>] \
    [--pause-sec <N>] \
    [--round-timeout-sec <N>] \
    [--complete-timeout-sec <N>] \
    [--sidecar-dir <PATH>]

Examples:
  bash scripts/ios/syncflow_upload_eval.sh \
    --mode batch \
    --device 88D18636-8E5D-5111-80CF-8A540F81DA1D \
    --app com.vividrop.mobile.china \
    --file-key c42c4420... \
    --chunk-mb 16 \
    --window-mb 256 \
    --pipeline-chunks 32 \
    --force-host 192.168.1.197 \
    --perf-log 1

  bash scripts/ios/syncflow_upload_eval.sh \
    --mode recovery-app \
    --device 88D18636-8E5D-5111-80CF-8A540F81DA1D \
    --app com.vividrop.mobile.china \
    --file-key c42c4420...
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

require_cmd() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing required command: $cmd" >&2
    exit 1
  fi
}

epoch_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

sql_sidecar() {
  local sql=$1
  sqlite3 "$SIDE_DB" "$sql"
}

pull_device_db() {
  local out_dir=$1
  mkdir -p "$out_dir"
  xcrun devicectl device copy from \
    --device "$DEVICE" \
    --source Documents/syncflow.db \
    --destination "$out_dir/syncflow.db" \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    >"$out_dir/pull.log" 2>&1
}

seed_device_db_from_local_snapshot() {
  local out_dir=$1
  local seed_db
  seed_db=$(ls -t "$TMP_ROOT"/state-*/syncflow.db 2>/dev/null | head -n 1 || true)
  if [ -z "$seed_db" ] || [ ! -f "$seed_db" ]; then
    return 1
  fi

  cp "$seed_db" "$out_dir/syncflow.db"
  if [ -f "${seed_db}-wal" ]; then
    cp "${seed_db}-wal" "$out_dir/syncflow.db-wal"
  else
    : >"$out_dir/syncflow.db-wal"
  fi
  if [ -f "${seed_db}-shm" ]; then
    cp "${seed_db}-shm" "$out_dir/syncflow.db-shm"
  else
    : >"$out_dir/syncflow.db-shm"
  fi
  log "DEVICE_DB_SEEDED from=$seed_db"
}

push_device_db() {
  local out_dir=$1
  xcrun devicectl device copy to \
    --device "$DEVICE" \
    --source "$out_dir/syncflow.db" \
    --destination Documents/syncflow.db \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    >"$out_dir/push-db.log" 2>&1

  xcrun devicectl device copy to \
    --device "$DEVICE" \
    --source "$out_dir/syncflow.db-wal" \
    --destination Documents/syncflow.db-wal \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    >"$out_dir/push-wal.log" 2>&1

  xcrun devicectl device copy to \
    --device "$DEVICE" \
    --source "$out_dir/syncflow.db-shm" \
    --destination Documents/syncflow.db-shm \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    >"$out_dir/push-shm.log" 2>&1
}

pull_device_preferences() {
  local out_dir=$1
  mkdir -p "$out_dir"
  local dst="$out_dir/${APP}.plist"
  if ! xcrun devicectl device copy from \
    --device "$DEVICE" \
    --source "Library/Preferences/${APP}.plist" \
    --destination "$dst" \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    >"$out_dir/pull-prefs.log" 2>&1
  then
    PREFS_SOURCE_MISSING=1
    return 0
  fi
  PREFS_SOURCE_MISSING=0
}

push_device_preferences() {
  local out_dir=$1
  xcrun devicectl device copy to \
    --device "$DEVICE" \
    --source "$out_dir/${APP}.plist" \
    --destination "Library/Preferences/${APP}.plist" \
    --domain-type appDataContainer \
    --domain-identifier "$APP" \
    >"$out_dir/push-prefs.log" 2>&1
}

apply_device_tuning() {
  local tag=$1
  local out_dir="$TMP_ROOT/prefs-$tag"
  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  PREFS_SOURCE_MISSING=0
  pull_device_preferences "$out_dir"

  python3 - <<'PY' \
    "$out_dir/${APP}.plist" \
    "$UPLOAD_CHUNK_MB" \
    "$UPLOAD_WINDOW_MB" \
    "$UPLOAD_PIPELINE_CHUNKS" \
    "$UPLOAD_ACK_TIMEOUT_SEC" \
    "$UPLOAD_PERF_LOG"
import plistlib
import sys
from pathlib import Path

plist_path = Path(sys.argv[1])
chunk_mb = sys.argv[2]
window_mb = sys.argv[3]
pipeline_chunks = sys.argv[4]
ack_timeout_sec = sys.argv[5]
perf_log = sys.argv[6]

data = {}
if plist_path.exists():
    with plist_path.open("rb") as fh:
        data = plistlib.load(fh)

def apply_int(raw: str, key: str) -> None:
    if raw:
        data[key] = int(raw)
    else:
        data.pop(key, None)

apply_int(chunk_mb, "SyncFlowUploadChunkMB")
apply_int(window_mb, "SyncFlowUploadWindowMB")
apply_int(pipeline_chunks, "SyncFlowUploadPipelineChunks")
apply_int(ack_timeout_sec, "SyncFlowUploadAckTimeoutSec")
if perf_log:
    data["SyncFlowUploadPerfLog"] = perf_log.lower() in {"1", "true", "yes", "on"}
else:
    data.pop("SyncFlowUploadPerfLog", None)

plist_path.parent.mkdir(parents=True, exist_ok=True)
with plist_path.open("wb") as fh:
    plistlib.dump(data, fh, fmt=plistlib.FMT_BINARY)
PY

  push_device_preferences "$out_dir"
  log "DEVICE_TUNING chunk_mb=${UPLOAD_CHUNK_MB:-default} window_mb=${UPLOAD_WINDOW_MB:-default} pipeline_chunks=${UPLOAD_PIPELINE_CHUNKS:-default} ack_timeout_sec=${UPLOAD_ACK_TIMEOUT_SEC:-default} perf_log=${UPLOAD_PERF_LOG:-default}"
}

reset_sidecar_state() {
  sql_sidecar "UPDATE uploads SET status='failed', committed_bytes=0, active_transmission_ms=0, part_path=NULL, final_path=NULL, sha256=NULL, completed_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE file_key='$FILE_KEY';"

  if [ -d "$RECV_DIR" ]; then
    find "$RECV_DIR" -type f -name "*${FILE_KEY:0:8}*" -delete || true
  fi
  if [ -d "$STAGING_DIR" ]; then
    find "$STAGING_DIR" -type f -name "*$FILE_KEY*" -delete || true
  fi
}

reset_device_queue_state() {
  local round_tag=$1
  local out_dir="$TMP_ROOT/state-$round_tag"
  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  if ! pull_device_db "$out_dir"; then
    if ! seed_device_db_from_local_snapshot "$out_dir"; then
      echo "failed to pull device db and no local seed snapshot found" >&2
      return 1
    fi
  fi

  sqlite3 "$out_dir/syncflow.db" "UPDATE upload_items SET status='completed', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE file_key<>'$FILE_KEY' AND status<>'completed';"
  sqlite3 "$out_dir/syncflow.db" "UPDATE upload_items SET status='queued', acked_offset=0, last_error_code=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE file_key='$FILE_KEY';"
  sqlite3 "$out_dir/syncflow.db" "PRAGMA wal_checkpoint(TRUNCATE);"
  : >"$out_dir/syncflow.db-wal"
  : >"$out_dir/syncflow.db-shm"

  push_device_db "$out_dir"
}

launch_app() {
  local log_file=$1
  local env_json
  local attach_console=0
  env_json=$(python3 - <<'PY' \
    "$UPLOAD_CHUNK_MB" \
    "$UPLOAD_WINDOW_MB" \
    "$UPLOAD_PIPELINE_CHUNKS" \
    "$UPLOAD_ACK_TIMEOUT_SEC" \
    "$UPLOAD_PERF_LOG" \
    "$UPLOAD_FORCE_HOST" \
    "$UPLOAD_FORCE_PORT"
import json
import sys

chunk_mb = sys.argv[1]
window_mb = sys.argv[2]
pipeline_chunks = sys.argv[3]
ack_timeout_sec = sys.argv[4]
perf_log = sys.argv[5]
force_host = sys.argv[6]
force_port = sys.argv[7]

env = {}
if chunk_mb:
    env["SYNCFLOW_UPLOAD_CHUNK_MB"] = chunk_mb
if window_mb:
    env["SYNCFLOW_UPLOAD_WINDOW_MB"] = window_mb
if pipeline_chunks:
    env["SYNCFLOW_UPLOAD_PIPELINE_CHUNKS"] = pipeline_chunks
if ack_timeout_sec:
    env["SYNCFLOW_UPLOAD_ACK_TIMEOUT_SEC"] = ack_timeout_sec
if perf_log:
    env["SYNCFLOW_UPLOAD_PERF_LOG"] = perf_log
if force_host:
    env["SYNCFLOW_UPLOAD_FORCE_HOST"] = force_host
if force_port:
    env["SYNCFLOW_UPLOAD_FORCE_PORT"] = force_port

print(json.dumps(env, separators=(",", ":")))
PY
)

  if [ -n "$UPLOAD_PERF_LOG" ] && [ "$UPLOAD_PERF_LOG" != "0" ]; then
    attach_console=1
  fi

  if [ "$attach_console" -eq 1 ]; then
    if [ "$env_json" = "{}" ]; then
      (
        xcrun devicectl device process launch \
          --device "$DEVICE" \
          --terminate-existing \
          --console \
          "$APP"
      ) >"$log_file" 2>&1 &
    else
      (
        xcrun devicectl device process launch \
          --device "$DEVICE" \
          --environment-variables "$env_json" \
          --terminate-existing \
          --console \
          "$APP"
      ) >"$log_file" 2>&1 &
    fi
    sleep 1
  elif [ "$env_json" = "{}" ]; then
    xcrun devicectl device process launch \
      --device "$DEVICE" \
      --terminate-existing \
      "$APP" \
      >"$log_file" 2>&1
  else
    xcrun devicectl device process launch \
      --device "$DEVICE" \
      --environment-variables "$env_json" \
      --terminate-existing \
      "$APP" \
      >"$log_file" 2>&1
  fi
}

wait_for_threshold() {
  local threshold_bytes=$1
  local timeout_sec=$2
  local deadline=$(( $(date +%s) + timeout_sec ))
  while true; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      return 1
    fi
    local row
    row=$(sql_sidecar "SELECT status,committed_bytes FROM uploads WHERE file_key='$FILE_KEY';")
    if [ -z "$row" ]; then
      sleep 2
      continue
    fi
    local st committed
    st=$(echo "$row" | cut -d'|' -f1)
    committed=$(echo "$row" | cut -d'|' -f2)
    log "WAIT_THRESHOLD st=$st committed=$committed"
    if [ "$st" = "receiving" ] && [ "$committed" -ge "$threshold_bytes" ]; then
      echo "$committed"
      return 0
    fi
    sleep 2
  done
}

wait_for_completion() {
  local round=$1
  local start_ms=$2
  local timeout_sec=$3
  local out_csv=$4

  local deadline=$(( $(date +%s) + timeout_sec ))
  local last_status=""
  while true; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "ROUND_TIMEOUT $round"
      return 2
    fi

    local row
    row=$(sql_sidecar "SELECT status,committed_bytes,active_transmission_ms,file_size FROM uploads WHERE file_key='$FILE_KEY';")
    if [ -z "$row" ]; then
      sleep 2
      continue
    fi

    local st committed active_ms size
    st=$(echo "$row" | cut -d'|' -f1)
    committed=$(echo "$row" | cut -d'|' -f2)
    active_ms=$(echo "$row" | cut -d'|' -f3)
    size=$(echo "$row" | cut -d'|' -f4)

    if [ "$st" != "$last_status" ]; then
      log "ROUND_STATUS $round st=$st committed=$committed"
      last_status="$st"
    fi

    if [ "$st" = "completed" ]; then
      local end_ms
      end_ms=$(epoch_ms)
      local e2e_ms=$((end_ms - start_ms))
      python3 - <<'PY' "$round" "$size" "$active_ms" "$e2e_ms" "$out_csv"
import sys
r = sys.argv[1]
size = float(sys.argv[2] or 0)
active_ms = float(sys.argv[3] or 0)
e2e_ms = float(sys.argv[4] or 0)
out = sys.argv[5]

def speed(size_bytes: float, ms: float, unit: str) -> float:
    sec = ms / 1000.0
    if sec <= 0:
        return 0.0
    if unit == "mib":
        return (size_bytes / (1024 * 1024)) / sec
    return (size_bytes / 1_000_000) / sec

speed_mib_active = speed(size, active_ms, "mib")
speed_mb_active = speed(size, active_ms, "mb")
speed_mib_e2e = speed(size, e2e_ms, "mib")
speed_mb_e2e = speed(size, e2e_ms, "mb")

with open(out, "a", encoding="utf-8") as f:
    f.write(
        f"{r},{int(size)},{int(active_ms)},{int(e2e_ms)},"
        f"{speed_mib_active:.6f},{speed_mb_active:.6f},"
        f"{speed_mib_e2e:.6f},{speed_mb_e2e:.6f}\n"
    )

print(
    f"ROUND_DONE {r} active_ms={int(active_ms)} e2e_ms={int(e2e_ms)} "
    f"speed_mb_s_active={speed_mb_active:.3f} speed_mb_s_e2e={speed_mb_e2e:.3f}"
)
PY
      return 0
    fi

    sleep 2
  done
}

summarize_results() {
  local csv=$1
  python3 - <<'PY' "$csv"
import csv
import statistics
import sys

p = sys.argv[1]
rows = list(csv.DictReader(open(p, encoding="utf-8")))
if not rows:
    print("no rows")
    raise SystemExit(0)

def percentile(sorted_vals, q):
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac

active = [float(r["speed_mb_s_active"]) for r in rows]
e2e = [float(r["speed_mb_s_e2e"]) for r in rows]
dur = [int(r["active_ms"]) for r in rows]
active_s = sorted(active)
e2e_s = sorted(e2e)

print(f"rounds={len(rows)}")
print(f"active_ms avg={statistics.mean(dur):.1f} min={min(dur)} max={max(dur)}")
print(f"speed_mb_s_active avg={statistics.mean(active):.3f} p50={statistics.median(active):.3f} p90={percentile(active_s,0.9):.3f} min={min(active):.3f} max={max(active):.3f}")
print(f"speed_mb_s_e2e avg={statistics.mean(e2e):.3f} p50={statistics.median(e2e):.3f} p90={percentile(e2e_s,0.9):.3f} min={min(e2e):.3f} max={max(e2e):.3f}")
PY
}

ensure_sidecar_running() {
  if pgrep -f syncflow-sidecar >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "$UPLOAD_PERF_LOG" ] && [ "$UPLOAD_PERF_LOG" != "0" ]; then
    (cd "$SIDECAR_DIR" && nohup env SYNCFLOW_UPLOAD_PERF_LOG=1 go run ./cmd/syncflow-sidecar/ >"$LOG_ROOT/sidecar-restart.log" 2>&1 &)
  else
    (cd "$SIDECAR_DIR" && nohup go run ./cmd/syncflow-sidecar/ >"$LOG_ROOT/sidecar-restart.log" 2>&1 &)
  fi
  sleep 2
}

stop_sidecar() {
  pkill -f 'go run ./cmd/syncflow-sidecar/' || true
  pkill -f '/syncflow-sidecar' || true
  sleep 1
}

pause_sidecar() {
  pkill -STOP -f 'go run ./cmd/syncflow-sidecar/' || true
  pkill -STOP -f '/syncflow-sidecar' || true
  sleep 1
}

resume_sidecar() {
  pkill -CONT -f 'go run ./cmd/syncflow-sidecar/' || true
  pkill -CONT -f '/syncflow-sidecar' || true
  sleep 1
}

restart_sidecar() {
  stop_sidecar
  if [ -n "$UPLOAD_PERF_LOG" ] && [ "$UPLOAD_PERF_LOG" != "0" ]; then
    (cd "$SIDECAR_DIR" && nohup env SYNCFLOW_UPLOAD_PERF_LOG=1 go run ./cmd/syncflow-sidecar/ >"$LOG_ROOT/sidecar-restart.log" 2>&1 &)
  else
    (cd "$SIDECAR_DIR" && nohup go run ./cmd/syncflow-sidecar/ >"$LOG_ROOT/sidecar-restart.log" 2>&1 &)
  fi
  sleep 2
}

wait_for_log_pattern() {
  local log_file=$1
  local pattern=$2
  local timeout_sec=$3
  local deadline=$(( $(date +%s) + timeout_sec ))

  while true; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      return 1
    fi
    if [ -f "$log_file" ] && grep -q "$pattern" "$log_file"; then
      return 0
    fi
    sleep 1
  done
}

get_device_app_pid() {
  local json_out="$TMP_ROOT/device-processes.json"
  xcrun devicectl device info processes \
    --device "$DEVICE" \
    --json-output "$json_out" \
    >/dev/null 2>&1

  python3 - <<'PY' "$json_out"
import json
import sys

obj = json.load(open(sys.argv[1], encoding="utf-8"))
for proc in obj.get("result", {}).get("runningProcesses", []):
    executable = proc.get("executable", "")
    pid = proc.get("processIdentifier")
    if "LynavoDrive.app/LynavoDrive" in executable and pid is not None:
        print(pid)
        raise SystemExit(0)
raise SystemExit(1)
PY
}

suspend_app_process() {
  local pid=$1
  xcrun devicectl device process suspend \
    --device "$DEVICE" \
    --pid "$pid" \
    >/dev/null 2>&1
}

resume_app_process() {
  local pid=$1
  xcrun devicectl device process resume \
    --device "$DEVICE" \
    --pid "$pid" \
    >/dev/null 2>&1
}

run_batch() {
  mkdir -p "$TMP_ROOT" "$LOG_ROOT"
  ensure_sidecar_running
  if [ -z "$RESULTS" ]; then
    RESULTS="$TMP_ROOT/results-batch-$(date +%Y%m%d-%H%M%S).csv"
  fi
  echo 'round,size_bytes,active_ms,e2e_ms,speed_mib_s_active,speed_mb_s_active,speed_mib_s_e2e,speed_mb_s_e2e' >"$RESULTS"

  log "BATCH_START rounds=$ROUNDS file_key=$FILE_KEY results=$RESULTS force_host=${UPLOAD_FORCE_HOST:-default} force_port=${UPLOAD_FORCE_PORT:-default}"
  for r in $(seq 1 "$ROUNDS"); do
    log "ROUND_START $r"
    reset_sidecar_state
    reset_device_queue_state "batch-r$r"
    local start_ms
    start_ms=$(epoch_ms)
    launch_app "$LOG_ROOT/launch-batch-r$r.log"
    wait_for_completion "$r" "$start_ms" "$COMPLETE_TIMEOUT_SEC" "$RESULTS"
  done

  log "BATCH_RESULTS"
  cat "$RESULTS"
  log "BATCH_SUMMARY"
  summarize_results "$RESULTS"
}

run_recovery_app() {
  mkdir -p "$TMP_ROOT" "$LOG_ROOT"
  ensure_sidecar_running
  local out_csv="${RESULTS:-$TMP_ROOT/results-recovery-app-$(date +%Y%m%d-%H%M%S).csv}"
  echo 'scenario,pre_restart_committed,size_bytes,active_ms,speed_mib_s_active,speed_mb_s_active' >"$out_csv"

  log "RECOVERY_TEST_APP_ONLY START file_key=$FILE_KEY"
  reset_sidecar_state
  reset_device_queue_state "recovery-app"
  launch_app "$LOG_ROOT/launch-recovery-app-1.log"

  local pre_restart
  pre_restart=$(wait_for_threshold "$THRESHOLD_BYTES" "$ROUND_TIMEOUT_SEC")
  log "INJECT app_restart pre_committed=$pre_restart"
  launch_app "$LOG_ROOT/launch-recovery-app-2.log"

  local start_ms
  start_ms=$(epoch_ms)
  wait_for_completion "recovery-app" "$start_ms" "$COMPLETE_TIMEOUT_SEC" "$TMP_ROOT/.tmp-recovery-app.csv"
  local row
  row=$(tail -n 1 "$TMP_ROOT/.tmp-recovery-app.csv")
  local size active_ms speed_mib speed_mb
  size=$(echo "$row" | cut -d',' -f2)
  active_ms=$(echo "$row" | cut -d',' -f3)
  speed_mib=$(echo "$row" | cut -d',' -f5)
  speed_mb=$(echo "$row" | cut -d',' -f6)
  echo "app_restart,$pre_restart,$size,$active_ms,$speed_mib,$speed_mb" >>"$out_csv"
  log "RECOVERY_TEST_APP_ONLY_RESULT pre_restart_committed=$pre_restart active_ms=$active_ms speed_mb_s_active=$speed_mb"
  cat "$out_csv"
}

run_recovery_sidecar() {
  mkdir -p "$TMP_ROOT" "$LOG_ROOT"
  ensure_sidecar_running

  log "RECOVERY_TEST_SIDECAR START file_key=$FILE_KEY"
  reset_sidecar_state
  reset_device_queue_state "recovery-sidecar"
  launch_app "$LOG_ROOT/launch-recovery-sidecar-1.log"

  local pre_kill
  pre_kill=$(wait_for_threshold "$THRESHOLD_BYTES" "$ROUND_TIMEOUT_SEC")
  log "INJECT sidecar_restart pre_committed=$pre_kill"
  restart_sidecar

  local start_ms
  start_ms=$(epoch_ms)
  if wait_for_completion "recovery-sidecar" "$start_ms" "$COMPLETE_TIMEOUT_SEC" "$TMP_ROOT/.tmp-recovery-sidecar.csv"; then
    log "RECOVERY_TEST_SIDECAR PASS"
    tail -n 1 "$TMP_ROOT/.tmp-recovery-sidecar.csv"
  else
    log "RECOVERY_TEST_SIDECAR FAIL"
    return 3
  fi
}

run_recovery_late_sidecar() {
  mkdir -p "$TMP_ROOT" "$LOG_ROOT"

  log "RECOVERY_TEST_LATE_SIDECAR START file_key=$FILE_KEY"
  stop_sidecar
  reset_sidecar_state
  reset_device_queue_state "recovery-late-sidecar"

  local launch_log="$LOG_ROOT/launch-recovery-late-sidecar.log"
  launch_app "$launch_log"

  if ! wait_for_log_pattern "$launch_log" "reconnecting in" 60; then
    log "RECOVERY_TEST_LATE_SIDECAR FAIL no backoff detected"
    return 4
  fi

  log "INJECT late_sidecar_start"
  restart_sidecar

  local start_ms
  start_ms=$(epoch_ms)
  if wait_for_completion "recovery-late-sidecar" "$start_ms" "$COMPLETE_TIMEOUT_SEC" "$TMP_ROOT/.tmp-recovery-late-sidecar.csv"; then
    log "RECOVERY_TEST_LATE_SIDECAR PASS"
    tail -n 1 "$TMP_ROOT/.tmp-recovery-late-sidecar.csv"
  else
    log "RECOVERY_TEST_LATE_SIDECAR FAIL"
    return 5
  fi
}

run_recovery_sidecar_pause() {
  mkdir -p "$TMP_ROOT" "$LOG_ROOT"
  ensure_sidecar_running

  log "RECOVERY_TEST_SIDECAR_PAUSE START file_key=$FILE_KEY pause_sec=$PAUSE_SEC"
  reset_sidecar_state
  reset_device_queue_state "recovery-sidecar-pause"

  local launch_log="$LOG_ROOT/launch-recovery-sidecar-pause.log"
  launch_app "$launch_log"

  local pre_pause
  pre_pause=$(wait_for_threshold "$THRESHOLD_BYTES" "$ROUND_TIMEOUT_SEC")
  log "INJECT sidecar_pause pre_committed=$pre_pause pause_sec=$PAUSE_SEC"
  pause_sidecar
  sleep "$PAUSE_SEC"
  log "INJECT sidecar_resume"
  resume_sidecar

  if ! wait_for_log_pattern "$launch_log" "reconnecting in" 90; then
    log "RECOVERY_TEST_SIDECAR_PAUSE FAIL no backoff detected"
    return 6
  fi

  local start_ms
  start_ms=$(epoch_ms)
  if wait_for_completion "recovery-sidecar-pause" "$start_ms" "$COMPLETE_TIMEOUT_SEC" "$TMP_ROOT/.tmp-recovery-sidecar-pause.csv"; then
    log "RECOVERY_TEST_SIDECAR_PAUSE PASS"
    tail -n 1 "$TMP_ROOT/.tmp-recovery-sidecar-pause.csv"
  else
    log "RECOVERY_TEST_SIDECAR_PAUSE FAIL"
    return 7
  fi
}

run_recovery_app_suspend() {
  mkdir -p "$TMP_ROOT" "$LOG_ROOT"
  ensure_sidecar_running

  log "RECOVERY_TEST_APP_SUSPEND START file_key=$FILE_KEY pause_sec=$PAUSE_SEC"
  reset_sidecar_state
  reset_device_queue_state "recovery-app-suspend"

  local launch_log="$LOG_ROOT/launch-recovery-app-suspend.log"
  launch_app "$launch_log"

  local pre_suspend
  pre_suspend=$(wait_for_threshold "$THRESHOLD_BYTES" "$ROUND_TIMEOUT_SEC")

  local pid
  if ! pid=$(get_device_app_pid); then
    log "RECOVERY_TEST_APP_SUSPEND FAIL no app pid found"
    return 8
  fi

  log "INJECT app_suspend pre_committed=$pre_suspend pid=$pid pause_sec=$PAUSE_SEC"
  suspend_app_process "$pid"
  sleep "$PAUSE_SEC"
  log "INJECT app_resume pid=$pid"
  resume_app_process "$pid"

  local start_ms
  start_ms=$(epoch_ms)
  if wait_for_completion "recovery-app-suspend" "$start_ms" "$COMPLETE_TIMEOUT_SEC" "$TMP_ROOT/.tmp-recovery-app-suspend.csv"; then
    log "RECOVERY_TEST_APP_SUSPEND PASS"
    tail -n 1 "$TMP_ROOT/.tmp-recovery-app-suspend.csv"
  else
    log "RECOVERY_TEST_APP_SUSPEND FAIL"
    return 9
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE=$2; shift 2 ;;
    --rounds) ROUNDS=$2; shift 2 ;;
    --device) DEVICE=$2; shift 2 ;;
    --app) APP=$2; shift 2 ;;
    --file-key) FILE_KEY=$2; shift 2 ;;
    --chunk-mb) UPLOAD_CHUNK_MB=$2; shift 2 ;;
    --window-mb) UPLOAD_WINDOW_MB=$2; shift 2 ;;
    --pipeline-chunks) UPLOAD_PIPELINE_CHUNKS=$2; shift 2 ;;
    --ack-timeout-sec) UPLOAD_ACK_TIMEOUT_SEC=$2; shift 2 ;;
    --perf-log) UPLOAD_PERF_LOG=$2; shift 2 ;;
    --force-host) UPLOAD_FORCE_HOST=$2; shift 2 ;;
    --force-port) UPLOAD_FORCE_PORT=$2; shift 2 ;;
    --side-db) SIDE_DB=$2; shift 2 ;;
    --recv-dir) RECV_DIR=$2; shift 2 ;;
    --staging-dir) STAGING_DIR=$2; shift 2 ;;
    --tmp-root) TMP_ROOT=$2; shift 2 ;;
    --log-root) LOG_ROOT=$2; shift 2 ;;
    --results) RESULTS=$2; shift 2 ;;
    --threshold-bytes) THRESHOLD_BYTES=$2; shift 2 ;;
    --pause-sec) PAUSE_SEC=$2; shift 2 ;;
    --round-timeout-sec) ROUND_TIMEOUT_SEC=$2; shift 2 ;;
    --complete-timeout-sec) COMPLETE_TIMEOUT_SEC=$2; shift 2 ;;
    --sidecar-dir) SIDECAR_DIR=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd sqlite3
require_cmd xcrun
require_cmd python3

if [ -z "$DEVICE" ] || [ -z "$APP" ] || [ -z "$FILE_KEY" ]; then
  echo "--device, --app, --file-key are required" >&2
  usage
  exit 1
fi

case "$MODE" in
  batch)
    run_batch
    ;;
  recovery-app)
    run_recovery_app
    ;;
  recovery-sidecar)
    run_recovery_sidecar
    ;;
  recovery-late-sidecar)
    run_recovery_late_sidecar
    ;;
  recovery-sidecar-pause)
    run_recovery_sidecar_pause
    ;;
  recovery-app-suspend)
    run_recovery_app_suspend
    ;;
  all)
    run_batch
    run_recovery_app
    run_recovery_sidecar
    run_recovery_late_sidecar
    run_recovery_sidecar_pause
    run_recovery_app_suspend
    ;;
  *)
    echo "invalid mode: $MODE" >&2
    usage
    exit 1
    ;;
esac
