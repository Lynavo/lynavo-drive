import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import {
  isDiagnosticsExportUnavailable,
  shareDiagnosticsArchive,
} from '../utils/shareDiagnosticsArchive';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DARK = '#1a3a5c';
const BLUE = '#3b9fd8';
const SCREEN_BG = '#d6ecf8';
const CARD_BG = '#ffffff';
const CARD_BORDER = 'rgba(187, 214, 233, 0.72)';
const MUTED_TEXT = '#7893ab';
const SECTION_TEXT = '#a0bdd0';
const ROW_CHEVRON = '#b8d0e4';
const STEP_LINE = '#dbe9f4';
const ICON_BLUE_BG = '#e8f2ff';
const ICON_PURPLE_BG = '#f0eafe';
const ICON_GREEN_BG = '#e6f8ed';
const ICON_PURPLE = '#8b6fed';
const ICON_GREEN = '#1dbb63';
const DOWNLOAD_URL = 'https://www.vividrop.cn';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface FeatureItem {
  icon: string;
  title: string;
  description: string;
}

interface StepItem {
  icon: string;
  iconColor: string;
  iconBackground: string;
  title: string;
  description: string;
}

interface ExpandableItem {
  icon: string;
  title: string;
  answer: string;
}

// ---------------------------------------------------------------------------
// HelpScreen
// ---------------------------------------------------------------------------

