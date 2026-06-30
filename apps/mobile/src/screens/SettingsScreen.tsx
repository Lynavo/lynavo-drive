import React from 'react';
import { SettingsGlobalScreen } from './SettingsGlobalScreen';

export function SettingsScreen({
  showBottomTabBar = true,
}: {
  showBottomTabBar?: boolean;
}) {
  return <SettingsGlobalScreen showBottomTabBar={showBottomTabBar} />;
}
