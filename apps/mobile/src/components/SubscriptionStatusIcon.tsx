import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ViewStyle,
} from 'react-native';
import type { SubscriptionDisplayKind } from '../utils/subscriptionStatusDisplay';

export type SubscriptionStatusIconTone = 'trial' | 'expired' | 'subscribed';

const SUBSCRIPTION_STATUS_ICON_SOURCES: Record<
  SubscriptionStatusIconTone,
  ImageSourcePropType
> = {
  trial: require('../assets/icons/subscription-trial.png'),
  expired: require('../assets/icons/subscription-expired.png'),
  subscribed: require('../assets/icons/subscription-subscribed.png'),
};

export const SUBSCRIPTION_STATUS_ICON_COLORS: Record<
  SubscriptionStatusIconTone,
  string
> = {
  trial: '#d97706',
  expired: '#ef4444',
  subscribed: '#16a34a',
};

export const SUBSCRIPTION_STATUS_ICON_BACKGROUNDS: Record<
  SubscriptionStatusIconTone,
  string
> = {
  trial: 'rgba(217, 119, 6, 0.1)',
  expired: 'rgba(239, 68, 68, 0.1)',
  subscribed: 'rgba(22, 163, 74, 0.1)',
};

export function getSubscriptionStatusIconTone(
  kind: SubscriptionDisplayKind,
): SubscriptionStatusIconTone | null {
  switch (kind) {
    case 'account_trial':
    case 'subscription_intro_trial':
      return 'trial';
    case 'trial_expired':
    case 'sub_expired':
      return 'expired';
    case 'subscribed':
    case 'subscribed_cancelled':
      return 'subscribed';
    default:
      return null;
  }
}

export function SubscriptionStatusIcon({
  tone,
  size = 24,
  framed = false,
  frameSize = 32,
  style,
}: {
  tone: SubscriptionStatusIconTone;
  size?: number;
  framed?: boolean;
  frameSize?: number;
  style?: ViewStyle;
}) {
  const crown = (
    <Image
      source={SUBSCRIPTION_STATUS_ICON_SOURCES[tone]}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );

  if (!framed) {
    return crown;
  }

  return (
    <View
      style={[
        styles.frame,
        {
          width: frameSize,
          height: frameSize,
          borderRadius: frameSize / 2,
          backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS[tone],
        },
        style,
      ]}
    >
      {crown}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
