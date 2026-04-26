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
  // Vivi Drop: additional icons
  'albums-outline': 60046,
  'grid-outline': 60468,
  'list-outline': 60623,
  'folder-outline': 60426,
  'document-outline': 60340,
  'play-circle-outline': 60862,
  'pause-circle-outline': 60818,
  'stop-circle-outline': 61093,
  'arrow-down-circle-outline': 60076,
  'sync-outline': 61121,
  'alert-circle-outline': 59925,
  'home-outline': 60514,
  'flash-outline': 60418,
  ellipse: 60370,
  'camera-outline': 60142,
  'film-outline': 60404,
  'funnel-outline': 60432,
  'options-outline': 60798,
  'eye-outline': 60395,
  'eye-off-outline': 60393,
  'share-outline': 61053,
  'chevron-down': 60206,
  'chevron-up': 60228,
  'calendar-outline': 60134,
  'toggle-outline': 61167,
  'checkbox-outline': 60182,
  'square-outline': 61079,
  'cloud-upload-outline': 60262,
  'apps-outline': 60017,
  'menu-outline': 60661,
  'help-circle-outline': 60543,
  'swap-horizontal-outline': 61106,
  'log-out-outline': 60626,
  'information-circle-outline': 60570,
  'language-outline': 60587,
  'book-outline': 60071,
  'mail-outline': 60725,
  'link-outline': 60602,
  'person-outline': 60832,
  'shield-outline': 61059,
  'shield-checkmark-outline': 61057,
  'lock-closed-outline': 60624,
  'card-outline': 60162,
  'star-outline': 61087,
  'trash-outline': 61175,
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
