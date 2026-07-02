import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { GradientBackground } from '../components/GradientBackground';
import { BottomTabBar } from '../components/BottomTabBar';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { recordDiagnosticsLog } from '../services/diagnostics-log-service';

type NavigationProp = StackNavigationProp<RootStackParamList, 'SharedFiles'>;

export function SharedFilesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();

  const openPhoneSyncSpace = () => {
    recordDiagnosticsLog('PhoneSyncSpace', 'entry pressed', {
      screen: 'SharedFilesScreen',
    });
    navigation.navigate('PhoneSyncSpace');
  };

  const openLocalComputer = () => {
    recordDiagnosticsLog('LocalComputer', 'local LAN entry pressed', {
      screen: 'SharedFilesScreen',
    });
    navigation.navigate('LocalComputer');
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('sharedFiles.title') || 'File'}
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
                { backgroundColor: 'rgba(59, 130, 246, 0.08)' },
              ]}
            >
              <Icon name="phone-portrait-outline" size={36} color="#3b82f6" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle}>
                {t('sharedFiles.phoneSyncSpace.title') || 'Phone Sync Space'}
              </Text>
              <Text style={styles.cardDescription}>
                {t('sharedFiles.phoneSyncSpace.desc') ||
                  'View files synced to your computer and their upload sources'}
              </Text>
            </View>
            <Icon name="chevron-forward" size={24} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={openLocalComputer}
          >
            <View
              style={[
                styles.iconWrapper,
                { backgroundColor: 'rgba(139, 92, 246, 0.08)' },
              ]}
            >
              <Icon name="desktop-outline" size={36} color="#8b5cf6" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle}>
                {t('sharedFiles.localComputer.title') || 'Computer Files'}
              </Text>
              <Text style={styles.cardDescription}>
                {t('sharedFiles.localComputer.desc') ||
                  'Browse your computer shared directory and download files'}
              </Text>
            </View>
            <Icon name="chevron-forward" size={24} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      <BottomTabBar activeTab="files" />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 16,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
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
