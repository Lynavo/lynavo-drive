import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

type SyncPerformanceHintProps = {
  uploadState: string;
  performanceHint?: string;
  performanceMessage?: string | null;
};

const ACTIVE_UPLOAD_STATES = new Set([
  'preparing',
  'uploading',
  'reconnecting',
]);

export function getSyncPerformanceHintMessage(
  props: SyncPerformanceHintProps,
  t: TFunction,
): string | null {
  const { uploadState, performanceHint, performanceMessage } = props;
  if (
    !ACTIVE_UPLOAD_STATES.has(uploadState) ||
    performanceHint !== 'thermal_limited'
  ) {
    return null;
  }

  const trimmedMessage = performanceMessage?.trim();
  return trimmedMessage && trimmedMessage.length > 0
    ? trimmedMessage
    : t('syncActivity.performance.thermalThrottled');
}

export function SyncPerformanceHint(props: SyncPerformanceHintProps) {
  const { t } = useTranslation();
  const message = getSyncPerformanceHintMessage(props, t);
  if (!message) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,243,199,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.16)',
  },
  label: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: '#9a3412',
  },
});
