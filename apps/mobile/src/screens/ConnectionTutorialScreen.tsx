import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { appConfig } from '../config/app-config';

type TutorialTabId = 'lan' | 'qr' | 'code' | 'ip';

interface TutorialTab {
  id: TutorialTabId;
  icon: string;
  label: string;
}

interface TutorialCard {
  visual: React.ReactNode;
  steps: string[];
  warning?: string;
}

const TAB_IDS: TutorialTabId[] = ['lan', 'qr', 'code', 'ip'];
const desktopDownloadHost = appConfig.endpoints.webBaseUrl
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

function LanVisual() {
  return (
    <View style={styles.visualScene} testID="connection-tutorial-visual-lan">
      <View style={styles.wifiBeacon}>
        <View style={styles.wifiRingLarge} />
        <View style={styles.wifiRingSmall} />
        <View style={styles.wifiCenter}>
          <Icon name="wifi" size={30} color="#2563eb" />
        </View>
      </View>
      <View style={styles.devicePairRow}>
        <View style={styles.phoneMock}>
          <View style={styles.phoneDot} />
        </View>
        <View style={styles.connectionDots}>
          <View style={styles.connectionDotMuted} />
          <View style={styles.connectionDotActive} />
          <View style={styles.connectionDotMuted} />
        </View>
        <View style={styles.monitorMock}>
          <Icon name="desktop-outline" size={18} color="#3b82f6" />
        </View>
      </View>
    </View>
  );
}

function QrVisual() {
  return (
    <View style={styles.visualScene} testID="connection-tutorial-visual-qr">
      <View style={styles.qrFrame}>
        <Icon name="scan-outline" size={64} color="rgba(37,99,235,0.62)" />
        <View style={styles.qrScanLine} />
        <View style={[styles.qrCorner, styles.qrCornerTopLeft]} />
        <View style={[styles.qrCorner, styles.qrCornerTopRight]} />
        <View style={[styles.qrCorner, styles.qrCornerBottomLeft]} />
        <View style={[styles.qrCorner, styles.qrCornerBottomRight]} />
      </View>
    </View>
  );
}

function CodeVisual() {
  const digits = ['3', '8', '5', '2', '1', '7'];

  return (
    <View style={styles.visualScene} testID="connection-tutorial-visual-code">
      <View style={styles.codePanel}>
        <View style={styles.codeHeader} />
        <View style={styles.codeDigits}>
          {digits.map((digit, index) => (
            <View key={`${digit}-${index}`} style={styles.codeDigitBox}>
              <Text style={styles.codeDigitText}>{digit}</Text>
            </View>
          ))}
        </View>
        <View style={styles.codeActionPill}>
          <Icon name="lock-closed-outline" size={13} color="#3b82f6" />
          <View style={styles.codeActionLine} />
        </View>
      </View>
    </View>
  );
}

function IpVisual() {
  return (
    <View style={styles.visualScene} testID="connection-tutorial-visual-ip">
      <View style={styles.ipMonitorWrap}>
        <View style={styles.ipMonitor}>
          <Icon name="desktop-outline" size={42} color="rgba(37,99,235,0.72)" />
        </View>
        <View style={styles.ipBadge}>
          <Icon name="scan-outline" size={15} color="#2563eb" />
        </View>
      </View>
      <View style={styles.ipPill}>
        <View style={styles.ipStatusDot} />
        <Text style={styles.ipText}>192.168.1.x</Text>
      </View>
    </View>
  );
}

