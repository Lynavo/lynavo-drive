import { ConnectionCodeSection } from './ConnectionCodeSection';
import { DeviceNameSection } from './DeviceNameSection';
import { FilePathSection } from './FilePathSection';
import { ShareAddressSection } from './ShareAddressSection';
import { SystemGuideSection } from './SystemGuideSection';

export function SettingsPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-8 text-xl font-semibold text-foreground">设置</h1>

        {/* Device Name */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            设备名称
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            此名称将在局域网中广播，方便手机识别本台电脑
          </p>
          <DeviceNameSection />
        </section>

        {/* Connection Code */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            连接码管理
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            所有设备通过此连接码与电脑配对
          </p>
          <ConnectionCodeSection />
        </section>

        {/* File Path Config */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            文件地址配置
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            配置文件接收路径和共享设置
          </p>
          <FilePathSection />
          <div className="mt-4">
            <ShareAddressSection />
          </div>
        </section>

        {/* System Guide */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            系统权限指引
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            局域网共享需要开启系统文件共享权限
          </p>
          <SystemGuideSection />
        </section>
      </div>
    </div>
  );
}
