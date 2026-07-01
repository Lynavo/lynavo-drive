import React from 'react';
import { Text, type TextStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

// Ionicons glyph map (only the icons we use)
const ionicons: Record<string, number> = {
  'chevron-back': 60202,
  'chevron-forward': 60220,
  'arrow-back': 59944,
  'arrow-up': 59974,
  wifi: 61234,
  'radio-outline': 60935,
  refresh: 60949,
  'desktop-outline': 60320,
  'laptop-outline': 60590,
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
  'cloud-download-outline': 60249,
  'cloud-offline-outline': 60252,
  'refresh-outline': 60953,
  'search-outline': 61028,
  'scan-outline': 61019,
  'videocam-outline': 61202,
  'image-outline': 60560,
  // Lynavo Drive: additional icons
  'albums-outline': 60046,
  'grid-outline': 60468,
  'list-outline': 60623,
  'folder-outline': 60426,
  folder: 60454,
  'folder-open-outline': 60456,
  'document-outline': 60340,
  'document-text': 60340,
  image: 60559,
  play: 60871,
  'play-circle-outline': 60862,
  'pause-circle-outline': 60818,
  'stop-circle-outline': 61093,
  'arrow-down-circle-outline': 60076,
  'sync-outline': 61121,
  'alert-circle-outline': 59925,
  'alert-circle': 59924,
  'home-outline': 60514,
  'flash-outline': 60443,
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
  'sync-circle-outline': 61113,
  'apps-outline': 60017,
  'images-outline': 60563,
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
  'gift-outline': 60473,
  'star-outline': 61087,
  'cube-outline': 60314,
  'globe-outline': 60497,
  'pulse-outline': 60920,
  'trash-outline': 61175,
  'add-circle-outline': 59910,
};

interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

const customSvgIcons = new Set([
  'crown-outline',
  'message-square-outline',
  'auto-upload-image',
  'auto-upload-file',
  'auto-upload-folder',
  'auto-upload-clock',
  'auto-upload-calendar',
]);

/**
 * Lightweight icon component using Ionicons font glyphs directly, with small
 * SVG fallbacks for reference-only icons that are missing from the font map.
 */
export function Icon({ name, size = 20, color = '#fff' }: IconProps) {
  if (customSvgIcons.has(name)) {
    return <CustomSvgIcon name={name} size={size} color={color} />;
  }

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

function CustomSvgIcon({ name, size, color }: Required<IconProps>) {
  const strokeProps = {
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg
      testID={`icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      {name === 'crown-outline' ? (
        <>
          <Path d="M3 6l4.5 6L12 4l4.5 8L21 6l-2 12H5L3 6z" {...strokeProps} />
          <Path d="M7 20h10" {...strokeProps} />
        </>
      ) : name === 'message-square-outline' ? (
        <Path
          d="M7 4h10a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H9l-5 3V8a4 4 0 0 1 3-4z"
          {...strokeProps}
        />
      ) : name === 'auto-upload-image' ? (
        <>
          <Path
            d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
            {...strokeProps}
          />
          <Circle cx="8.5" cy="9.5" r="1.25" {...strokeProps} />
          <Path d="M21 15l-4.5-4.5L7 19" {...strokeProps} />
        </>
      ) : name === 'auto-upload-file' ? (
        <>
          <Path
            d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
            {...strokeProps}
          />
          <Path d="M14 3v5h5" {...strokeProps} />
        </>
      ) : name === 'auto-upload-folder' ? (
        <Path
          d="M4 6.5h6l2 2H20a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2z"
          {...strokeProps}
        />
      ) : name === 'auto-upload-clock' ? (
        <>
          <Circle cx="12" cy="12" r="9" {...strokeProps} />
          <Path d="M12 7v5l3 2" {...strokeProps} />
        </>
      ) : (
        <>
          <Path d="M7 3v4" {...strokeProps} />
          <Path d="M17 3v4" {...strokeProps} />
          <Path d="M4 10h16" {...strokeProps} />
          <Path
            d="M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
            {...strokeProps}
          />
        </>
      )}
    </Svg>
  );
}
