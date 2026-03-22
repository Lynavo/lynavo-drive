import { useCallback, useState } from 'react';
import { Save } from 'lucide-react';
import { Input } from '@renderer/components/ui/input';
import { Button } from '@renderer/components/ui/button';
import { useSettingsStore } from '@renderer/stores/settings-store';

export function DeviceNameSection() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currentName = settings.deviceName;
  const displayValue = draft ?? currentName;
  const isDirty = draft !== null && draft !== currentName;

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
      // Phase 1: silent fail; toast can be added later
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
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || saving}
          data-testid="device-name-save"
        >
          <Save className="h-4 w-4" />
          保存
        </Button>
      </div>
    </div>
  );
}
