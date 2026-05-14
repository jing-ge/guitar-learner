/**
 * Expo Config Plugin: 把 assets/web/ 目录复制到 android/app/src/main/assets/web/
 * 这样 WebView 就能通过 file:///android_asset/web/index.html 访问
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = function withCopyWebAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, 'assets', 'web');
      const dest = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'assets', 'web'
      );
      console.log('[copy-web-assets] Copying web files to android assets...');
      copyDirSync(src, dest);
      console.log('[copy-web-assets] Done');
      return config;
    },
  ]);
};