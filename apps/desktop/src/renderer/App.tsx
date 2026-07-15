import { AppShell } from '@renderer/features/layout/AppShell';
import { Toaster } from '@renderer/components/ui/sonner';

export function App() {
  return (
    <>
      <AppShell />
      <Toaster position="top-right" />
    </>
  );
}
