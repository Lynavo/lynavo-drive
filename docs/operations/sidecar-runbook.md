# Sidecar 运维与联调手册

本文件记录 sidecar 在本地开发、联调和收尾时的最小操作手册。

## 1. sidecar 有几种运行方式

### 1.1 开发态源码运行

从仓库根目录：

```bash
pnpm dev:sidecar
```

等价于：

```bash
cd services/sidecar-go
make run
```

用途：

- 本地联调
- 抓前台日志
- 快速验证 sidecar 行为

### 1.2 desktop 开发态自动拉起

```bash
pnpm dev:desktop
```

desktop main 负责 sidecar 生命周期管理。

### 1.3 打包产物内嵌 sidecar

桌面端打包产物内都包含一份 sidecar 二进制：

- macOS：`SyncFlow.app/Contents/Resources/syncflow-sidecar`
- Windows：`<InstallDir>\\resources\\syncflow-sidecar.exe`

## 2. 标准端口

- TCP：`39393`
- HTTP：`39394`

如果这两个端口没有监听，绝大多数同步问题都没有必要继续往上看。

## 3. 最小健康检查

### 3.1 端口监听

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

### 3.2 进程来源

macOS：

```bash
pgrep -af syncflow-sidecar
```

Windows（PowerShell）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='syncflow-sidecar.exe'" |
  Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
```

判断点：

1. 如果路径在 `go-build` cache 下，通常是本地源码临时运行残留
2. 如果路径在 `SyncFlow.app/Contents/Resources/` 或安装目录 `resources\\` 下，通常是 desktop 包内 sidecar

### 3.3 Bonjour 广播

macOS：

```bash
dns-sd -B _syncflow._tcp local.
```

应能看到 `_syncflow._tcp` 广播。

Windows（PowerShell）：

```powershell
Get-Service -Name "Bonjour Service"
dns-sd.exe -B _syncflow._tcp local.
```

如果 `dns-sd.exe` 不在 `PATH`，改用 Bonjour 安装目录或桌面端 `resources` 目录里的实际路径。

## 4. 常见残留问题

## 4.1 sidecar 孤儿进程

现象：

- desktop 已退出
- 但本机仍然监听 `39393 / 39394`
- `ppid = 1`

原因：

- 之前本地脚本或源码联调拉起的 sidecar 没被清理

处理：

macOS：

```bash
pkill -f syncflow-sidecar
```

Windows（PowerShell）：

```powershell
Get-Process syncflow-sidecar -ErrorAction SilentlyContinue | Stop-Process -Force
```

## 4.2 假在线 Bonjour 广播

现象：

- desktop 实际没有监听端口
- 但 iPhone 发现页还能看到这台设备

原因：

- 残留 `dns-sd -R` 子进程仍在广播

检查：

macOS：

```bash
pgrep -af 'dns-sd.*_syncflow._tcp'
```

Windows（PowerShell）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" |
  Where-Object { $_.CommandLine -like '*_syncflow._tcp*' } |
  Select-Object ProcessId,ExecutablePath,CommandLine
```

处理：

macOS：

```bash
pkill -f 'dns-sd.*_syncflow._tcp'
```

Windows（PowerShell）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" |
  Where-Object { $_.CommandLine -like '*_syncflow._tcp*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## 4.3 Windows 防火墙 / Bonjour 运行时

现象：

- sidecar 已监听，但 iPhone 扫描不到或能扫到却连不上
- 设置页提示 Bonjour fallback 或共享入口异常

检查：

```powershell
Get-Service -Name "Bonjour Service"
netsh advfirewall firewall show rule name="SyncFlow Sidecar TCP"
netsh advfirewall firewall show rule name="SyncFlow mDNS UDP"
```

处理原则：

1. 先确认 `Bonjour Service` 已安装并处于 `Running`
2. 再确认 `39393/TCP` 和 `5353/UDP` 防火墙规则存在且启用
3. 如果规则缺失，优先重装最新 Windows 安装包，让 NSIS 安装脚本重新写入规则

## 4.4 桌面端和源码 sidecar 冲突

现象：

- 你以为在测 desktop 包
- 实际命中的是本地源码 sidecar

处理原则：

1. 联调前先确认只保留一份 sidecar
2. 优先明确进程路径
3. 不要让源码 sidecar 和打包 sidecar 同时占同一端口

## 5. 本地清理标准动作

联调结束后，建议做一次：

macOS：

```bash
pkill -f syncflow-sidecar || true
pkill -f 'dns-sd.*_syncflow._tcp' || true
```

然后再确认：

macOS：

```bash
lsof -nP -iTCP:39393 -sTCP:LISTEN
lsof -nP -iTCP:39394 -sTCP:LISTEN
```

Windows（PowerShell）：

```powershell
Get-Process syncflow-sidecar -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='dns-sd.exe'" |
  Where-Object { $_.CommandLine -like '*_syncflow._tcp*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-NetTCPConnection -State Listen -LocalPort 39393,39394
```

目标是：

- 无监听
- 无假在线广播

## 6. 与 desktop 诊断包配合

desktop 诊断包足够回答这些问题：

1. sidecar 是否健康
2. 最近是否重启
3. `sidecar.db` 当前状态
4. 共享目录是否配置正确
5. 当前 dashboard 中每台设备是什么状态

所以：

- 如果问题主要在桌面端，优先收 desktop 诊断包
- 如果问题主要在 app 状态机，优先和 mobile 诊断包对照

## 7. 发布前检查

每次发布前，至少确认：

1. 本机没有残留源码 sidecar
2. 只测试本轮目标平台的最新安装包（macOS DMG / Windows NSIS）
3. 端口监听、Bonjour、HTTP API 都正常
4. macOS：`spctl` 和 notarization 都已通过
5. Windows：安装器已写入防火墙规则，Bonjour 运行时路径或 fallback 模式都已验证
