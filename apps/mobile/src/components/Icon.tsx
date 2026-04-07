import React from 'react';
import { Text, type TextStyle } from 'react-native';

// Ionicons glyph map (only the icons we use)
const ionicons: Record<string, number> = {
  'chevron-back': 60202,
  'chevron-forward': 60220,
  wifi: 61234,
  'radio-outline': 60935,
  refresh: 60949,
  'desktop-outline': 60320,
  'phone-portrait-outline': 60854,
  'settings-outline': 61037,
  'time-outline': 61151,
  'pencil-outline': 60830,
  checkmark: 60190,
  'checkmark-circle': 60191,
  close: 60235,
  'cloud-outline': 60254,
  'create-outline': 60308,
  'download-outline': 60347,
  'refresh-outline': 60953,
  'scan-outline': 61019,
  'videocam-outline': 61202,
  'image-outline': 60560,
};

interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

/**
 * Lightweight icon component using Ionicons font glyphs directly.
 * No native module dependency — renders as <Text> with the Ionicons font.
 */
export function Icon({ name, size = 20, color = '#fff' }: IconProps) {
  const glyph = ionicons[name];
  if (glyph == null) return null;

  const style: TextStyle = {
    fontFamily: 'Ionicons',
    fontSize: size,
    color,
    // Prevent text layout issues
    lineHeight: size + 2,
    textAlign: 'center',
    width: size + 2,
  };

  return (
    <Text style={style} allowFontScaling={false}>
      {String.fromCharCode(glyph)}
    </Text>
  );
}
