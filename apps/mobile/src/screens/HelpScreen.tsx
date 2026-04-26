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
const SECTION_TEXT = '#6e8aa3';
const ROW_CHEVRON = '#b8d0e4';
const ACCENT_LINE = '#3b9fd8';
const STEP_BG = '#2a6cb5';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface FeatureItem {
  icon: string;
  title: string;
  description: string;
}

interface StepItem {
  step: number;
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

  const FEATURE_ITEMS: FeatureItem[] = [
    { icon: 'link-outline', title: t('help.features.feature0.title'), description: t('help.features.feature0.description') },
    { icon: 'link-outline', title: t('help.features.feature1.title'), description: t('help.features.feature1.description') },
    { icon: 'cloud-upload-outline', title: t('help.features.feature2.title'), description: t('help.features.feature2.description') },
    { icon: 'folder-outline', title: t('help.features.feature3.title'), description: t('help.features.feature3.description') },
  ];

  const STEP_ITEMS: StepItem[] = [
    { step: 1, title: t('help.steps.step0.title'), description: t('help.steps.step0.description') },
    { step: 2, title: t('help.steps.step1.title'), description: t('help.steps.step1.description') },
    { step: 3, title: t('help.steps.step2.title'), description: t('help.steps.step2.description') },
    { step: 4, title: t('help.steps.step3.title'), description: t('help.steps.step3.description') },
  ];

  const UPLOAD_SHARE_ITEMS: ExpandableItem[] = [
    { icon: 'sync-outline', title: t('help.uploadShare.item0.title'), answer: t('help.uploadShare.item0.answer') },
    { icon: 'folder-outline', title: t('help.uploadShare.item1.title'), answer: t('help.uploadShare.item1.answer') },
    { icon: 'share-outline', title: t('help.uploadShare.item2.title'), answer: t('help.uploadShare.item2.answer') },
  ];

  const FAQ_ITEMS: ExpandableItem[] = [
    { icon: 'help-circle-outline', title: t('help.faq.item0.title'), answer: t('help.faq.item0.answer') },
    { icon: 'help-circle-outline', title: t('help.faq.item1.title'), answer: t('help.faq.item1.answer') },
    { icon: 'help-circle-outline', title: t('help.faq.item2.title'), answer: t('help.faq.item2.answer') },
    { icon: 'help-circle-outline', title: t('help.faq.item3.title'), answer: t('help.faq.item3.answer') },
    { icon: 'help-circle-outline', title: t('help.faq.item4.title'), answer: t('help.faq.item4.answer') },
    { icon: 'help-circle-outline', title: t('help.faq.item5.title'), answer: t('help.faq.item5.answer') },
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
        Alert.alert(t('settings.dialogs.exportUnavailable.title'), t('settings.dialogs.exportUnavailable.body'));
      } else {
        Alert.alert(t('settings.dialogs.exportFailed.title'), t('settings.dialogs.exportFailed.body'));
      }
    } finally {
      setIsExporting(false);
    }
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
            name={isOpen ? 'chevron-down' : 'chevron-up'}
            size={16}
            color={MUTED_TEXT}
          />
        </TouchableOpacity>
        {isOpen && (
          <Text style={styles.expandAnswer}>{item.answer}</Text>
        )}
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
        {/* ============================================================= */}
        {/* Section 1: features                                            */}
        {/* ============================================================= */}
        <Text style={styles.sectionLabel}>{t('help.sections.features')}</Text>
        <View style={styles.listCard}>
          {FEATURE_ITEMS.map((item, index) => (
            <View key={index}>
              <View style={styles.featureRow}>
                <View style={styles.featureAccent} />
                <View style={styles.featureIconCircle}>
                  <Icon name={item.icon} size={18} color={BLUE} />
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureTitle}>{item.title}</Text>
                  <Text style={styles.featureDesc}>{item.description}</Text>
                </View>
              </View>
              {index < FEATURE_ITEMS.length - 1 && (
                <View style={styles.listSep} />
              )}
            </View>
          ))}
        </View>

        {/* ============================================================= */}
        {/* Section 2: gettingStarted                                      */}
        {/* ============================================================= */}
        <Text style={styles.sectionLabel}>{t('help.sections.gettingStarted')}</Text>
        <View style={styles.listCard}>
          {STEP_ITEMS.map((item, index) => (
            <View key={index}>
              <View style={styles.stepRow}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>{item.step}</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{item.title}</Text>
                  <Text style={styles.stepDesc}>{item.description}</Text>
                </View>
              </View>
              {index < STEP_ITEMS.length - 1 && (
                <View style={styles.listSep} />
              )}
            </View>
          ))}
        </View>

        {/* ============================================================= */}
        {/* Section 3: uploadShare                                         */}
        {/* ============================================================= */}
        <Text style={styles.sectionLabel}>{t('help.sections.uploadShare')}</Text>
        <View style={styles.listCard}>
          {UPLOAD_SHARE_ITEMS.map((item, index) =>
            renderExpandableRow(
              item,
              `share-${index}`,
              index === UPLOAD_SHARE_ITEMS.length - 1,
            ),
          )}
        </View>

        {/* ============================================================= */}
        {/* Section 4: faq                                                 */}
        {/* ============================================================= */}
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

        {/* ============================================================= */}
        {/* Section 5: contact                                             */}
        {/* ============================================================= */}
        <Text style={styles.sectionLabel}>{t('help.sections.contact')}</Text>
        <View style={styles.listCard}>
          {/* support email */}
          <TouchableOpacity
            style={styles.contactRow}
            activeOpacity={0.6}
            onPress={() => {
              void Linking.openURL('mailto:support@vividrop.cn');
            }}
          >
            <View style={styles.contactRowLeft}>
              <Icon name="mail-outline" size={18} color={BLUE} />
              <View>
                <Text style={styles.contactRowTitle}>{t('help.contact.supportEmail')}</Text>
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
              <Icon name="download-outline" size={18} color={BLUE} />
              <View>
                <Text style={styles.contactRowTitle}>
                  {isExporting ? t('help.contact.exportingDiagnostics') : t('help.contact.exportDiagnostics')}
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
    fontSize: 13,
    fontWeight: '600',
    color: SECTION_TEXT,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 4,
  },

  // Shared list card
  listCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
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

  // ---------------------------------------------------------------------------
  // Feature rows
  // ---------------------------------------------------------------------------
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingRight: 18,
    paddingLeft: 4,
  },
  featureAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: ACCENT_LINE,
    marginRight: 12,
  },
  featureIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(59,159,216,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  featureContent: {
    flex: 1,
    minWidth: 0,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 12,
    lineHeight: 18,
    color: MUTED_TEXT,
  },

  // ---------------------------------------------------------------------------
  // Step rows
  // ---------------------------------------------------------------------------
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: STEP_BG,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  stepBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  stepContent: {
    flex: 1,
    minWidth: 0,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: 12,
    lineHeight: 18,
    color: MUTED_TEXT,
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
