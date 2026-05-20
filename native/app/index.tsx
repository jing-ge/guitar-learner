import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Platform, BackHandler } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { setStatusBarBackgroundColor, setStatusBarStyle } from 'expo-status-bar';

/**
 * WebView 加载本地 web 应用
 * Android: file:///android_asset/web/index.html（通过 config plugin 复制到此位置）
 */
const SOURCE = Platform.OS === 'android'
  ? { uri: 'file:///android_asset/web/index.html' }
  : { uri: 'file:///web/index.html' }; // iOS 暂不处理

type Theme = 'dark' | 'light';
const CHROME: Record<Theme, string> = { dark: '#0f1419', light: '#ffffff' };

export default function Index() {
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const [theme, setTheme] = useState<Theme>('dark');

  // 初始化安卓沉浸式底部导航栏和系统UI (默认深色)
  useEffect(() => {
    if (Platform.OS === 'android') {
      SystemUI.setBackgroundColorAsync('#0f1419');
      NavigationBar.setBackgroundColorAsync('#0f1419');
      NavigationBar.setButtonStyleAsync('light');
      NavigationBar.setPositionAsync('absolute');
      NavigationBar.setBackgroundColorAsync('transparent');
    }
  }, []);

  // Round 66: 主题切换 → status bar / nav bar / 容器底色 一起换
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const chrome = CHROME[theme];
    SystemUI.setBackgroundColorAsync(chrome);
    NavigationBar.setBackgroundColorAsync(chrome);
    NavigationBar.setButtonStyleAsync(theme === 'dark' ? 'light' : 'dark');
    setStatusBarBackgroundColor(chrome, false);
    setStatusBarStyle(theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg && msg.type === 'theme' && (msg.theme === 'dark' || msg.theme === 'light')) {
        setTheme(msg.theme);
      }
    } catch {}
  };

  // Android 返回键 → WebView 后退
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = () => {
      if (webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, []);

  const chrome = CHROME[theme];
  return (
    // Round 65.2: paddingTop = insets.top 让 WebView 从状态栏下方开始
    // Round 66: 容器底色跟随主题, 避免浅色主题下顶/底露出深色边
    <View style={[styles.container, { backgroundColor: chrome, paddingTop: insets.top }]}>
      <WebView
        ref={webViewRef}
        source={SOURCE}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        originWhitelist={['*']}
        mediaCapturePermissionGrantType="grant"
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        containerStyle={{ backgroundColor: chrome }}
        onMessage={onMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1419' },
  webview: { flex: 1 },
});