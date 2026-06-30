import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { GlobalBottomTabBar } from '../components/GlobalBottomTabBar';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { recordDiagnosticsLog } from '../services/diagnostics-log-service';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';

type NavigationProp = StackNavigationProp<RootStackParamList, 'SharedFiles'>;

interface SharedFilesGlobalScreenProps {
  showBottomTabBar?: boolean;
}

export function SharedFilesGlobalScreen({
  showBottomTabBar = true,
}: SharedFilesGlobalScreenProps) {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const translate = t as (key: string) => string;

  const openPhoneSyncSpace = () => {
    recordDiagnosticsLog('PhoneSyncSpace', 'entry pressed', {
      screen: 'SharedFilesGlobalScreen',
    });
    navigation.navigate('PhoneSyncSpace');
  };

  const openRemoteAccess = () => {
    recordDiagnosticsLog('RemoteAccess', 'local LAN entry pressed', {
      screen: 'SharedFilesGlobalScreen',
    });
    navigation.navigate('RemoteAccess');
  };
  const remoteAccessDescription = translateOrFallback(
    translate,
    'sharedFiles.remoteAccess.ossDesc',
    'Access paired computer files on the same local network.',
  );
  const remoteAccessBadge = translateOrFallback(
    translate,
    'sharedFiles.remoteAccess.ossBadge',
    'LAN',
  );

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('sharedFiles.title') || '遠端資源'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {t('sharedFiles.headerSubtitle')}
          </Text>
        </View>

        <View style={styles.cardContainer}>
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={openPhoneSyncSpace}
          >
            <View
              style={[
                styles.iconWrapper,
                { backgroundColor: 'rgba(59, 130, 246, 0.10)' },
              ]}
            >
              <Icon name="phone-portrait-outline" size={24} color="#3B82F6" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle}>
                {t('sharedFiles.phoneSyncSpace.title') || '手機同步空間'}
              </Text>
              <Text style={styles.cardDescription}>
                {t('sharedFiles.phoneSyncSpace.desc') ||
                  '檢視已同步至電腦的檔案與上傳來源'}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {t('sharedFiles.phoneSyncSpace.badgeSync')}
                  </Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {t('sharedFiles.phoneSyncSpace.badgeSource')}
                  </Text>
                </View>
              </View>
            </View>
            <Icon name="chevron-forward" size={20} color="#C7C7CC" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={openRemoteAccess}
          >
            <View
              style={[
                styles.iconWrapper,
                { backgroundColor: 'rgba(139, 92, 246, 0.10)' },
              ]}
            >
              <Icon name="desktop-outline" size={24} color="#8B5CF6" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle}>
                {t('sharedFiles.remoteAccess.title') || '遠端訪問電腦'}
              </Text>
              <Text style={styles.cardDescription}>
                {remoteAccessDescription}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {t('sharedFiles.remoteAccess.badgeDesktop')}
                  </Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{remoteAccessBadge}</Text>
                </View>
              </View>
            </View>
            <Icon name="chevron-forward" size={20} color="#C7C7CC" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      {showBottomTabBar ? <GlobalBottomTabBar activeTab="files" /> : null}
    </GlobalGradientBackground>
  );
}

function translateOrFallback(
  t: (key: string) => string,
  key: string,
  fallback: string,
) {
  const value = t(key);
  return typeof value === 'string' && value.trim().length > 0 && value !== key
    ? value
    : fallback;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.foreground,
    letterSpacing: 0,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 20,
    color: '#59616D',
  },
  cardContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
    elevation: 6,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 52,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  iconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 16,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.foreground,
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 12,
    color: '#59616D',
    lineHeight: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#7B8490',
  },
});

export function normalizeDirectoryPath(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  if (p.startsWith('/')) {
    p = p.substring(1);
  }
  if (p.endsWith('/')) {
    p = p.substring(0, p.length - 1);
  }
  return p;
}

export function parentDirectoryPath(path: string): string {
  const normalized = normalizeDirectoryPath(path);
  if (!normalized) return '';
  const parts = normalized.split('/');
  if (parts.length <= 1) return '';
  parts.pop();
  return parts.join('/');
}
