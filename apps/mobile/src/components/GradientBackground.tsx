import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface GradientBackgroundProps {
  children: React.ReactNode;
}

export function GradientBackground({ children }: GradientBackgroundProps) {
  return (
    <View style={styles.container}>
      <Svg style={StyleSheet.absoluteFillObject}>
        <Defs>
          <LinearGradient
            id="globalPageGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <Stop offset="0%" stopColor="#FFFCF7" stopOpacity={0.98} />
            <Stop offset="38%" stopColor="#F7FCFF" stopOpacity={0.94} />
            <Stop offset="68%" stopColor="#EFF8FF" stopOpacity={0.92} />
            <Stop offset="100%" stopColor="#FFF8DC" stopOpacity={0.62} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#globalPageGradient)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
