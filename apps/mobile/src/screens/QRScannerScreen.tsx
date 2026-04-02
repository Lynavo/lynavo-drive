import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import type { Code } from 'react-native-vision-camera';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';

export function QRScannerScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const [hasPermission, setHasPermission] = useState(false);
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
    onCodeScanned: (codes: Code[]) => {
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
  }
});
