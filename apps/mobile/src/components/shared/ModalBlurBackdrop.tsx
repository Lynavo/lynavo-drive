import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  NativeModalBlurView,
  type NativeModalBlurStyle,
} from './NativeModalBlurView';

interface ModalBlurBackdropProps {
  blurStyle?: NativeModalBlurStyle;
  fallbackColor?: string;
  intensity?: number;
  overlayColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function ModalBlurBackdrop({
  blurStyle = 'systemUltraThinMaterial',
  fallbackColor = 'transparent',
  intensity = 0.08,
  overlayColor = 'rgba(23,25,28,0.22)',
  style,
}: ModalBlurBackdropProps) {
  return (
    <View pointerEvents="none" style={[styles.root, style]}>
      <NativeModalBlurView
        blurStyle={blurStyle}
        fallbackColor={fallbackColor}
        intensity={intensity}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={[styles.overlay, { backgroundColor: overlayColor }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
