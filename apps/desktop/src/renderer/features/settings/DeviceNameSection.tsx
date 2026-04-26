import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@renderer/components/ui/input';
import { Button } from '@renderer/components/ui/button';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

export function DeviceNameSection() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const isAnyDeviceTransferring = useDashboardStore((s) =>
    s.devices.some((d) => d.status === 'transferring'),
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currentName = settings.deviceName;
  const displayValue = draft ?? currentName;
  const isDirty = draft !== null && draft !== currentName;
  const isLocked = isAnyDeviceTransferring;

  // Race guard: if a transfer kicks off mid-edit, drop the draft so the
  // locked input cannot be submitted with stale text once it unlocks.
  useEffect(() => {
    if (isLocked && draft !== null) {
      setDraft(null);
    }
  }, [isLocked, draft]);

  const handleSave = useCallback(async () => {
    if (!isDirty || draft === null) return;
    setSaving(true);
    try {
      const updated = await window.electronAPI.sidecar.updateSettings({
        deviceName: draft,
      });
      updateSettings({ ...settings, ...updated });
      setDraft(null);
    } catch {
      toast.error('保存设备名称失败');
    } finally {
      setSaving(false);
    }
  }, [draft, isDirty, settings, updateSettings]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <label className="mb-2 block text-xs font-medium text-muted-foreground">
        设备名称
      </label>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1"
          data-testid="device-name-input"
          disabled={isLocked}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || saving || isLocked}
          data-testid="device-name-save"
        >
          <Save className="h-4 w-4" />
          保存
        </Button>
      </div>
      {isLocked ? (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="device-name-locked-hint"
        >
          传输进行中，暂不可修改设备名称
        </p>
      ) : null}
    </div>
  );
}
