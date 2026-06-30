import React, { useCallback } from 'react';
import {
  Alert,
  Clipboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { appConfig } from '../../config/app-config';

const DOWNLOAD_URL = appConfig.endpoints.webBaseUrl;


interface UnconnectedGuideProps {
  onSkip: () => void;
  onStart: () => void;
}

export function UnconnectedGuide({ onSkip, onStart }: UnconnectedGuideProps) {
  const { t } = useTranslation();

  const handleCopyDownloadUrl = useCallback(() => {
    try {
      Clipboard.setString(DOWNLOAD_URL);
      Alert.alert(t('deviceDiscovery.onboarding.unconnected.copyDone'));
    } catch {
      Alert.alert(t('deviceDiscovery.onboarding.unconnected.copyFailed'));
    }
  }, [t]);

  return (
    <View style={styles.overlay} testID="unconnected-guide">
      <View style={styles.backgroundWashTop} pointerEvents="none" />
      <View style={styles.backgroundWashBottom} pointerEvents="none" />
      <TouchableOpacity
        style={styles.skipButton}
        activeOpacity={0.75}
        onPress={onSkip}
      >
        <Text style={styles.skipText}>
          {t('deviceDiscovery.onboarding.unconnected.skip')}
        </Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.heroIcon}>
          <Icon name="desktop-outline" size={28} color="#3b82f6" />
          <Icon name="phone-portrait-outline" size={22} color="#3b82f6" />
        </View>

        <Text style={styles.title}>
          {t('deviceDiscovery.onboarding.unconnected.title')}
        </Text>
        <Text style={styles.subtitle}>
          {t('deviceDiscovery.onboarding.unconnected.subtitle')}
        </Text>

        <View style={styles.stepsRow}>
          <View style={styles.stepsConnector} pointerEvents="none" />
          <GuideStep
            icon="desktop-outline"
            title={t(
              'deviceDiscovery.onboarding.unconnected.downloadStep.title',
            )}
            body={t('deviceDiscovery.onboarding.unconnected.downloadStep.body')}
          />
          <GuideStep
            icon="scan-outline"
            title={t(
              'deviceDiscovery.onboarding.unconnected.connectStep.title',
            )}
            body={t('deviceDiscovery.onboarding.unconnected.connectStep.body')}
          />
          <GuideStep
            icon="flash-outline"
            title={t('deviceDiscovery.onboarding.unconnected.syncStep.title')}
            body={t('deviceDiscovery.onboarding.unconnected.syncStep.body')}
          />
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.urlBox}
          activeOpacity={0.75}
          onPress={handleCopyDownloadUrl}
        >
          <Text style={styles.urlText}>
            {DOWNLOAD_URL.replace('https://', '')}
          </Text>
          <View style={styles.copyButton}>
            <Icon name="link-outline" size={18} color="#3478f6" />
            <Text style={styles.copyText}>
              {t('deviceDiscovery.onboarding.unconnected.copy')}
            </Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.copyHint}>
          {t('deviceDiscovery.onboarding.unconnected.copyHint')}
        </Text>

        <TouchableOpacity
          style={styles.startButton}
          activeOpacity={0.75}
          onPress={onStart}
        >
          <Text style={styles.startText}>
            {t('deviceDiscovery.onboarding.unconnected.start')}
          </Text>
          <Icon name="chevron-forward" size={18} color="#7893ab" />
        </TouchableOpacity>
      </View>
      <Text style={styles.footerNote}>
        {t('deviceDiscovery.onboarding.unconnected.footerNote')}
      </Text>
    </View>
  );
}

function GuideStep({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        <Icon name={icon} size={20} color="#3478f6" />
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: '#dceefa',
    paddingHorizontal: 20,
    paddingTop: 24,
    justifyContent: 'center',
  },
  backgroundWashTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '54%',
    backgroundColor: '#eaf4fb',
  },
  backgroundWashBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '34%',
    backgroundColor: '#f5faff',
  },
  skipButton: {
    position: 'absolute',
    right: 20,
    top: 56,
    zIndex: 1,
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(26,58,92,0.08)',
  },
  skipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5a7a96',
  },
  card: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: 'rgba(255,255,255,0.93)',
    shadowColor: '#0a1e37',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.15,
    shadowRadius: 48,
    elevation: 6,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(59,130,246,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a3a5c',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#7a90a4',
    textAlign: 'center',
  },
  stepsRow: {
    flexDirection: 'row',
    gap: 0,
    marginTop: 20,
    marginBottom: 24,
  },
  stepsConnector: {
    position: 'absolute',
    top: 16,
    left: '16.7%',
    right: '16.7%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(59,130,246,0.18)',
  },
  step: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eef6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a3a5c',
    textAlign: 'center',
  },
  stepBody: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(26,58,92,0.07)',
    marginBottom: 20,
  },
  urlBox: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.7)',
    backgroundColor: 'rgba(241,245,249,0.85)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  urlText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(59,130,246,0.1)',
  },
  copyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563eb',
  },
  copyHint: {
    marginTop: 8,
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
  startButton: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
  },
  startText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7a90a4',
  },
  footerNote: {
    marginTop: 14,
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
});
