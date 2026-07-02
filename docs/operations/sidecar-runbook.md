# Sidecar Operations And Debugging Runbook

This document records the minimum sidecar runbook for local development,
debugging, and cleanup.

## 1. Sidecar Run Modes

### 1.1 Development Source Run

From the repository root:

```bash
pnpm dev:sidecar
```

Equivalent to:

```bash
cd services/sidecar-go
make run
```

Use cases:

- Local debugging
- Capturing foreground logs
- Quickly verifying sidecar behavior

### 1.2 Desktop Development Auto-Start

```bash
pnpm dev:desktop
```

Desktop main manages the sidecar lifecycle.

### 1.3 Packaged Embedded Sidecar

Desktop packages include one sidecar binary:

- macOS：`Lynavo Drive.app/Contents/Resources/lynavo-drive-sidecar`
- Windows：`<InstallDir>\\resources\\lynavo-drive-sidecar.exe`

## 2. Standard Ports

- TCP：`39393`
- HTTP：`39394`

If these two ports are not listening, most sync issues do not need higher-layer
analysis yet.

The Windows installer should currently write these inbound firewall rules:

- `Lynavo Drive Sidecar TCP`: `39393/TCP`, LMUP file transfer and `HELLO`
- `Lynavo Drive Sidecar HTTP`: `39394/TCP`, sidecar HTTP API, `/health`,
  mobile discovery fallback
- `Lynavo Drive mDNS UDP`: `5353/UDP`, Bonjour/mDNS discovery

## 3. Minimum Health Checks

### 3.1 Port Listening

macOS：

```bash
lsof -nP -iTCP:39393 -sTCP:LISTEN
lsof -nP -iTCP:39394 -sTCP:LISTEN
```

Windows（PowerShell）：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 39393,39394 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

### 3.2 Process Source

macOS：

```bash
pgrep -af 'lynavo-drive-sidecar|lynavo-drive-sidecar'
```

Windows（PowerShell）：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in @("lynavo-drive-sidecar.exe", "lynavo-drive-sidecar.exe") } |
  Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
```

How to interpret:

1. A path under the `go-build` cache is usually a leftover local source run.
2. A path under `Lynavo Drive.app/Contents/Resources/` or installer
   `resources\\` is usually the sidecar embedded in the desktop package.

### 3.3 Bonjour Broadcast

macOS：

```bash
dns-sd -B _lynavodrive._tcp local.
```

You should see the `_lynavodrive._tcp` broadcast.

Windows（PowerShell）：

```powershell
Get-Service -Name "Bonjour Service"
dns-sd.exe -B _lynavodrive._tcp local.
```

If `dns-sd.exe` is not in `PATH`, use the user's local Bonjour installation
directory or point `LYNAVO_BONJOUR_DIR` at a locally permitted source.

## 4. Common Leftover Issues

## 4.1 Sidecar Orphan Process

Symptoms:

- Desktop has exited.
- The local machine still listens on `39393 / 39394`.
- `ppid = 1`

Cause:

- A previous local script or source debugging run started a sidecar that was not
  cleaned up.

Fix:

macOS：

```bash
pkill -f 'lynavo-drive-sidecar|lynavo-drive-sidecar'
```

Windows（PowerShell）：

```powershell
Get-Process lynavo-drive-sidecar,lynavo-drive-sidecar -ErrorAction SilentlyContinue | Stop-Process -Force
```

## 4.2 Stale Online Bonjour Broadcast

Symptoms:

- The desktop is not actually listening on the ports.
- The mobile discovery page still sees the device.

Cause:

- A leftover `dns-sd -R` child process is still broadcasting.

Check:

macOS：

```bash
pgrep -af 'dns-sd.*_lynavodrive._tcp'
```

Windows（PowerShell）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" |
  Where-Object { $_.CommandLine -like '*_lynavodrive._tcp*' } |
  Select-Object ProcessId,ExecutablePath,CommandLine
```

Fix:

macOS：

```bash
pkill -f 'dns-sd.*_lynavodrive._tcp'
```

Windows（PowerShell）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" |
  Where-Object { $_.CommandLine -like '*_lynavodrive._tcp*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## 4.3 Windows Firewall / Bonjour Runtime

Symptoms:

- The sidecar is listening, but mobile cannot discover it or can discover it but
  cannot connect.
- The settings page reports Bonjour fallback or shared-entry issues.

Check:

```powershell
Get-Service -Name "Bonjour Service"
netsh advfirewall firewall show rule name="Lynavo Drive Sidecar TCP"
netsh advfirewall firewall show rule name="Lynavo Drive Sidecar HTTP"
netsh advfirewall firewall show rule name="Lynavo Drive mDNS UDP"
```

Fix principles:

1. First confirm `Bonjour Service` is installed and `Running`.
2. Then confirm firewall rules exist and are enabled for `39393/TCP`,
   `39394/TCP`, and `5353/UDP`.
3. If rules are missing, prefer reinstalling the latest Windows package so the
   NSIS installer script writes them again.

## 4.4 Desktop Package And Source Sidecar Conflict

Symptoms:

- You think you are testing the desktop package.
- Requests actually hit the local source sidecar.

Fix principles:

1. Before debugging, confirm only one sidecar remains.
2. Identify the process path first.
3. Do not let the source sidecar and packaged sidecar bind the same port at the
   same time.

## 5. Standard Local Cleanup

After debugging, run:

macOS：

```bash
pkill -f 'lynavo-drive-sidecar|lynavo-drive-sidecar' || true
pkill -f 'dns-sd.*_lynavodrive._tcp' || true
```

Then confirm:

macOS：

```bash
lsof -nP -iTCP:39393 -sTCP:LISTEN
lsof -nP -iTCP:39394 -sTCP:LISTEN
```

Windows（PowerShell）：

```powershell
Get-Process lynavo-drive-sidecar,lynavo-drive-sidecar -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" |
  Where-Object { $_.CommandLine -like '*_lynavodrive._tcp*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-NetTCPConnection -State Listen -LocalPort 39393,39394
```

Expected result:

- No listener
- No stale online broadcast

## 6. Use With Desktop Diagnostics

The desktop diagnostics package is enough to answer:

1. Whether the sidecar is healthy.
2. Whether it restarted recently.
3. Current `sidecar.db` state.
4. Whether the shared directory is configured correctly.
5. Current dashboard state for each device.

Therefore:

- If the issue is mainly desktop-side, collect desktop diagnostics first.
- If the issue is mainly in the app state machine, compare with mobile
  diagnostics.

## 7. Pre-Release Checks

Before every release, confirm at least:

1. The local machine has no leftover source sidecar.
2. Only the target platform's local package is tested in this round (macOS DMG /
   Windows NSIS).
3. Port listening, Bonjour, and HTTP API all work.
4. macOS: the DMG mounts and the embedded `lynavo-drive-sidecar` is executable.
5. Windows: the installer wrote firewall rules, and both the local Bonjour path
   or fallback mode have been verified.
