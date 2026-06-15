import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { NativeModules } from 'react-native';

import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import { GradientBackground } from '../components/GradientBackground';
import { BottomTabBar } from '../components/BottomTabBar';
import { enableAutoUpload } from '../services/SyncEngineModule';

type AutoUploadRange = 'all' | 'now' | 'custom';

interface MockFile {
  name: string;
  size: number;
}

const BLUE = '#3B9FD8';
const DARK = '#1A3A5C';

export function AutoUploadSettingsScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [albumEnabled, setAlbumEnabled] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<MockFile[]>([]);
  const [uploadRange, setUploadRange] = useState<AutoUploadRange>('all');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const fileSourceSelected = selectedFiles.length > 0;
  const canConfirm = albumEnabled || fileSourceSelected;

  const handleAddMockFile = () => {
    const mockFileNames = [
      'ViviDrop_Readme.pdf',
      'SyncFlow_Overview.docx',
      'SyncFlow_Logo.png',
      'Vacation_Photo.jpg',
      'Project_Spec.pdf',
    ];
    const randomName =
      mockFileNames[Math.floor(Math.random() * mockFileNames.length)];
    const randomSize =
      Math.floor(Math.random() * 10 * 1024 * 1024) + 100 * 1024; // 100KB - 10MB
    setSelectedFiles(prev => [...prev, { name: randomName, size: randomSize }]);
  };

  const handleClearFiles = () => {
    setSelectedFiles([]);
  };

  const formatFileSize = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
  };

  const handleRangeSelect = (range: AutoUploadRange) => {
    setUploadRange(range);
    if (range === 'custom') {
      setTempDate(customDate);
      setShowDatePicker(true);
    }
  };

  const handleDateChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && selectedDate) {
        setCustomDate(selectedDate);
      }
    } else if (selectedDate) {
      setTempDate(selectedDate);
    }
  };

  const handleConfirmDatePicker = () => {
    setCustomDate(tempDate);
    setShowDatePicker(false);
  };

  const handleConfirmSettings = async () => {
    if (!canConfirm) return;
    try {
      // Call native auto upload activation
      await enableAutoUpload();

      Alert.alert(
        t('common.confirm') || '確認',
        t('syncActivity.badges.autoEnabled') || '自動上傳已開啟',
        [
          {
            text: t('common.ok') || '好',
            onPress: () => {
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'SyncActivity' }],
                }),
              );
            },
          },
        ],
      );
    } catch (e) {
      console.warn('[AutoUploadSettings] enableAutoUpload failed:', e);
      Alert.alert(
        t('syncActivity.dialogs.enableAutoFailed.title') || '操作失敗',
        t('syncActivity.dialogs.enableAutoFailed.body') ||
          '無法開啟自動上傳，請稍後重試',
      );
    }
  };

  // Render dynamic explanation sentence
  const renderInfoText = () => {
    const fileCount = selectedFiles.length;
    if (albumEnabled && fileSourceSelected) {
      if (uploadRange === 'all') {
        return (
          t('syncActivity.autoUploadSettings.infoAlbumAndFileAll', {
            count: fileCount,
          }) || `所有照片、影片和已選擇的 ${fileCount} 個檔案將上傳到您的電腦。`
        );
      } else if (uploadRange === 'now') {
        return (
          t('syncActivity.autoUploadSettings.infoAlbumAndFileNow', {
            count: fileCount,
          }) ||
          `從現在開始，新的照片、影片和已選擇的 ${fileCount} 個檔案將同步。`
        );
      } else {
        return (
          t('syncActivity.autoUploadSettings.infoAlbumAndFileCustom', {
            count: fileCount,
          }) ||
          `所選範圍內的照片、影片和已選擇的 ${fileCount} 個檔案將上傳到您的電腦。`
        );
      }
    } else if (albumEnabled) {
      if (uploadRange === 'all') {
        return (
          t('syncActivity.autoUploadSettings.infoAlbumAll') ||
          '相簿中的所有照片和影片將上傳到您的電腦。'
        );
      } else if (uploadRange === 'now') {
        return (
          t('syncActivity.autoUploadSettings.infoAlbumNow') ||
          '從現在開始，新的相簿照片和影片將同步。'
        );
      } else {
        return (
          t('syncActivity.autoUploadSettings.infoAlbumCustom') ||
          '所選範圍內的相簿照片和影片將上傳到您的電腦。'
        );
      }
    } else if (fileSourceSelected) {
      if (uploadRange === 'all') {
        return (
          t('syncActivity.autoUploadSettings.infoFileAll', {
            count: fileCount,
          }) || `已選擇的 ${fileCount} 個檔案將上傳到您的電腦。`
        );
      } else if (uploadRange === 'now') {
        return (
          t('syncActivity.autoUploadSettings.infoFileNow', {
            count: fileCount,
          }) || `從現在開始，已選擇的 ${fileCount} 個檔案將同步。`
        );
      } else {
        return (
          t('syncActivity.autoUploadSettings.infoFileCustom', {
            count: fileCount,
          }) || `所選範圍內已選擇的 ${fileCount} 個檔案將上傳到您的電腦。`
        );
      }
    } else {
      return (
        t('syncActivity.autoUploadSettings.infoEmpty') ||
        '請至少選擇一個同步來源。'
      );
    }
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => navigation.goBack()}
          >
            <Icon name="chevron-back" size={20} color={DARK} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('syncActivity.autoUploadSettings.title') || '自動上傳'}
          </Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Synchronize Source */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('syncActivity.autoUploadSettings.sourcesTitle') ||
                '選擇同步來源'}
            </Text>
            <View style={styles.cardContainer}>
              {/* Option 1: Album */}
              <TouchableOpacity
                style={[
                  styles.optionRow,
                  albumEnabled && styles.optionRowActive,
                ]}
                activeOpacity={0.8}
                onPress={() => setAlbumEnabled(!albumEnabled)}
              >
                <View
                  style={[
                    styles.iconBox,
                    albumEnabled
                      ? styles.iconBoxActive
                      : styles.iconBoxInactive,
                  ]}
                >
                  <Icon
                    name="image-outline"
                    size={15}
                    color={albumEnabled ? '#fff' : '#8AABBD'}
                  />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>
                    {t('syncActivity.autoUploadSettings.sourceAlbumTitle') ||
                      '1. 從相簿同步'}
                  </Text>
                  <Text style={styles.optionDesc}>
                    {t('syncActivity.autoUploadSettings.sourceAlbumDesc') ||
                      '照片或影片'}
                  </Text>
                </View>
                {albumEnabled && (
                  <View style={styles.checkCircle}>
                    <Icon name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Option 2: Files */}
              <View
                style={[
                  styles.optionContainer,
                  fileSourceSelected && styles.optionRowActive,
                ]}
              >
                <View style={styles.optionRowHeader}>
                  <View
                    style={[
                      styles.iconBox,
                      fileSourceSelected
                        ? styles.iconBoxActive
                        : styles.iconBoxInactive,
                    ]}
                  >
                    <Icon
                      name="document-outline"
                      size={15}
                      color={fileSourceSelected ? '#fff' : '#8AABBD'}
                    />
                  </View>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>
                      {t('syncActivity.autoUploadSettings.sourceFileTitle') ||
                        '2. 從檔案同步'}
                    </Text>
                    <Text style={styles.optionDesc}>
                      {fileSourceSelected
                        ? t(
                            'syncActivity.autoUploadSettings.sourceFileDescSelected',
                            { count: selectedFiles.length },
                          ) || `已選擇 ${selectedFiles.length} 個檔案`
                        : t(
                            'syncActivity.autoUploadSettings.sourceFileDescEmpty',
                          ) || '從系統檔案中選擇需要上傳的檔案'}
                    </Text>
                  </View>
                  {fileSourceSelected && (
                    <View style={styles.checkCircle}>
                      <Icon name="checkmark" size={12} color="#fff" />
                    </View>
                  )}
                </View>

                {/* Add files action */}
                <View style={styles.fileActionRow}>
                  <TouchableOpacity
                    style={styles.addFileButton}
                    activeOpacity={0.8}
                    onPress={handleAddMockFile}
                  >
                    <Text style={styles.addFileButtonText}>
                      {t('syncActivity.autoUploadSettings.addFile') ||
                        '新增檔案'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Selected Files Preview List */}
                {fileSourceSelected && (
                  <View style={styles.filesPreviewCard}>
                    <View style={styles.previewHeader}>
                      <Text style={styles.previewHeaderTitle}>
                        {t(
                          'syncActivity.autoUploadSettings.addedFilesSummary',
                          { count: selectedFiles.length },
                        ) || `已新增 ${selectedFiles.length} 個檔案`}
                      </Text>
                      <TouchableOpacity
                        activeOpacity={0.6}
                        onPress={handleClearFiles}
                      >
                        <Text style={styles.clearButtonText}>
                          {t('syncActivity.autoUploadSettings.clearFiles') ||
                            '清空'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.previewList}>
                      {selectedFiles.slice(0, 2).map((file, index) => (
                        <View key={index} style={styles.previewItem}>
                          <Icon
                            name="document-outline"
                            size={14}
                            color="#1D4ED8"
                          />
                          <Text
                            style={styles.previewItemName}
                            numberOfLines={1}
                          >
                            {file.name}
                          </Text>
                          <Text style={styles.previewItemSize}>
                            {formatFileSize(file.size)}
                          </Text>
                        </View>
                      ))}
                      {selectedFiles.length > 2 && (
                        <Text style={styles.previewMoreText}>
                          {t('syncActivity.autoUploadSettings.addedFilesMore', {
                            count: selectedFiles.length - 2,
                          }) || `另有 ${selectedFiles.length - 2} 個檔案`}
                        </Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Upload Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('syncActivity.autoUploadSettings.rangeTitle') || '上傳範圍'}
            </Text>
            <View style={styles.cardContainer}>
              {/* Option: All */}
              <TouchableOpacity
                style={styles.optionRow}
                activeOpacity={0.8}
                onPress={() => handleRangeSelect('all')}
              >
                <View
                  style={[
                    styles.iconBox,
                    uploadRange === 'all'
                      ? styles.iconBoxActive
                      : styles.iconBoxInactive,
                  ]}
                >
                  <Icon
                    name="folder-outline"
                    size={14}
                    color={uploadRange === 'all' ? '#fff' : '#8AABBD'}
                  />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>
                    {t('syncActivity.autoUploadSettings.rangeAllTitle') ||
                      '全部'}
                  </Text>
                  <Text style={styles.optionDesc}>
                    {t('syncActivity.autoUploadSettings.rangeAllDesc') ||
                      '上傳現有所有照片和影片'}
                  </Text>
                </View>
                {uploadRange === 'all' && (
                  <View style={styles.checkCircle}>
                    <Icon name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Option: Now */}
              <TouchableOpacity
                style={styles.optionRow}
                activeOpacity={0.8}
                onPress={() => handleRangeSelect('now')}
              >
                <View
                  style={[
                    styles.iconBox,
                    uploadRange === 'now'
                      ? styles.iconBoxActive
                      : styles.iconBoxInactive,
                  ]}
                >
                  <Icon
                    name="time-outline"
                    size={14}
                    color={uploadRange === 'now' ? '#fff' : '#8AABBD'}
                  />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>
                    {t('syncActivity.autoUploadSettings.rangeNowTitle') ||
                      '從現在開始'}
                  </Text>
                  <Text style={styles.optionDesc}>
                    {t('syncActivity.autoUploadSettings.rangeNowDesc') ||
                      '僅同步從現在開始的新照片和影片'}
                  </Text>
                </View>
                {uploadRange === 'now' && (
                  <View style={styles.checkCircle}>
                    <Icon name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Option: Custom */}
              <TouchableOpacity
                style={styles.optionRow}
                activeOpacity={0.8}
                onPress={() => handleRangeSelect('custom')}
              >
                <View
                  style={[
                    styles.iconBox,
                    uploadRange === 'custom'
                      ? styles.iconBoxActive
                      : styles.iconBoxInactive,
                  ]}
                >
                  <Icon
                    name="calendar-outline"
                    size={14}
                    color={uploadRange === 'custom' ? '#fff' : '#8AABBD'}
                  />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>
                    {t('syncActivity.autoUploadSettings.rangeCustomTitle') ||
                      '自定義範圍'}
                  </Text>
                  <Text style={styles.optionDesc}>
                    {uploadRange === 'custom'
                      ? customDate.toLocaleString()
                      : t('syncActivity.autoUploadSettings.rangeCustomDesc') ||
                        '選擇特定日期範圍'}
                  </Text>
                </View>
                {uploadRange === 'custom' ? (
                  <View style={styles.checkCircle}>
                    <Icon name="checkmark" size={12} color="#fff" />
                  </View>
                ) : (
                  <Icon name="chevron-forward" size={14} color="#8aabbd" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>{renderInfoText()}</Text>
          </View>

          {/* Confirm Button */}
          <TouchableOpacity
            style={[
              styles.confirmButton,
              !canConfirm && styles.confirmButtonDisabled,
            ]}
            activeOpacity={0.8}
            disabled={!canConfirm}
            onPress={handleConfirmSettings}
          >
            <Text style={styles.confirmButtonText}>
              {t('common.confirm') || '確認'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      {/* Date Picker Modal for iOS / Modal structure for Android */}
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" visible={showDatePicker}>
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => setShowDatePicker(false)}
                >
                  <Text style={styles.pickerCancelText}>
                    {t('common.cancel') || '取消'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={handleConfirmDatePicker}
                >
                  <Text style={styles.pickerConfirmText}>
                    {t('syncActivity.autoUploadSettings.customPickerSave') ||
                      '儲存'}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="datetime"
                display="spinner"
                onChange={handleDateChange}
                style={styles.datePicker}
              />
            </View>
          </View>
        </Modal>
      )}

      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={customDate}
          mode="datetime"
          display="default"
          onChange={handleDateChange}
        />
      )}

      <BottomTabBar activeTab="home" />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(56, 92, 128, 0.12)',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginLeft: 12,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8AABBD',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  cardContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  optionRowActive: {
    backgroundColor: '#EAF2FF',
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBoxActive: {
    backgroundColor: '#1D4ED8',
  },
  iconBoxInactive: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  optionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  optionDesc: {
    fontSize: 12,
    color: '#5A7A96',
    marginTop: 2,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1D4ED8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionContainer: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    padding: 16,
  },
  optionRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileActionRow: {
    marginTop: 10,
    paddingLeft: 44,
  },
  addFileButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  addFileButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  filesPreviewCard: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.03)',
    paddingBottom: 6,
  },
  previewHeaderTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#203D63',
  },
  clearButtonText: {
    fontSize: 11,
    color: '#8AABBD',
    fontWeight: '500',
  },
  previewList: {
    gap: 6,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewItemName: {
    flex: 1,
    fontSize: 11,
    color: '#5A7A96',
  },
  previewItemSize: {
    fontSize: 11,
    color: '#8AABBD',
  },
  previewMoreText: {
    fontSize: 11,
    color: '#8AABBD',
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: '#EAF2FF',
    borderWidth: 1,
    borderColor: '#BFD3F8',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#2A4F96',
  },
  confirmButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  confirmButtonDisabled: {
    backgroundColor: '#A8B6CC',
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Date Picker iOS styles
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  pickerCancelText: {
    fontSize: 15,
    color: '#718096',
  },
  pickerConfirmText: {
    fontSize: 15,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  datePicker: {
    height: 200,
    width: '100%',
  },
});