export function ConnectionTutorialScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const pageScrollRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<TutorialTabId>('lan');
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const pageWidth = Math.max(windowWidth, 1);

  const tabs = useMemo<TutorialTab[]>(
    () => [
      { id: 'lan', icon: 'wifi', label: t('connectionTutorial.tabs.lan') },
      {
        id: 'qr',
        icon: 'scan-outline',
        label: t('connectionTutorial.tabs.qr'),
      },
      {
        id: 'code',
        icon: 'lock-closed-outline',
        label: t('connectionTutorial.tabs.code'),
      },
      {
        id: 'ip',
        icon: 'desktop-outline',
        label: t('connectionTutorial.tabs.ip'),
      },
    ],
    [t],
  );

  const cards = useMemo<Record<TutorialTabId, TutorialCard>>(
    () => ({
      lan: {
        visual: <LanVisual />,
        steps: [
          t('connectionTutorial.cards.lan.steps.0'),
          t('connectionTutorial.cards.lan.steps.1'),
          t('connectionTutorial.cards.lan.steps.2'),
        ],
        warning: t('connectionTutorial.cards.lan.warning').replace(
          'www.vividrop.cn',
          desktopDownloadHost,
        ),
      },
      qr: {
        visual: <QrVisual />,
        steps: [
          t('connectionTutorial.cards.qr.steps.0'),
          t('connectionTutorial.cards.qr.steps.1'),
          t('connectionTutorial.cards.qr.steps.2'),
        ],
      },
      code: {
        visual: <CodeVisual />,
        steps: [
          t('connectionTutorial.cards.code.steps.0'),
          t('connectionTutorial.cards.code.steps.1'),
          t('connectionTutorial.cards.code.steps.2'),
        ],
      },
      ip: {
        visual: <IpVisual />,
        steps: [
          t('connectionTutorial.cards.ip.steps.0'),
          t('connectionTutorial.cards.ip.steps.1'),
          t('connectionTutorial.cards.ip.steps.2'),
        ],
      },
    }),
    [t],
  );

  const activeIndex = TAB_IDS.indexOf(activeTab);
  const troubleshootItems = [
    t('connectionTutorial.troubleshoot.items.0'),
    t('connectionTutorial.troubleshoot.items.1'),
    t('connectionTutorial.troubleshoot.items.2'),
  ];

  const selectTab = (tabId: TutorialTabId) => {
    const nextIndex = TAB_IDS.indexOf(tabId);
    setActiveTab(tabId);
    pageScrollRef.current?.scrollTo({
      x: pageWidth * nextIndex,
      animated: true,
    });
  };

  const handlePageMomentumEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const measuredWidth =
      event.nativeEvent.layoutMeasurement.width || pageWidth;
    const nextIndex = Math.min(
      TAB_IDS.length - 1,
      Math.max(
        0,
        Math.round(event.nativeEvent.contentOffset.x / measuredWidth),
      ),
    );
    setActiveTab(TAB_IDS[nextIndex]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="chevron-back" size={20} color="#1a3a5c" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('connectionTutorial.title')}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.prereqBanner}>
          <Icon name="checkmark-circle" size={18} color="#2563eb" />
          <Text style={styles.prereqText}>
            {t('connectionTutorial.prerequisite')}
          </Text>
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => {
            const active = tab.id === activeTab;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabButton, active && styles.tabButtonActive]}
                activeOpacity={0.78}
                onPress={() => selectTab(tab.id)}
              >
                <Icon
                  name={tab.icon}
                  size={15}
                  color={active ? '#ffffff' : '#7893ab'}
                />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          ref={pageScrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          style={styles.pageScroll}
          onMomentumScrollEnd={handlePageMomentumEnd}
          testID="connection-tutorial-pages"
        >
          {TAB_IDS.map(id => {
            const card = cards[id];
            const showTroubleshootCta =
              id === 'lan' || id === 'qr' || id === 'ip';

            return (
              <View
                key={id}
                testID={`connection-tutorial-page-${id}`}
                style={[styles.tutorialPage, { width: pageWidth }]}
              >
                <View style={styles.card}>
                  <View style={styles.visual}>{card.visual}</View>

                  <View style={styles.steps}>
                    {card.steps.map((step, index) => (
                      <View key={step} style={styles.stepRow}>
                        <View style={styles.stepNumber}>
                          <Text style={styles.stepNumberText}>{index + 1}</Text>
                        </View>
                        <Text style={styles.stepText}>{step}</Text>
                      </View>
                    ))}

                    {card.warning ? (
                      <Text style={styles.downloadHint}>{card.warning}</Text>
                    ) : null}

                    {showTroubleshootCta ? (
                      <TouchableOpacity
                        style={styles.troubleButton}
                        activeOpacity={0.8}
                        onPress={() => setShowTroubleshoot(true)}
                      >
                        <Icon
                          name="alert-circle-outline"
                          size={17}
                          color="#d97706"
                        />
                        <Text style={styles.troubleText}>
                          {t('connectionTutorial.troubleshoot.entry')}
                        </Text>
                        <Text style={styles.troubleLink}>
                          {t('connectionTutorial.troubleshoot.cta')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.dots}>
          {TAB_IDS.map((id, index) => (
            <TouchableOpacity
              key={id}
              style={[styles.dot, index === activeIndex && styles.dotActive]}
              onPress={() => selectTab(id)}
              accessibilityLabel={tabs[index]?.label}
            />
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={showTroubleshoot}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTroubleshoot(false)}
      >
        <Pressable
          style={styles.sheetOverlay}
          onPress={() => setShowTroubleshoot(false)}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Icon name="alert-circle-outline" size={20} color="#d97706" />
              <Text style={styles.sheetTitle}>
                {t('connectionTutorial.troubleshoot.title')}
              </Text>
            </View>
            {troubleshootItems.map((item, index) => (
              <View key={item} style={styles.sheetItem}>
                <View style={styles.sheetNumber}>
                  <Text style={styles.sheetNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.sheetItemText}>{item}</Text>
              </View>
            ))}
            <View style={styles.sheetDivider} />
            <Text style={styles.supportTitle}>
              {t('connectionTutorial.troubleshoot.supportTitle')}
            </Text>
            <Text style={styles.supportBody}>
              {t('connectionTutorial.troubleshoot.supportBody')}
            </Text>
            <Text style={styles.supportEmail}>
              {appConfig.endpoints.supportEmail}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#e8f0fb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.64)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#1a3a5c',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  prereqBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(37,99,235,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.13)',
  },
  prereqText: {
    flex: 1,
    color: '#1e40af',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    marginBottom: 14,
    padding: 5,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabButtonActive: {
    backgroundColor: '#2563eb',
  },
  tabText: {
    color: '#7893ab',
    fontSize: 11,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  pageScroll: {
    marginHorizontal: -16,
  },
  tutorialPage: {
    paddingHorizontal: 16,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: 'rgba(59,130,210,0.4)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 3,
  },
  visual: {
    height: 252,
    backgroundColor: '#dbeafe',
  },
  visualScene: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dbeafe',
  },
  wifiBeacon: {
    width: 118,
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  wifiRingLarge: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.1)',
  },
  wifiRingSmall: {
    position: 'absolute',
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.2)',
  },
  wifiCenter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.25)',
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  devicePairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  phoneMock: {
    width: 26,
    height: 42,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#93c5fd',
    backgroundColor: 'rgba(219,234,254,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
  },
  connectionDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  connectionDotMuted: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(59,130,246,0.3)',
  },
  connectionDotActive: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
  },
  monitorMock: {
    width: 50,
    height: 34,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#93c5fd',
    backgroundColor: 'rgba(219,234,254,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrFrame: {
    width: 132,
    height: 132,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.2)',
    backgroundColor: 'rgba(219,234,254,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrScanLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 42,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#3b82f6',
  },
  qrCorner: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: '#2563eb',
  },
  qrCornerTopLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 9,
  },
  qrCornerTopRight: {
    top: -2,
    right: -2,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: 9,
  },
  qrCornerBottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 9,
  },
  qrCornerBottomRight: {
    right: -2,
    bottom: -2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderBottomRightRadius: 9,
  },
  codePanel: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
    backgroundColor: 'rgba(219,234,254,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.18)',
    alignItems: 'center',
  },
  codeHeader: {
    width: 124,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(100,116,139,0.22)',
  },
  codeDigits: {
    flexDirection: 'row',
    gap: 7,
  },
  codeDigitBox: {
    width: 32,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#3b82d2',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  codeDigitText: {
    color: '#1e40af',
    fontSize: 16,
    fontWeight: '800',
  },
  codeActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: 'rgba(59,130,246,0.1)',
  },
  codeActionLine: {
    width: 66,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(37,99,235,0.22)',
  },
  ipMonitorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ipMonitor: {
    width: 112,
    height: 80,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.22)',
    backgroundColor: 'rgba(219,234,254,0.46)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ipBadge: {
    position: 'absolute',
    right: -8,
    top: -8,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.25)',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ipPill: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.18)',
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ipStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  ipText: {
    color: '#1e40af',
    fontSize: 13,
    fontWeight: '700',
  },
  steps: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '800',
  },
  stepText: {
    flex: 1,
    color: '#334155',
    fontSize: 13,
    lineHeight: 20,
  },
  downloadHint: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 17,
  },
  troubleButton: {
    marginTop: 18,
    minHeight: 48,
    borderRadius: 18,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,237,213,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(251,146,60,0.3)',
  },
  troubleText: {
    flex: 1,
    marginLeft: 9,
    color: '#92400e',
    fontSize: 13,
    fontWeight: '700',
  },
  troubleLink: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '700',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(59,130,246,0.25)',
  },
  dotActive: {
    width: 22,
    backgroundColor: '#2563eb',
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.36)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: '#ffffff',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sheetTitle: {
    color: '#1a3a5c',
    fontSize: 16,
    fontWeight: '800',
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  sheetNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetNumberText: {
    color: '#d97706',
    fontSize: 11,
    fontWeight: '800',
  },
  sheetItemText: {
    flex: 1,
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 6,
  },
  supportTitle: {
    marginTop: 10,
    color: '#1a3a5c',
    fontSize: 13,
    fontWeight: '800',
  },
  supportBody: {
    marginTop: 5,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  supportEmail: {
    marginTop: 5,
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '800',
  },
});
