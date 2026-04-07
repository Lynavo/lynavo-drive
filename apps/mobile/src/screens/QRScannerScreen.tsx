import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';

function IOSQRScannerScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
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

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

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
            if (ipMatch && codeMatch) {
              ip = ipMatch[1].trim();
              code = codeMatch[1].trim();
              if (nameMatch) deviceName = decodeURIComponent(nameMatch[1]).trim();
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
        <Text style={styles.text}>需要相机权限来扫描二维码</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>未找到相机设备</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>返回</Text>
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
            <Icon name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>扫描配对二维码</Text>
        </View>
        <View style={styles.focusFrame} />
        <View style={styles.footer}>
          <Text style={styles.footerText}>请将二维码放入框内即可自动连接</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function AndroidQRScannerFallback() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

  return (
    <SafeAreaView style={styles.androidFallbackContainer}>
      <View style={styles.androidFallbackCard}>
        <View style={styles.androidFallbackIcon}>
          <Icon name="scan-outline" size={28} color="#3b9fd8" />
        </View>
        <Text style={styles.androidFallbackTitle}>{'Android 暂未提供扫码配对'}</Text>
        <Text style={styles.androidFallbackBody}>
          {
            '当前 Android 基线版本先开放基础桥接与手动配对入口。请返回上一页，使用“手动配对”输入桌面端 IPv4 地址继续。'
          }
        </Text>
        <TouchableOpacity
          style={styles.androidFallbackButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.androidFallbackButtonText}>{'返回手动配对'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export function QRScannerScreen() {
  if (Platform.OS === 'android') {
    return <AndroidQRScannerFallback />;
  }

  return <IOSQRScannerScreen />;
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
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10
  },
  focusFrame: {
    width: 250,
    height: 250,
    alignSelf: 'center',
    borderColor: '#3b9fd8',
    borderWidth: 2,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  footerText: {
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  androidFallbackContainer: {
    flex: 1,
    backgroundColor: '#d6ecf8',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  androidFallbackCard: {
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 16,
  },
  androidFallbackIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#eef6fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidFallbackTitle: {
    color: '#1a3a5c',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  androidFallbackBody: {
    color: '#4a6a8a',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  androidFallbackButton: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#3b9fd8',
  },
  androidFallbackButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
