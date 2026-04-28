import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
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

type TutorialTabId = 'lan' | 'qr' | 'code' | 'ip';

interface TutorialTab {
  id: TutorialTabId;
  icon: string;
  label: string;
}

interface TutorialCard {
  title: string;
  description: string;
  icon: string;
  steps: string[];
  warning?: string;
}

const TAB_IDS: TutorialTabId[] = ['lan', 'qr', 'code', 'ip'];

export function ConnectionTutorialScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TutorialTabId>('lan');
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);

  const tabs = useMemo<TutorialTab[]>(
    () => [
      { id: 'lan', icon: 'wifi', label: t('connectionTutorial.tabs.lan') },
      { id: 'qr', icon: 'scan-outline', label: t('connectionTutorial.tabs.qr') },
      { id: 'code', icon: 'lock-closed-outline', label: t('connectionTutorial.tabs.code') },
      { id: 'ip', icon: 'desktop-outline', label: t('connectionTutorial.tabs.ip') },
    ],
    [t],
  );

  const cards = useMemo<Record<TutorialTabId, TutorialCard>>(
    () => ({
      lan: {
        title: t('connectionTutorial.cards.lan.title'),
        description: t('connectionTutorial.cards.lan.description'),
        icon: 'wifi',
        steps: [
          t('connectionTutorial.cards.lan.steps.0'),
          t('connectionTutorial.cards.lan.steps.1'),
          t('connectionTutorial.cards.lan.steps.2'),
        ],
        warning: t('connectionTutorial.cards.lan.warning'),
      },
      qr: {
        title: t('connectionTutorial.cards.qr.title'),
        description: t('connectionTutorial.cards.qr.description'),
        icon: 'scan-outline',
        steps: [
          t('connectionTutorial.cards.qr.steps.0'),
          t('connectionTutorial.cards.qr.steps.1'),
          t('connectionTutorial.cards.qr.steps.2'),
        ],
      },
      code: {
        title: t('connectionTutorial.cards.code.title'),
        description: t('connectionTutorial.cards.code.description'),
        icon: 'lock-closed-outline',
        steps: [
          t('connectionTutorial.cards.code.steps.0'),
          t('connectionTutorial.cards.code.steps.1'),
          t('connectionTutorial.cards.code.steps.2'),
        ],
      },
      ip: {
        title: t('connectionTutorial.cards.ip.title'),
        description: t('connectionTutorial.cards.ip.description'),
        icon: 'desktop-outline',
        steps: [
          t('connectionTutorial.cards.ip.steps.0'),
          t('connectionTutorial.cards.ip.steps.1'),
          t('connectionTutorial.cards.ip.steps.2'),
        ],
      },
    }),
    [t],
  );

  const activeCard = cards[activeTab];
  const activeIndex = TAB_IDS.indexOf(activeTab);
  const showTroubleshootCta = activeTab === 'lan' || activeTab === 'qr' || activeTab === 'ip';
  const troubleshootItems = [
    t('connectionTutorial.troubleshoot.items.0'),
    t('connectionTutorial.troubleshoot.items.1'),
    t('connectionTutorial.troubleshoot.items.2'),
  ];

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
          <Text style={styles.prereqText}>{t('connectionTutorial.prerequisite')}</Text>
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => {
            const active = tab.id === activeTab;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabButton, active && styles.tabButtonActive]}
                activeOpacity={0.78}
                onPress={() => setActiveTab(tab.id)}
              >
                <Icon name={tab.icon} size={15} color={active ? '#ffffff' : '#7893ab'} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.card}>
          <View style={styles.visual}>
            <View style={styles.visualIconOuter}>
              <View style={styles.visualIconInner}>
                <Icon name={activeCard.icon} size={38} color="#2563eb" />
              </View>
            </View>
            <Text style={styles.cardTitle}>{activeCard.title}</Text>
            <Text style={styles.cardDescription}>{activeCard.description}</Text>
          </View>

          <View style={styles.steps}>
            {activeCard.steps.map((step, index) => (
              <View key={step} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}

            {activeCard.warning ? (
              <Text style={styles.downloadHint}>{activeCard.warning}</Text>
            ) : null}

            {showTroubleshootCta ? (
              <TouchableOpacity
                style={styles.troubleButton}
                activeOpacity={0.8}
                onPress={() => setShowTroubleshoot(true)}
              >
                <Icon name="alert-circle-outline" size={17} color="#d97706" />
                <Text style={styles.troubleText}>{t('connectionTutorial.troubleshoot.entry')}</Text>
                <Text style={styles.troubleLink}>{t('connectionTutorial.troubleshoot.cta')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.dots}>
          {TAB_IDS.map((id, index) => (
            <TouchableOpacity
              key={id}
              style={[styles.dot, index === activeIndex && styles.dotActive]}
              onPress={() => setActiveTab(id)}
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
        <Pressable style={styles.sheetOverlay} onPress={() => setShowTroubleshoot(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Icon name="alert-circle-outline" size={20} color="#d97706" />
              <Text style={styles.sheetTitle}>{t('connectionTutorial.troubleshoot.title')}</Text>
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
            <Text style={styles.supportTitle}>{t('connectionTutorial.troubleshoot.supportTitle')}</Text>
            <Text style={styles.supportBody}>{t('connectionTutorial.troubleshoot.supportBody')}</Text>
            <Text style={styles.supportEmail}>{t('connectionTutorial.troubleshoot.supportEmail')}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#eef6ff',
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
    backgroundColor: 'rgba(255,255,255,0.58)',
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
  card: {
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: 'rgba(59,130,210,0.4)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 3,
  },
  visual: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: '#dbeafe',
  },
  visualIconOuter: {
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 2,
    borderColor: 'rgba(37,99,235,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualIconInner: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    marginTop: 18,
    color: '#1a3a5c',
    fontSize: 18,
    fontWeight: '800',
  },
  cardDescription: {
    marginTop: 8,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
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
