import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { Icon } from '../components/Icon';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';

type NavigationProp = StackNavigationProp<RootStackParamList, 'OpenSourceInfo'>;

export function OpenSourceInfoScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            activeOpacity={0.72}
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
                return;
              }
              navigation.navigate('SyncActivity');
            }}
          >
            <Icon name="chevron-back" size={20} color="#17191C" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.iconBox}>
            <Icon name="git-network-outline" size={30} color="#1677D2" />
          </View>
          <Text style={styles.title}>{t('oss.title')}</Text>
          <Text style={styles.body}>{t('oss.body')}</Text>

          <View style={styles.points}>
            <InfoPoint text={t('oss.pointLan')} />
            <InfoPoint text={t('oss.pointNoStore')} />
            <InfoPoint text={t('oss.pointServices')} />
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            accessibilityRole="button"
            activeOpacity={0.76}
            onPress={() => navigation.navigate('DeviceDiscovery')}
          >
            <Text style={styles.primaryButtonText}>{t('oss.primary')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            accessibilityRole="button"
            activeOpacity={0.72}
            onPress={() => navigation.navigate('SyncActivity')}
          >
            <Text style={styles.secondaryButtonText}>{t('oss.secondary')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </GlobalGradientBackground>
  );
}

function InfoPoint({ text }: { text: string }) {
  return (
    <View style={styles.pointRow}>
      <View style={styles.pointDot} />
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.64)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 80,
  },
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,119,210,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: colors.foreground,
  },
  body: {
    marginTop: 14,
    fontSize: 15,
    lineHeight: 24,
    color: '#59616D',
  },
  points: {
    marginTop: 24,
    gap: 12,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pointDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginTop: 8,
    backgroundColor: '#1677D2',
  },
  pointText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 22,
    color: '#3F4A58',
  },
  primaryButton: {
    minHeight: 50,
    marginTop: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1677D2',
    shadowColor: '#1677D2',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 4,
    ...androidBoxShadow({
      offsetY: 14,
      blurRadius: 18,
      color: 'rgba(22, 119, 210, 0.18)',
    }),
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.74)',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3F4A58',
  },
});
