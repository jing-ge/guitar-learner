import { useEffect, useRef } from 'react';
import { StyleSheet, View, Platform, BackHandler } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';

/**
 * WebView 加载本地 web 应用
 * Android: file:///android_asset/web/index.html（通过 config plugin 复制到此位置）
 */
const SOURCE = Platform.OS === 'android'
  ? { uri: 'file:///android_asset/web/index.html' }
  : { uri: 'file:///web/index.html' }; // iOS 暂不处理

export default function Index() {
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();

  // 初始化安卓沉浸式底部导航栏和系统UI
  useEffect(() => {
    if (Platform.OS === 'android') {
      SystemUI.setBackgroundColorAsync('#0f1419');
      NavigationBar.setBackgroundColorAsync('#0f1419');
      NavigationBar.setButtonStyleAsync('light');
      // 可选：如果想做到真正的沉浸式（让 WebView 延伸到导航栏下方），可以设置下面这行
      // 但由于 Web 端的 SafeArea 底部已经被遮挡，这里直接把导航栏背景改为深色通常就足够解决了
      NavigationBar.setPositionAsync('absolute');
      NavigationBar.setBackgroundColorAsync('transparent');
    }
  }, []);

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

  return (
    // Round 65.2: paddingTop = insets.top 让 WebView 从状态栏下方开始
    // (Android WebView 的 env(safe-area-inset-top) 默认 0, 无法靠 web CSS 解决)
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
        containerStyle={{ backgroundColor: '#0f1419' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1419' },
  webview: { flex: 1 },
});