export function HelpScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  const PRODUCT: FeatureItem = {
    icon: 'desktop-outline',
    title: t('help.product.title'),
    description: t('help.product.description'),
  };

  const STEP_ITEMS: StepItem[] = [
    {
      icon: 'desktop-outline',
      iconColor: BLUE,
      iconBackground: ICON_BLUE_BG,
      title: t('help.steps.step0.title'),
      description: t('help.steps.step0.description'),
    },
    {
      icon: 'scan-outline',
      iconColor: ICON_PURPLE,
      iconBackground: ICON_PURPLE_BG,
      title: t('help.steps.step1.title'),
      description: t('help.steps.step1.description'),
    },
    {
      icon: 'flash-outline',
      iconColor: ICON_GREEN,
      iconBackground: ICON_GREEN_BG,
      title: t('help.steps.step2.title'),
      description: t('help.steps.step2.description'),
    },
  ];

  const FAQ_ITEMS: ExpandableItem[] = [
    {
      icon: 'help-circle-outline',
      title: t('help.faq.item0.title'),
      answer: t('help.faq.item0.answer'),
    },
    {
      icon: 'help-circle-outline',
      title: t('help.faq.item1.title'),
      answer: t('help.faq.item1.answer'),
    },
    {
      icon: 'help-circle-outline',
      title: t('help.faq.item2.title'),
      answer: t('help.faq.item2.answer'),
    },
    {
      icon: 'help-circle-outline',
      title: t('help.faq.item3.title'),
      answer: t('help.faq.item3.answer'),
    },
    {
      icon: 'help-circle-outline',
      title: t('help.faq.item4.title'),
      answer: t('help.faq.item4.answer'),
    },
    {
      icon: 'help-circle-outline',
      title: t('help.faq.item5.title'),
      answer: t('help.faq.item5.answer'),
    },
  ];

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    try {
      setIsExporting(true);
      await shareDiagnosticsArchive();
    } catch (error) {
      if (isDiagnosticsExportUnavailable(error)) {
        Alert.alert(
          t('settings.dialogs.exportUnavailable.title'),
          t('settings.dialogs.exportUnavailable.body'),
        );
      } else {
        Alert.alert(
          t('settings.dialogs.exportFailed.title'),
          t('settings.dialogs.exportFailed.body'),
        );
      }
    } finally {
      setIsExporting(false);
    }
  }, [t]);

  const handleOpenDownload = useCallback(() => {
    void Linking.openURL(DOWNLOAD_URL);
  }, []);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderExpandableRow = (
    item: ExpandableItem,
    key: string,
    isLast: boolean,
  ) => {
    const isOpen = expandedKeys.has(key);
    return (
      <View key={key}>
        <TouchableOpacity
          style={styles.expandRow}
          activeOpacity={0.6}
          onPress={() => toggleExpand(key)}
        >
          <View style={styles.expandRowLeft}>
            <Icon name={item.icon} size={18} color={BLUE} />
            <Text style={styles.expandRowTitle}>{item.title}</Text>
          </View>
          <Icon
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={ROW_CHEVRON}
          />
        </TouchableOpacity>
        {isOpen && <Text style={styles.expandAnswer}>{item.answer}</Text>}
        {!isLast && <View style={styles.listSep} />}
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.6}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 30 }}
          onPress={() => navigation.goBack()}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="chevron-back" size={20} color={DARK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('help.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.productCard}>
          <View style={styles.productIconBox}>
            <Icon name={PRODUCT.icon} size={30} color={BLUE} />
          </View>
          <View style={styles.productContent}>
            <Text style={styles.productTitle}>{PRODUCT.title}</Text>
            <Text style={styles.productDesc}>{PRODUCT.description}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>
          {t('help.sections.gettingStarted')}
        </Text>
        <View style={styles.quickStartCard}>
          {STEP_ITEMS.map((item, index) => (
            <View key={index} style={styles.stepItem}>
              <View style={styles.stepRail}>
                <View
                  style={[
                    styles.stepIconCircle,
                    { backgroundColor: item.iconBackground },
                  ]}
                >
                  <Icon name={item.icon} size={20} color={item.iconColor} />
                </View>
                {index < STEP_ITEMS.length - 1 && (
                  <View style={styles.stepLine} />
                )}
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{item.title}</Text>
                <Text style={styles.stepDesc}>{item.description}</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={styles.downloadCta}
            activeOpacity={0.7}
            onPress={handleOpenDownload}
          >
            <View style={styles.downloadCtaLeft}>
              <Icon name="desktop-outline" size={18} color={BLUE} />
              <Text style={styles.downloadCtaText}>
                {t('help.download.label')}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={BLUE} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>{t('help.sections.faq')}</Text>
        <View style={styles.listCard}>
          {FAQ_ITEMS.map((item, index) =>
            renderExpandableRow(
              item,
              `faq-${index}`,
              index === FAQ_ITEMS.length - 1,
            ),
          )}
        </View>

        <Text style={styles.sectionLabel}>{t('help.sections.contact')}</Text>
        <View style={styles.listCard}>
          <TouchableOpacity
            style={styles.contactRow}
            activeOpacity={0.6}
            onPress={() => {
              void Linking.openURL('mailto:support@vividrop.cn');
            }}
          >
            <View style={styles.contactRowLeft}>
              <View
                style={[styles.contactIconCircle, styles.contactIconPurple]}
              >
                <Icon name="mail-outline" size={18} color="#6b63ff" />
              </View>
              <View>
                <Text style={styles.contactRowTitle}>
                  {t('help.contact.supportEmail')}
                </Text>
                <Text style={styles.contactRowSub}>support@vividrop.cn</Text>
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.listSep} />
          {/* export diagnostics */}
          <TouchableOpacity
            style={styles.contactRow}
            activeOpacity={0.6}
            disabled={isExporting}
            onPress={() => {
              void handleExportDiagnostics();
            }}
          >
            <View style={styles.contactRowLeft}>
              <View
                style={[styles.contactIconCircle, styles.contactIconOrange]}
              >
                <Icon name="cube-outline" size={18} color="#f08a24" />
              </View>
              <View>
                <Text style={styles.contactRowTitle}>
                  {isExporting
                    ? t('help.contact.exportingDiagnostics')
                    : t('help.contact.exportDiagnostics')}
                </Text>
                <Text style={styles.contactRowSub}>
                  {t('help.contact.exportHint')}
                </Text>
              </View>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: DARK,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 40,
  },

  // Section label
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: SECTION_TEXT,
    marginBottom: 10,
    marginTop: 6,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },

  // Shared list card
  listCard: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  listSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e4eff7',
    marginHorizontal: 18,
  },

  // Product card
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.60)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    padding: 18,
    marginBottom: 18,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  productIconBox: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    shadowColor: '#8db7d8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 2,
  },
  productContent: {
    flex: 1,
    minWidth: 0,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    marginBottom: 8,
  },
  productDesc: {
    fontSize: 14,
    lineHeight: 22,
    color: MUTED_TEXT,
  },

  // ---------------------------------------------------------------------------
  // Quick start
  // ---------------------------------------------------------------------------
  quickStartCard: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 22,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 76,
  },
  stepRail: {
    width: 44,
    alignItems: 'center',
    marginRight: 14,
  },
  stepIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepLine: {
    flex: 1,
    width: 2,
    backgroundColor: STEP_LINE,
    marginVertical: 6,
  },
  stepContent: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
    paddingBottom: 18,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
    marginBottom: 6,
  },
  stepDesc: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED_TEXT,
  },
  downloadCta: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c9def5',
    backgroundColor: '#f3f9ff',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  downloadCtaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  downloadCtaText: {
    flex: 1,
    color: BLUE,
    fontSize: 14,
    fontWeight: '700',
  },

  // ---------------------------------------------------------------------------
  // Expandable rows
  // ---------------------------------------------------------------------------
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  expandRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  expandRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
    flex: 1,
  },
  expandAnswer: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED_TEXT,
    paddingHorizontal: 18,
    paddingBottom: 14,
    paddingLeft: 46,
  },

  // ---------------------------------------------------------------------------
  // Contact rows
  // ---------------------------------------------------------------------------
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  contactRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  contactIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactIconPurple: {
    backgroundColor: '#efedff',
  },
  contactIconOrange: {
    backgroundColor: '#fff1df',
  },
  contactRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  contactRowSub: {
    fontSize: 12,
    color: MUTED_TEXT,
    marginTop: 1,
  },

  bottomSpacer: {
    height: 20,
  },
});
