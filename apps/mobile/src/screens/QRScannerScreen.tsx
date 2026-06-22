import React, { useEffect, useState, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

function CameraQRScannerScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState(false);
  const {
    Camera,
    useCameraDevice,
    useCodeScanner,
  } = require('react-native-vision-camera') as typeof import('react-native-vision-camera');
  const device = useCameraDevice('back');
  // Use a ref instead of state so that the onCodeScanned callback (fired on a
  // native thread) always reads the latest value rather than a stale closure.
  const scannedRef = useRef(false);
  const scanLineProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineProgress, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineProgress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [scanLineProgress]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (
      codes: Array<{
        value?: string | null;
      }>,
    ) => {
      if (scannedRef.current) return;
      if (codes.length > 0) {
        const value = codes[0].value;
        if (value) {
          let isValid = false;
          let ip = '';
          let code = '';
          let deviceName = 'Desktop Device';

          try {
            // First try to parse as JSON from desktop app
            const parsed = JSON.parse(value);
            if (parsed.ip && parsed.code) {
              ip = String(parsed.ip).trim();
              code = String(parsed.code).trim();
              if (parsed.name) deviceName = String(parsed.name).trim();
              isValid = true;
            }
          } catch {
            // Fallback to URI match (e.g. syncflow://pair?ip=...&code=...)
            const ipMatch = value.match(/ip=([^&"]+)/);
            const codeMatch = value.match(/code=([^&"]+)/);
            const nameMatch = value.match(/name=([^&"]+)/);
            const deviceMatch = value.match(/device=([^&"]+)/);
            if (ipMatch && codeMatch) {
              ip = decodeURIComponent(ipMatch[1]).trim();
              code = decodeURIComponent(codeMatch[1]).trim();
              const displayNameMatch = nameMatch || deviceMatch;
              if (displayNameMatch)
                deviceName = decodeURIComponent(displayNameMatch[1]).trim();
              isValid = true;
            }
          }

          if (isValid && ip && code) {
            console.log('[QRScanner] parsed QR — ip:', ip, 'code:', code, 'name:', deviceName);
            // Immediately mark as scanned via ref to block all further callbacks
            scannedRef.current = true;
            // Delay slightly to allow camera viewfinder to settle before navigating
            setTimeout(() => {
              navigation.replace('CodeVerify', {
                deviceId: `qr-${ip.replace(/\./g, '-')}`,
                host: ip,
                port: 39393,
                deviceName,
                prefilledCode: code
              });
            }, 200);
          }
        }
      }
    }
  });

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('qrScanner.permissionDenied.text')}</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('qrScanner.noCameraDevice')}</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!scannedRef.current}
        codeScanner={codeScanner}
      />
      <View style={styles.overlay}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('qrScanner.title')}</Text>
        </View>

        <View style={styles.scannerContent}>
          <View style={styles.focusFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
            <Animated.View
              style={[
                styles.scanLine,
                {
                  transform: [
                    {
                      translateY: scanLineProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [16, 216],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
          <Text style={styles.scanInstructionPill}>{t('qrScanner.instruction')}</Text>

          <View style={styles.qrGuideCard}>
            <View style={styles.qrGuideIcon}>
              <Icon name="desktop-outline" size={18} color="#7dd3fc" />
            </View>
            <View style={styles.qrGuideCopy}>
              <Text style={styles.qrGuideTitle}>{t('qrScanner.guide.title')}</Text>
              <Text style={styles.qrGuideBody}>{t('qrScanner.guide.body')}</Text>
              <TouchableOpacity
                style={styles.qrGuideAction}
                activeOpacity={0.72}
                onPress={() => navigation.navigate('ConnectionTutorial')}
              >
                <Text style={styles.qrGuideActionText}>
                  {t('qrScanner.guide.cta')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={styles.scanTroubleButton}
            activeOpacity={0.78}
            onPress={() => navigation.goBack()}
          >
            <View style={styles.scanTroubleCopy}>
              <Text style={styles.scanTroubleTitle}>{t('qrScanner.trouble.title')}</Text>
              <Text style={styles.scanTroubleBody}>{t('qrScanner.trouble.body')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color="rgba(255,255,255,0.32)" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

export function QRScannerScreen() {
  return <CameraQRScannerScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#3b9fd8',
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5,9,15,0.46)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backButton: {
    width: 38,
    height: 38,
    marginRight: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  scannerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  focusFrame: {
    width: 240,
    height: 240,
    alignSelf: 'center',
    borderRadius: 28,
    backgroundColor: 'rgba(13,17,23,0.26)',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderColor: '#3b9fd8',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 28,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 28,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 28,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 28,
  },
  scanLine: {
    position: 'absolute',
    left: 18,
    right: 18,
    height: 2,
    backgroundColor: '#7dd3fc',
    shadowColor: '#7dd3fc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
  scanInstructionPill: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  qrGuideCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
  },
  qrGuideIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(59,159,216,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59,159,216,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrGuideCopy: {
    flex: 1,
    minWidth: 0,
  },
  qrGuideTitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
  },
  qrGuideBody: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 12,
    lineHeight: 18,
  },
  qrGuideAction: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  qrGuideActionText: {
    color: 'rgba(125,211,252,0.92)',
    fontSize: 12,
    fontWeight: '700',
  },
  scanTroubleButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  scanTroubleCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  scanTroubleTitle: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    fontWeight: '600',
  },
  scanTroubleBody: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    lineHeight: 17,
  },
});
