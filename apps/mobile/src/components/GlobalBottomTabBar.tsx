import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Home, User } from 'lucide-react-native';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';

const SIDE_INSET = 16;
const BOTTOM_GAP = 16;

interface GlobalBottomTabBarProps {
  activeTab: 'home' | 'files' | 'settings';
  onTabPress?: (tab: 'home' | 'files' | 'settings') => void;
}

export function GlobalBottomTabBar({
  activeTab,
  onTabPress,
}: GlobalBottomTabBarProps) {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const handleTabPress = (tab: 'home' | 'files' | 'settings') => {
    if (activeTab === tab) return;
    if (onTabPress) {
      onTabPress(tab);
      return;
    }

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
    <View
      pointerEvents="box-none"
      testID="global-bottom-tab-bar-outer"
      style={styles.outer}
    >
      <View testID="global-bottom-tab-bar-container" style={styles.container}>
        <TouchableOpacity
          testID="global-bottom-tab-home"
          style={[
            styles.tabButton,
            activeTab === 'home' && styles.activeTabButton,
          ]}
          onPress={() => handleTabPress('home')}
          activeOpacity={0.7}
        >
          <Home
            testID="global-bottom-tab-home-icon"
            size={22}
            color={
              activeTab === 'home' ? colors.primary : colors.mutedForeground
            }
            strokeWidth={activeTab === 'home' ? 2.2 : 1.9}
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
          testID="global-bottom-tab-files"
          style={[
            styles.tabButton,
            activeTab === 'files' && styles.activeTabButton,
          ]}
          onPress={() => handleTabPress('files')}
          activeOpacity={0.7}
        >
          <FolderOpen
            testID="global-bottom-tab-files-icon"
            size={22}
            color={
              activeTab === 'files' ? colors.primary : colors.mutedForeground
            }
            strokeWidth={activeTab === 'files' ? 2.2 : 1.9}
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
          testID="global-bottom-tab-settings"
          style={[
            styles.tabButton,
            activeTab === 'settings' && styles.activeTabButton,
          ]}
          onPress={() => handleTabPress('settings')}
          activeOpacity={0.7}
        >
          <User
            testID="global-bottom-tab-settings-icon"
            size={22}
            color={
              activeTab === 'settings' ? colors.primary : colors.mutedForeground
            }
            strokeWidth={activeTab === 'settings' ? 2.2 : 1.9}
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
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flexShrink: 0,
    marginHorizontal: SIDE_INSET,
    marginBottom: BOTTOM_GAP,
    zIndex: 40,
    backgroundColor: 'transparent',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F7FBFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    padding: 6,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.14,
    shadowRadius: 48,
    elevation: 8,
    ...androidBoxShadow({
      offsetY: 20,
      blurRadius: 48,
      color: 'rgba(70, 96, 138, 0.14)',
    }),
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 54,
    borderRadius: 17,
  },
  activeTabButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.mutedForeground,
    marginTop: 2,
  },
  activeTabLabel: {
    color: colors.foreground,
  },
});
