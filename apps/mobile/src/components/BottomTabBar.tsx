import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

interface BottomTabBarProps {
  activeTab: 'home' | 'files' | 'settings';
}

export function BottomTabBar({ activeTab }: BottomTabBarProps) {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const handleTabPress = (tab: 'home' | 'files' | 'settings') => {
    if (activeTab === tab) return;

    let targetRoute = '';
    if (tab === 'home') targetRoute = 'SyncActivity';
    else if (tab === 'files') targetRoute = 'SharedFiles';
    else if (tab === 'settings') targetRoute = 'Settings';

    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: targetRoute }],
      }),
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => handleTabPress('home')}
        activeOpacity={0.7}
      >
        <Icon
          name="home-outline"
          size={22}
          color={activeTab === 'home' ? '#1A3A5C' : '#5A7A96'}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'home' && styles.activeTabLabel,
          ]}
        >
          {t('common.tabs.home') || 'Home'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => handleTabPress('files')}
        activeOpacity={0.7}
      >
        <Icon
          name="desktop-outline"
          size={22}
          color={activeTab === 'files' ? '#1A3A5C' : '#5A7A96'}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'files' && styles.activeTabLabel,
          ]}
        >
          {t('common.tabs.files') || 'Computer Files'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => handleTabPress('settings')}
        activeOpacity={0.7}
      >
        <Icon
          name="person-outline"
          size={22}
          color={activeTab === 'settings' ? '#1A3A5C' : '#5A7A96'}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'settings' && styles.activeTabLabel,
          ]}
        >
          {t('common.tabs.settings') || 'Me'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: 'rgba(56, 92, 128, 0.12)',
    backgroundColor: '#DCEEFE',
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    paddingHorizontal: 16,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#5A7A96',
    marginTop: 4,
  },
  activeTabLabel: {
    color: '#1A3A5C',
    fontWeight: '600',
  },
});
