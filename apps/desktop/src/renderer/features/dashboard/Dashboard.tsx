import { useState, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Smartphone,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { formatBytes } from '@renderer/lib/format';
import { Button } from '@renderer/components/ui/button';

export function Dashboard() {
  const settings = useSettingsStore((s) => s.settings);
  const summary = useDashboardStore((s) => s.summary);
  const fetchDashboard = useDashboardStore((s) => s.fetchDashboard);

  const [masked, setMasked] = useState(true);
  const [qrVisible, setQrVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.files.copyToClipboard(settings.connectionCode || '000000');
      setCopied(true);
      toast.success('连接码已复制');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };



  // macOS folder permission state (null = unknown / not mac)
  const [folderPermissionGranted, setFolderPermissionGranted] = useState<boolean | null>(null);

  // Load stats on mount
  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Subscribe to transfer active state
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    void api.sidecar.getTransferActive().then(
      (r) => setTransferActive(r.active),
      () => {},
    );

    const unsub = api.events.onSidecarEvent((event) => {
      if (event.type === 'transfer.active.changed') {
        setTransferActive((event.payload as { isActive: boolean }).isActive);
      }
    });
    return unsub;
  }, []);

  // Check macOS Files & Folders permission on mount
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    if (!api.platform.isMac()) {
      setFolderPermissionGranted(null); // not applicable on non-mac
      return;
    }
    void api.files.checkFolderPermission().then((r) => {
      setFolderPermissionGranted(r.granted);
    });
  }, []);

  const toggleRemoteAccess = async () => {
    const next = !settings.remoteAccessEnabled;
    try {
      const updated = await window.electronAPI?.sidecar.updateSettings({
        remoteAccessEnabled: next,
      });
      if (updated) {
        useSettingsStore.getState().updateSettings(updated);
        toast.success(next ? '远端访问已开启' : '远端访问已关闭');
      }
    } catch (err) {
      console.error('Failed to toggle remote access:', err);
      toast.error('修改远端访问状态失败');
    }
  };

  const handleRequestFolderPermission = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const result = await api.files.requestFolderPermission();
      setFolderPermissionGranted(result.granted);
      if (result.granted) {
        toast.success('文件夹访问权限已授权');
      } else {
        toast.error('未获得文件夹权限，请在系统设置中手动授权');
        // Open macOS Privacy & Security settings
        void api.files.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
        );
      }
    } catch {
      toast.error('权限请求失败');
    }
  };

  const handleDoubleClickCode = async () => {
    if (masked) {
      toast.error('请先显示连接码再双击修改');
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    try {
      const result = await api.sidecar.regenerateConnectionCode();
      useSettingsStore.getState().updateSettings({
        ...settings,
        connectionCode: result.code,
      });
      toast.success('连接码已重新生成！旧配对设备已失效');
    } catch (err) {
      console.error('Failed to regenerate code:', err);
      toast.error('重新生成连接码失败');
    }
  };

  const handleSelectFolder = async () => {
    if (transferActive) {
      toast.error('正在传输文件中，无法修改接收目录');
      return;
    }
    try {
      const selected = await window.electronAPI?.files.selectFolder();
      if (selected && selected !== settings.rootPath) {
        setSaving(true);
        const updated = await window.electronAPI?.sidecar.updateSettings({
          rootPath: selected,
        });
        if (updated) {
          useSettingsStore.getState().updateSettings(updated);
          void useSettingsStore.getState().refreshShareStatus(true);
          toast.success('接收目录修改成功');
        }
      }
    } catch {
      toast.error('储存接收目录失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadApp = () => {
    window.dispatchEvent(new Event('vividrop:open-download'));
  };

  const connectionCode = settings.connectionCode || '000000';
  const localDeviceName = settings.deviceName || 'ViviDrop';
  const localIp =
    window.electronAPI?.platform?.getLocalIPs?.()[0] || '127.0.0.1';
  const connectionQrPayload = `vividrop://connect?ip=${encodeURIComponent(
    localIp,
  )}&device=${encodeURIComponent(localDeviceName)}&code=${connectionCode.replace(
    /\s/g,
    '',
  )}`;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
              共享管理
            </h1>
          </div>
        </header>

        <div className="mx-auto max-w-[980px] space-y-5">
          {/* Card 1: Connection Code */}
          <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <div className="mb-4 flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf6ff] text-[#1677d2] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-[#17191c]">连接码</h2>
              </div>
            </div>

            <div className="rounded-lg border border-white/70 bg-white/56 p-5 shadow-[0_10px_30px_rgba(90,120,170,0.08)]">
              <div className="relative">
                <div
                  onDoubleClick={handleDoubleClickCode}
                  className={`min-w-0 select-none flex flex-col items-center px-12 text-center ${
                    !masked ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  title={!masked ? '双击重新生成连接码' : '显示连接码后可双击修改'}
                >
                  <p className="whitespace-nowrap font-mono text-3xl font-semibold tracking-[0.06em] text-[#17191c] [font-variant-numeric:tabular-nums]">
                    {masked ? '••••••' : connectionCode}
                  </p>
                  <p className="mt-1.5 text-xs text-[#9aa2ad]">
                    {!masked ? '双击修改连接码' : '显示连接码后可双击修改'}
                  </p>
                </div>

                <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMasked(!masked)}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]"
                    aria-label={masked ? '显示连接码' : '隐藏连接码'}
                    title={masked ? '显示连接码' : '隐藏连接码'}
                  >
                    {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]"
                    aria-label="复制"
                    title="复制"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-[#2d8f54]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrVisible((visible) => !visible)}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]"
                    aria-label={qrVisible ? '收起连接二维码' : '显示连接二维码'}
                    title={qrVisible ? '收起连接二维码' : '显示连接二维码'}
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition ${qrVisible ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {qrVisible && (
                <div className="mt-5 rounded-lg border border-white/70 bg-white/68 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
                  <div className="mx-auto flex h-[152px] w-[152px] items-center justify-center rounded-lg bg-white p-2 shadow-[0_12px_28px_rgba(70,96,138,0.12)]">
                    <QRCodeSVG
                      value={connectionQrPayload}
                      size={132}
                      bgColor="#ffffff"
                      fgColor="#17191c"
                      level="M"
                      marginSize={1}
                      title="ViviDrop 连接二维码"
                    />
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-[#7b8490]">手机扫码配对该电脑</p>
                </div>
              )}
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-xs leading-5 text-[#7b8490]">
              <Smartphone className="h-3.5 w-3.5 shrink-0 text-[#9aa3af]" />
              <span>
                <button
                  type="button"
                  onClick={handleDownloadApp}
                  className="font-semibold text-[#1677d2] underline-offset-2 transition hover:text-[#0d68bd] hover:underline"
                >
                  下载 App
                </button>
                ，在同一 Wi-Fi 下扫描，选择该设备，扫码或输入连接码连接设备
              </span>
            </p>
          </section>

          <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e9f8ee] text-[#2d8f54] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[#17191c]">远程访问</h2>
                  <p className="mt-1 text-xs text-[#7b8490]">开启后手机可远程访问此电脑的文件</p>
                </div>
              </div>

              <button
                type="button"
                onClick={toggleRemoteAccess}
                aria-label="远程访问开关"
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  settings.remoteAccessEnabled ? 'bg-[#17191c]' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    settings.remoteAccessEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* macOS Files & Folders permission banner */}
            {folderPermissionGranted === false && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200/80 bg-amber-50/70 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-xs text-amber-700">尚未获得文件夹访问权限，手机将无法浏览此电脑的文件</p>
                </div>
                <button
                  id="btn-request-folder-permission"
                  type="button"
                  onClick={handleRequestFolderPermission}
                  className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 active:scale-[0.97]"
                >
                  授权访问
                </button>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e8fbff] text-[#0d8bbf] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[#17191c]">接收目录</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#7b8490]">
                    <span className="truncate">{settings.receivePath || '默认自动创建'}</span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#e6f7f1] px-2 py-0.5 font-semibold text-[#1e7d5f]">
                      <HardDrive className="h-3.5 w-3.5 shrink-0" />
                      剩余 {formatBytes(summary.remainingBytes)}
                    </span>
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleSelectFolder}
                disabled={saving}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#1677d2] px-3 text-xs font-semibold text-white shadow-[0_12px_22px_rgba(22,119,210,0.18)] transition hover:bg-[#0d68bd] active:scale-[0.98]"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                修改目录
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
