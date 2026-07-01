import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { appConfig } from '../config/app-config';
import {
  isDiagnosticsExportUnavailable,
  shareDiagnosticsArchive,
} from '../utils/shareDiagnosticsArchive';
import { androidBoxShadow } from '../utils/androidShadow';

interface FaqItem {
  title: string;
  answer: string;
}

export function HelpGlobalScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  const faqs: FaqItem[] = [
    {
      title: t('help.faq.item0.title'),
      answer: t('help.faq.item0.answer'),
    },
    {
      title: t('help.faq.item1.title'),
      answer: t('help.faq.item1.answer'),
    },
    {
      title: t('help.faq.item2.title'),
      answer: t('help.faq.item2.answer'),
    },
    {
      title: t('help.faq.item3.title'),
      answer: t('help.faq.item3.answer'),
    },
    {
      title: t('help.faq.item4.title'),
      answer: t('help.faq.item4.answer'),
    },
    {
      title: t('help.faq.item5.title'),
      answer: t('help.faq.item5.answer'),
    },
  ];

  const handleOpenSupportEmail = useCallback(() => {
    void Linking.openURL(`mailto:${appConfig.endpoints.supportEmail}`);
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    if (isExportingDiagnostics) return;

    setIsExportingDiagnostics(true);
    try {
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
      setIsExportingDiagnostics(false);
    }
  }, [isExportingDiagnostics, t]);

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header} testID="help-header">
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.65}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 30 }}
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('common.back')}
          >
            <Icon name="chevron-back" size={20} color="#17191C" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings.actions.help')}</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.faqStack} testID="help-faq-stack">
            {faqs.map((item, index) => (
              <View
                key={index}
                style={[
                  styles.faqCard,
                  index === faqs.length - 1 ? styles.faqCardLast : null,
                ]}
                testID="help-faq-card"
              >
                <Text style={styles.faqQuestion}>{item.title}</Text>
                <Text style={styles.faqAnswer}>{item.answer}</Text>
              </View>
            ))}
          </View>

          <View style={styles.utilitySection} testID="help-utility-section">
            <Text style={styles.sectionLabel}>
              {t('help.sections.contact')}
            </Text>
            <View style={styles.actionCard}>
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={0.7}
                onPress={handleOpenSupportEmail}
              >
                <View style={[styles.actionIconBox, styles.mailIconBox]}>
                  <Icon name="mail-outline" size={18} color="#1677D2" />
                </View>
                <View style={styles.actionContent}>
                  <Text style={styles.actionTitle}>
                    {t('help.contact.supportEmail')}
                  </Text>
                  <Text style={styles.actionDesc}>
                    {appConfig.endpoints.supportEmail}
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.actionSeparator} />
              <TouchableOpacity
                style={[
                  styles.actionRow,
                  isExportingDiagnostics ? styles.actionRowDisabled : null,
                ]}
                activeOpacity={0.7}
                onPress={handleExportDiagnostics}
                disabled={isExportingDiagnostics}
              >
                <View style={[styles.actionIconBox, styles.diagnosticsIconBox]}>
                  <Icon name="share-outline" size={18} color="#746AA8" />
                </View>
                <View style={styles.actionContent}>
                  <Text style={styles.actionTitle}>
                    {isExportingDiagnostics
                      ? t('help.contact.exportingDiagnostics')
                      : t('help.contact.exportDiagnostics')}
                  </Text>
                  <Text style={styles.actionDesc}>
                    {t('help.contact.exportHint')}
                  </Text>
                </View>
                {isExportingDiagnostics ? (
                  <ActivityIndicator size="small" color="#746AA8" />
                ) : (
                  <Icon name="chevron-forward" size={16} color="#C7D2DF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </GlobalGradientBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    marginHorizontal: 12,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.54)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 19,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 14,
      blurRadius: 19,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#17191C',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 44,
  },
  faqStack: {
    marginBottom: 24,
  },
  utilitySection: {
    marginBottom: 22,
  },
  sectionLabel: {
    marginBottom: 10,
    paddingHorizontal: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#7B8490',
  },
  faqCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 16,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 26,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  faqCardLast: {
    marginBottom: 0,
  },
  faqQuestion: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    color: '#17191C',
  },
  faqAnswer: {
    marginTop: 14,
    fontSize: 12,
    lineHeight: 24,
    color: '#59616D',
  },
  actionCard: {
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 26,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  actionRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionRowDisabled: {
    opacity: 0.55,
  },
  actionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mailIconBox: {
    backgroundColor: 'rgba(22,119,210,0.10)',
  },
  diagnosticsIconBox: {
    backgroundColor: 'rgba(116,106,168,0.12)',
  },
  giftIconBox: {
    backgroundColor: 'rgba(255,204,0,0.15)',
  },
  actionContent: {
    flex: 1,
    minWidth: 0,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    color: '#17191C',
  },
  actionDesc: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 17,
    color: '#59616D',
  },
  actionSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 64,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'transparent',
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.90)',
    backgroundColor: 'rgba(248,251,255,0.98)',
    padding: 20,
    shadowColor: '#23344D',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.24,
    shadowRadius: 35,
    elevation: 12,
    ...androidBoxShadow({
      offsetY: 24,
      blurRadius: 35,
      color: 'rgba(35, 52, 77, 0.24)',
    }),
  },
  modalIconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
    backgroundColor: '#FFF3E4',
  },
  modalTitle: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#17191C',
  },
  modalMessage: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: '#59616D',
  },
  modalInput: {
    minHeight: 50,
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: '#DDE8F4',
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.2,
    textAlign: 'center',
    color: '#17191C',
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  modalButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButton: {
    borderWidth: 1,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  modalSubmitButton: {
    backgroundColor: '#1677D2',
    shadowColor: '#1677D2',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  modalButtonDisabled: {
    opacity: 0.55,
  },
  modalCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3F4A58',
  },
  modalSubmitText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
