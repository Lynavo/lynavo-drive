import { Platform, type ViewStyle } from 'react-native';

type AndroidBoxShadowOptions = {
  offsetX?: number;
  offsetY: number;
  blurRadius: number;
  color: string;
};

export function androidBoxShadow({
  offsetX = 0,
  offsetY,
  blurRadius,
  color,
}: AndroidBoxShadowOptions): ViewStyle {
  if (Platform.OS !== 'android') {
    return {};
  }

  return {
    elevation: 0,
    boxShadow: `${offsetX}px ${offsetY}px ${blurRadius}px ${color}`,
  };
}
