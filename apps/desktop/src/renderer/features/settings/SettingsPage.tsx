import { BonjourRuntimeSection } from './BonjourRuntimeSection';
import { ConnectionCodeSection } from './ConnectionCodeSection';
import { DeviceNameSection } from './DeviceNameSection';
import { SupportSection } from './SupportSection';

export function SettingsPage() {
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-8 text-xl font-semibold text-foreground">设置</h1>

        {/* Device Name */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">设备名称</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            此名称将在局域网中广播，方便手机识别本台电脑
          </p>
          <DeviceNameSection />
        </section>

        {/* Connection Code */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">连接码管理</h2>
          <p className="mb-4 text-xs text-muted-foreground">所有设备通过此连接码与电脑配对</p>
          <ConnectionCodeSection />
        </section>

        {isWindows && (
          <section className="mb-8">
            <h2 className="mb-1 text-sm font-semibold text-foreground">Windows Bonjour 广播</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              iPhone 重新扫描主要依赖 Bonjour/mDNS。
            </p>
            <BonjourRuntimeSection />
          </section>
        )}

        <section className="mt-8">
          <SupportSection />
        </section>
      </div>
    </div>
  );
}
