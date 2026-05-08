import React, { useMemo, useState } from 'react';
import {
  Dimensions,
  type LayoutChangeEvent,
  Modal,
  Platform,
  StyleSheet,
  StatusBar,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Path, Rect } from 'react-native-svg';
import { Icon } from '../Icon';

interface SyncActivityTourProps {
  visible: boolean;
  onSkip: () => void;
  onFinish: () => void;
  targetLayouts?: Partial<Record<TourTarget, TourTargetLayout>>;
}

export type TourTarget = 'album' | 'panel' | 'history' | 'settings' | 'help';

export interface TourTargetLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function isValidTourTargetLayout(
  layout: TourTargetLayout | undefined,
): layout is TourTargetLayout {
  return (
    !!layout &&
    Number.isFinite(layout.left) &&
    Number.isFinite(layout.top) &&
    Number.isFinite(layout.width) &&
    Number.isFinite(layout.height) &&
    layout.width > 0 &&
    layout.height > 0
  );
}

interface TourViewportSize {
  width: number;
  height: number;
}

function isValidViewportSize(
  size: TourViewportSize | null,
): size is TourViewportSize {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

function firstPositiveDimension(...values: number[]): number {
  return values.find(value => Number.isFinite(value) && value > 0) ?? 0;
}

interface TourStep {
  icon: string;
  title: string;
  body: string;
  target: TourTarget;
}

interface TourLayout {
  target: ViewStyle & TourTargetLayout;
  card: ViewStyle;
  connector: ViewStyle;
}

interface TargetRatioRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DIM_COLOR = 'rgba(13,22,30,0.72)';
const SIDE_PADDING = 16;
const COACH_CARD_ESTIMATED_HEIGHT = 168;
const HIGHLIGHT_STROKE_WIDTH = 1;
const HIGHLIGHT_STROKE_GAP = 1;

const TARGET_PADDING: Record<TourTarget, number> = {
  album: 12,
  panel: 12,
  history: 10,
  settings: 10,
  help: 10,
};

const TARGET_RATIO_RECTS: Record<TourTarget, TargetRatioRect> = {
  album: {
    left: 0.05,
    top: 0.535,
    width: 0.44,
    height: 0.137,
  },
  panel: {
    left: 0.036,
    top: 0.133,
    width: 0.928,
    height: 0.45,
  },
  history: {
    left: 0.677,
    top: 0.085,
    width: 0.185,
    height: 0.085,
  },
  settings: {
    left: 0.805,
    top: 0.085,
    width: 0.185,
    height: 0.085,
  },
  help: {
    left: 0.549,
    top: 0.085,
    width: 0.185,
    height: 0.085,
  },
};

function applyTargetPadding(
  rect: TourTargetLayout,
  target: TourTarget,
  screenWidth: number,
  screenHeight: number,
): TourTargetLayout {
  const padding = TARGET_PADDING[target];
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(screenWidth, rect.left + rect.width + padding);
  const bottom = Math.min(screenHeight, rect.top + rect.height + padding);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function getTargetRect(
  target: TourTarget,
  screenWidth: number,
  screenHeight: number,
  measuredLayouts?: Partial<Record<TourTarget, TourTargetLayout>>,
  measuredTargetTopOffset = 0,
): TourLayout['target'] {
  const measured = measuredLayouts?.[target];
  if (isValidTourTargetLayout(measured)) {
    return applyTargetPadding(
      {
        ...measured,
        top: measured.top + measuredTargetTopOffset,
      },
      target,
      screenWidth,
      screenHeight,
    );
  }

  const ratio = TARGET_RATIO_RECTS[target];
  return applyTargetPadding(
    {
      left: screenWidth * ratio.left,
      top: screenHeight * ratio.top,
      width: screenWidth * ratio.width,
      height: screenHeight * ratio.height,
    },
    target,
    screenWidth,
    screenHeight,
  );
}

function getTourLayout(
  target: TourTarget,
  screenWidth: number,
  screenHeight: number,
  measuredLayouts?: Partial<Record<TourTarget, TourTargetLayout>>,
  measuredTargetTopOffset = 0,
): TourLayout {
  const targetRect = getTargetRect(
    target,
    screenWidth,
    screenHeight,
    measuredLayouts,
    measuredTargetTopOffset,
  );

  if (target === 'album') {
    const cardTop = Math.max(210, targetRect.top - 282);

    return {
      target: targetRect,
      card: {
        left: SIDE_PADDING,
        right: SIDE_PADDING,
        top: cardTop,
      },
      connector: {
        left: targetRect.left + targetRect.width / 2,
        top: targetRect.top - 32,
        height: 32,
      },
    };
  }

  if (target === 'panel') {
    const cardTop = Math.min(
      targetRect.top + targetRect.height + 28,
      screenHeight - COACH_CARD_ESTIMATED_HEIGHT - 30,
    );

    return {
      target: targetRect,
      card: {
        left: SIDE_PADDING,
        right: SIDE_PADDING,
        top: cardTop,
      },
      connector: {
        left: screenWidth / 2,
        top: targetRect.top + targetRect.height,
        height: Math.max(18, cardTop - (targetRect.top + targetRect.height)),
      },
    };
  }

  const cardTop = targetRect.top + targetRect.height + 34;

  return {
    target: targetRect,
    card: {
      left: SIDE_PADDING,
      right: SIDE_PADDING,
      top: cardTop,
    },
    connector: {
      left: targetRect.left + targetRect.width / 2,
      top: targetRect.top + targetRect.height,
      height: cardTop - (targetRect.top + targetRect.height),
    },
  };
}

function getHighlightRadius(target: TourTarget): number {
  switch (target) {
    case 'panel':
      return 26;
    case 'history':
    case 'settings':
    case 'help':
      return 20;
    case 'album':
    default:
      return 18;
  }
}

function getHighlightStrokeColor(target: TourTarget): string {
  if (target === 'panel') {
    return 'rgba(217,240,255,0.95)';
  }

  return 'rgba(222,244,255,0.92)';
}

function getRoundedRectPath(rect: TourTargetLayout, radius: number): string {
  const x = rect.left;
  const y = rect.top;
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  const r = Math.min(radius, width / 2, height / 2);
  const right = x + width;
  const bottom = y + height;

  return [
    `M${x + r} ${y}`,
    `H${right - r}`,
    `Q${right} ${y} ${right} ${y + r}`,
    `V${bottom - r}`,
    `Q${right} ${bottom} ${right - r} ${bottom}`,
    `H${x + r}`,
    `Q${x} ${bottom} ${x} ${bottom - r}`,
    `V${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

function getCutoutOverlayPath(
  screenWidth: number,
  screenHeight: number,
  targetRect: TourTargetLayout,
  radius: number,
): string {
  return [
    `M0 0 H${screenWidth} V${screenHeight} H0 Z`,
    getRoundedRectPath(targetRect, radius),
  ].join(' ');
}

export function SyncActivityTour({
  visible,
  onSkip,
  onFinish,
  targetLayouts,
}: SyncActivityTourProps) {
  const { t } = useTranslation();
  const windowDimensions = useWindowDimensions();
  const fallbackWindowDimensions = Dimensions.get('window');
  const fallbackScreenDimensions = Dimensions.get('screen');
  const [overlaySize, setOverlaySize] = useState<TourViewportSize | null>(null);
  const viewportWidth = isValidViewportSize(overlaySize)
    ? overlaySize.width
    : firstPositiveDimension(
        windowDimensions.width,
        fallbackWindowDimensions.width,
        fallbackScreenDimensions.width,
      );
  const viewportHeight = isValidViewportSize(overlaySize)
    ? overlaySize.height
    : Platform.OS === 'android'
    ? firstPositiveDimension(
        fallbackScreenDimensions.height,
        windowDimensions.height,
        fallbackWindowDimensions.height,
      )
    : firstPositiveDimension(
        windowDimensions.height,
        fallbackWindowDimensions.height,
        fallbackScreenDimensions.height,
      );
  const measuredTargetTopOffset =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  const [stepIndex, setStepIndex] = useState(0);
  const steps: TourStep[] = useMemo(
    () => [
      {
        icon: 'image-outline',
        title: t('syncActivity.onboarding.manual.title'),
        body: t('syncActivity.onboarding.manual.body'),
        target: 'album',
      },
      {
        icon: 'flash-outline',
        title: t('syncActivity.onboarding.panel.title'),
        body: t('syncActivity.onboarding.panel.body'),
        target: 'panel',
      },
      {
        icon: 'scan-outline',
        title: t('syncActivity.onboarding.history.title'),
        body: t('syncActivity.onboarding.history.body'),
        target: 'history',
      },
      {
        icon: 'settings-outline',
        title: t('syncActivity.onboarding.settings.title'),
        body: t('syncActivity.onboarding.settings.body'),
        target: 'settings',
      },
      {
        icon: 'help-circle-outline',
        title: t('syncActivity.onboarding.help.title'),
        body: t('syncActivity.onboarding.help.body'),
        target: 'help',
      },
    ],
    [t],
  );
  const current = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const layout = getTourLayout(
    current.target,
    viewportWidth,
    viewportHeight,
    targetLayouts,
    measuredTargetTopOffset,
  );
  const handleOverlayLayout = (event: LayoutChangeEvent) => {
    const next: TourViewportSize = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };

    if (!isValidViewportSize(next)) return;

    setOverlaySize(currentSize => {
      if (
        currentSize &&
        Math.abs(currentSize.width - next.width) < 0.5 &&
        Math.abs(currentSize.height - next.height) < 0.5
      ) {
        return currentSize;
      }

      return next;
    });
  };
  const highlightRadius = getHighlightRadius(current.target);
  const highlightStrokeOffset =
    HIGHLIGHT_STROKE_GAP + HIGHLIGHT_STROKE_WIDTH / 2;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={styles.overlay}
        testID="sync-activity-tour"
        onLayout={handleOverlayLayout}
      >
        <Svg
          key={`${viewportWidth}:${viewportHeight}:${current.target}`}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={viewportWidth}
          height={viewportHeight}
        >
          <Path
            testID="sync-activity-tour-cutout-overlay"
            d={getCutoutOverlayPath(
              viewportWidth,
              viewportHeight,
              layout.target,
              highlightRadius,
            )}
            fill={DIM_COLOR}
            fillRule="evenodd"
          />
          <Rect
            testID="sync-activity-tour-highlight"
            x={layout.target.left - highlightStrokeOffset}
            y={layout.target.top - highlightStrokeOffset}
            width={layout.target.width + highlightStrokeOffset * 2}
            height={layout.target.height + highlightStrokeOffset * 2}
            rx={highlightRadius + highlightStrokeOffset}
            ry={highlightRadius + highlightStrokeOffset}
            fill="none"
            stroke={getHighlightStrokeColor(current.target)}
            strokeWidth={HIGHLIGHT_STROKE_WIDTH}
          />
        </Svg>

        <View
          pointerEvents="none"
          style={[styles.connector, layout.connector]}
        />

        <View style={[styles.card, layout.card]}>
          <View style={styles.headingRow}>
            <View style={styles.iconCircle}>
              <Icon name={current.icon} size={20} color="#ffffff" />
            </View>
            <View style={styles.headingCopy}>
              <Text style={styles.title}>{current.title}</Text>
              <View style={styles.stepDots} accessibilityElementsHidden>
                {steps.map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.stepDot,
                      index === stepIndex && styles.stepDotActive,
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>
          <Text style={styles.body}>{current.body}</Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.textButton}
              activeOpacity={0.7}
              onPress={onSkip}
            >
              <Text style={styles.skipText}>
                {t('syncActivity.onboarding.skip')}
              </Text>
            </TouchableOpacity>

            <View style={styles.actionButtons}>
              {stepIndex > 0 && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.7}
                  onPress={() => setStepIndex(index => Math.max(0, index - 1))}
                >
                  <Text style={styles.secondaryText}>
                    {t('syncActivity.onboarding.previous')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.7}
                onPress={() => {
                  if (isLast) {
                    onFinish();
                    return;
                  }
                  setStepIndex(index => Math.min(steps.length - 1, index + 1));
                }}
              >
                <Text style={styles.primaryText}>
                  {isLast
                    ? t('syncActivity.onboarding.startJourney')
                    : t('syncActivity.onboarding.next', {
                        step: stepIndex + 1,
                        total: steps.length,
                      })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  connector: {
    position: 'absolute',
    width: 1,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.42)',
  },
  card: {
    position: 'absolute',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    elevation: 10,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  stepDots: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  stepDotActive: {
    width: 20,
    backgroundColor: '#ffffff',
  },
  body: {
    minHeight: 58,
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.82)',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  textButton: {
    minHeight: 40,
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  secondaryButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
  },
  primaryButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  primaryText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1a3a5c',
  },
});
