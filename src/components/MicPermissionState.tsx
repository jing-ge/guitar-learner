/**
 * 统一的麦克风权限状态卡片。
 * - idle / granted: 不渲染
 * - requesting: 青色卡片 + loader
 * - denied / error: 红色卡片 + 平台特定恢复步骤 + 重试按钮
 */
export type MicPermState = 'idle' | 'requesting' | 'granted' | 'denied' | 'error';

interface Props {
  state: MicPermState;
  onRetry?: () => void;
}

function getDeniedSteps(): string {
  if (typeof navigator === 'undefined') return '请在浏览器设置中允许麦克风权限，然后重试。';
  const ua = navigator.userAgent || '';
  const isIOSSafari = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const isAndroid = /Android/.test(ua);
  if (isIOSSafari) {
    return '去 设置 → Safari → 麦克风 → 允许，然后回到本页面重试。';
  }
  if (isAndroid) {
    return '点击地址栏左侧的 🔒，找到 麦克风，改为允许，刷新页面。';
  }
  return '点击地址栏的 🔒 → 网站设置 → 麦克风 → 允许。';
}

export default function MicPermissionState({ state, onRetry }: Props) {
  if (state === 'idle' || state === 'granted') return null;

  if (state === 'requesting') {
    return (
      <div className="mic-perm requesting">
        <div className="mic-perm-icon">🎙️</div>
        <div style={{ flex: 1 }}>
          <p className="mic-perm-title">请求麦克风权限…</p>
          <p className="mic-perm-body">浏览器弹窗中点击允许</p>
        </div>
        <div className="mic-perm-loader" aria-hidden="true" />
      </div>
    );
  }

  const isDenied = state === 'denied';
  const titleText = isDenied ? '麦克风权限被拒绝' : '麦克风启动失败';
  const body = isDenied
    ? getDeniedSteps()
    : '可能被其他应用占用，或浏览器不支持。';

  return (
    <div className={'mic-perm ' + state}>
      <div className="mic-perm-icon">{isDenied ? '🚫' : '⚠️'}</div>
      <div style={{ flex: 1 }}>
        <p className={'mic-perm-title ' + state}>{titleText}</p>
        <p className="mic-perm-body">{body}</p>
        {onRetry && (
          <button className="btn btn-sm" onClick={onRetry}>
            {isDenied ? '再试一次' : '重试'}
          </button>
        )}
      </div>
    </div>
  );
}
