import { Platform, type TextProps, type ViewStyle } from 'react-native';

type PlatformName = typeof Platform.OS | 'ios' | 'android';

export type AuthTextScalingProps = Pick<
  TextProps,
  'allowFontScaling' | 'maxFontSizeMultiplier'
>;

export function getAuthTextScalingProps(
  platform: PlatformName = Platform.OS,
): AuthTextScalingProps {
  if (platform === 'android') {
    return {
      allowFontScaling: false,
      maxFontSizeMultiplier: 1,
    };
  }

  return {
    maxFontSizeMultiplier: 1.15,
  };
}

export function getAuthCardSurfaceStyle(
  platform: PlatformName = Platform.OS,
): Pick<ViewStyle, 'elevation'> {
  if (platform === 'android') {
    return { elevation: 4 };
  }

  return {};
}

export const authTextScalingProps = getAuthTextScalingProps();
export const authCardSurfaceStyle = getAuthCardSurfaceStyle();
