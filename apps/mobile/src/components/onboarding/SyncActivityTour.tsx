import React, { useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';


interface SyncActivityTourProps {
  visible: boolean;
  onSkip: () => void;
  onFinish: () => void;
  targetLayouts?: Partial<Record<TourTarget, TourTargetLayout>>;
  targetFallbackMode?: 'hiddenUntilMeasured' | 'ratio';
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

export interface TourCoordinateOrigin {
  left: number;
  top: number;
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
}

interface TargetRatioRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SIDE_PADDING = 16;
const COACH_CARD_ESTIMATED_HEIGHT = 168;
const TOUR_BACKGROUND_WIDTH = 790;
const TOUR_BACKGROUND_HEIGHT = 1710;
const ZERO_COORDINATE_ORIGIN: TourCoordinateOrigin = { left: 0, top: 0 };

const TOUR_BACKGROUND_IMAGES_GLOBAL: Record<TourTarget, ImageSourcePropType> = {
  album: require('../../assets/onboarding/global/sync-activity-manual.png'),
  panel: require('../../assets/onboarding/global/sync-activity-panel.png'),
  history: require('../../assets/onboarding/global/sync-activity-history.png'),
  settings: require('../../assets/onboarding/global/sync-activity-settings.png'),
  help: require('../../assets/onboarding/global/sync-activity-help.png'),
};


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

export function convertWindowTargetToOverlayTarget(
  target: TourTargetLayout,
  overlayWindowOrigin: TourCoordinateOrigin,
): TourTargetLayout {
  return {
    ...target,
    left: target.left - overlayWindowOrigin.left,
    top: target.top - overlayWindowOrigin.top,
  };
}

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
  overlayWindowOrigin: TourCoordinateOrigin = ZERO_COORDINATE_ORIGIN,
): TourLayout['target'] {
  const measured = measuredLayouts?.[target];
  if (isValidTourTargetLayout(measured)) {
    return applyTargetPadding(
      convertWindowTargetToOverlayTarget(measured, overlayWindowOrigin),
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
  overlayWindowOrigin: TourCoordinateOrigin = ZERO_COORDINATE_ORIGIN,
): TourLayout {
  const targetRect = getTargetRect(
    target,
    screenWidth,
    screenHeight,
    measuredLayouts,
    overlayWindowOrigin,
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
  };
}

export function SyncActivityTour({
  visible,
  onSkip,
  onFinish,
  targetLayouts,
  targetFallbackMode = 'ratio',
}: SyncActivityTourProps) {
  const { t } = useTranslation();
  const windowDimensions = useWindowDimensions();
  const fallbackWindowDimensions = Dimensions.get('window');
  const fallbackScreenDimensions = Dimensions.get('screen');
  const [overlaySize, setOverlaySize] = useState<TourViewportSize | null>(null);
  const [overlayWindowOrigin, setOverlayWindowOrigin] =
    useState<TourCoordinateOrigin>(ZERO_COORDINATE_ORIGIN);
  const overlayRef = useRef<View>(null);
  const viewportWidth = isValidViewportSize(overlaySize)
    ? overlaySize.width
    : firstPositiveDimension(
        windowDimensions.width,
        fallbackWindowDimensions.width,
        fallbackScreenDimensions.width,
      );
  const viewportHeight = isValidViewportSize(overlaySize)
    ? overlaySize.height
    : firstPositiveDimension(
        fallbackScreenDimensions.height,
        windowDimensions.height,
        fallbackWindowDimensions.height,
      );
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
  const hasMeasuredCurrentTarget = isValidTourTargetLayout(
    targetLayouts?.[current.target],
  );
  const backgroundHeight =
    viewportWidth > 0
      ? (viewportWidth * TOUR_BACKGROUND_HEIGHT) / TOUR_BACKGROUND_WIDTH
      : viewportHeight;

  if (
    visible &&
    targetFallbackMode === 'hiddenUntilMeasured' &&
    !hasMeasuredCurrentTarget
  ) {
    return null;
  }

  const layout = getTourLayout(
    current.target,
    viewportWidth,
    targetFallbackMode === 'ratio' ? backgroundHeight : viewportHeight,
    targetFallbackMode === 'ratio' ? undefined : targetLayouts,
    overlayWindowOrigin,
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

    overlayRef.current?.measureInWindow?.((x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      setOverlayWindowOrigin(currentOrigin => {
        if (
          Math.abs(currentOrigin.left - x) < 0.5 &&
          Math.abs(currentOrigin.top - y) < 0.5
        ) {
          return currentOrigin;
        }

        return { left: x, top: y };
      });
    });
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        ref={overlayRef}
        style={[styles.overlay, styles.staticBackgroundOverlay]}
        testID="sync-activity-tour"
        onLayout={handleOverlayLayout}
      >
        <Image
          source={TOUR_BACKGROUND_IMAGES_GLOBAL[current.target]}
          resizeMode="stretch"
          style={[
            styles.backgroundImage,
            {
              width: viewportWidth,
              height: backgroundHeight,
            },
          ]}
          testID="sync-activity-tour-background"
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
  staticBackgroundOverlay: {
    backgroundColor: 'rgb(64,76,84)',
    overflow: 'hidden',
  },
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
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
