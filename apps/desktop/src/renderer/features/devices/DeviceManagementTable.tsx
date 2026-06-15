import { ShieldCheck, ShieldX, Unlock } from 'lucide-react';
import type { DesktopManagedDeviceDTO } from '@syncflow/contracts';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table';
import { formatBytes, formatDateTime } from '@renderer/lib/format';

function maskClientId(clientId: string): string {
  if (clientId.length <= 16) return clientId;
  return `${clientId.slice(0, 9)}...${clientId.slice(-6)}`;
}

function authorizationLabel(device: DesktopManagedDeviceDTO): string {
  if (device.blockStatus === 'active') return '已封鎖';
  if (device.authorizationStatus === 'authorized') return '已授權';
  return '已撤銷';
}

function authorizationVariant(
  device: DesktopManagedDeviceDTO,
): 'default' | 'destructive' | 'outline' {
  if (device.blockStatus === 'active') return 'destructive';
  if (device.authorizationStatus === 'authorized') return 'default';
  return 'outline';
}

export function DeviceManagementTable({
  devices,
  onUnblock,
}: {
  devices: DesktopManagedDeviceDTO[];
  onUnblock: (clientId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>設備</TableHead>
          <TableHead>Client ID</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead>今日同步</TableHead>
          <TableHead>最近出現</TableHead>
          <TableHead>最後 IP</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {devices.map((device) => (
          <TableRow key={`${device.desktopDeviceId}:${device.clientId}`}>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{device.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {device.platform}
                  {device.lastIp ? ` · ${device.lastIp}` : ''}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                {maskClientId(device.clientId)}
              </code>
            </TableCell>
            <TableCell>
              <Badge variant={authorizationVariant(device)}>
                {device.blockStatus === 'active' ? (
                  <ShieldX className="h-3 w-3" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                {authorizationLabel(device)}
              </Badge>
            </TableCell>
            <TableCell>
              <span className="text-sm text-foreground">{device.todayFileCount} 個</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {formatBytes(device.todayBytes)}
              </span>
            </TableCell>
            <TableCell>{formatDateTime(device.lastSeenAt)}</TableCell>
            <TableCell>{device.lastIp ?? '無紀錄'}</TableCell>
            <TableCell className="text-right">
              {device.blockStatus === 'active' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`解除封鎖 ${device.displayName}`}
                  onClick={() => onUnblock(device.clientId)}
                >
                  <Unlock className="h-4 w-4" />
                  解除封鎖
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">不需操作</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
