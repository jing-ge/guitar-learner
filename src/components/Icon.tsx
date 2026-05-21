/**
 * 内联 SVG 图标库 — 零依赖、APK 离线兼容
 *
 * 24×24 viewBox, currentColor 描边, 1.75 默认 stroke-width
 * 标准用法: <Icon name="home" size={22} />
 *
 * 选用 stroke-only 风格 (类似 lucide / phosphor 线性) — 在小尺寸下比 emoji 更清晰
 * 颜色继承 currentColor, 由父级 CSS color 决定
 */

type IconName =
  // 底部 tab
  | 'home' | 'learn' | 'practice' | 'play'
  // 学习 sub-tab
  | 'chord' | 'scale' | 'penta' | 'fretboard' | 'circle'
  // 练习入口
  | 'tuner' | 'headphones' | 'target'
  // 伴奏入口
  | 'song' | 'drum' | 'progression' | 'strum' | 'bass'
  // 杂项
  | 'sun' | 'moon' | 'arrow-right' | 'check' | 'mic'
  | 'play-fill' | 'pin' | 'refresh';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  filled?: boolean; // 可选: 给某些图标填充而非描边
}

export function Icon({ name, size = 22, strokeWidth = 1.75, className, style }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style: { display: 'block', ...style },
    'aria-hidden': true,
  };

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1z" />
        </svg>
      );
    case 'learn':
      return (
        <svg {...common}>
          <path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5V19a1 1 0 01-1 1H6a2 2 0 110-4h13" />
          <path d="M8 8h7M8 11h5" />
        </svg>
      );
    case 'practice':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5.5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'play':
      // 三道横向"音轨"图形，呼应 sequencer / 节拍编排
      return (
        <svg {...common}>
          <path d="M4 7h11" />
          <circle cx="17" cy="7" r="2" />
          <path d="M4 12h7" />
          <circle cx="13" cy="12" r="2" />
          <path d="M4 17h13" />
          <circle cx="19" cy="17" r="2" />
        </svg>
      );

    case 'chord':
      // 4 个圆点 + 弦, 像和弦图缩影
      return (
        <svg {...common}>
          <path d="M5 4v16M9 4v16M13 4v16M17 4v16" />
          <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="13" cy="13" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="17" cy="17" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'scale':
      // 阶梯上行
      return (
        <svg {...common}>
          <path d="M4 19h3v-3h3v-3h3v-3h3V7h4" />
        </svg>
      );
    case 'penta':
      // 五角内圈
      return (
        <svg {...common}>
          <path d="M12 3l9 6.6-3.4 10.4H6.4L3 9.6z" />
          <path d="M12 8l4.5 3.3-1.7 5.2H9.2l-1.7-5.2z" />
        </svg>
      );
    case 'fretboard':
      // 横向琴颈格子
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="10" rx="1.5" />
          <path d="M8 7v10M12 7v10M16 7v10" />
          <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'circle':
      // 五度圈缩影
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M5.6 18.4l2.5-2.5M15.9 8.1l2.5-2.5" />
        </svg>
      );

    case 'tuner':
      // 仪表盘 + 指针
      return (
        <svg {...common}>
          <path d="M4 17a8 8 0 0116 0" />
          <path d="M12 17l4-7" />
          <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'headphones':
      return (
        <svg {...common}>
          <path d="M4 14a8 8 0 0116 0v4a2 2 0 01-2 2h-2v-6h4M4 14v4a2 2 0 002 2h2v-6H4" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M19.5 4.5L16 8M22 2l-2.5 2.5" />
        </svg>
      );

    case 'song':
      // 音符 + 流动线
      return (
        <svg {...common}>
          <path d="M9 18V6l11-2v12" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="17" cy="16" r="3" />
        </svg>
      );
    case 'drum':
      // 鼓
      return (
        <svg {...common}>
          <ellipse cx="12" cy="7" rx="8" ry="3" />
          <path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
          <path d="M5 4l-1.5-2M19 4l1.5-2" />
        </svg>
      );
    case 'progression':
      // 多个连接的圆圈代表 chord 走向
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="2.5" />
          <circle cx="12" cy="7" r="2.5" />
          <circle cx="19" cy="12" r="2.5" />
          <circle cx="12" cy="17" r="2.5" />
          <path d="M7 11l3-3M14 8l3 3M17 14l-3 2.5M10 16l-3-3" />
        </svg>
      );
    case 'strum':
      // 6 根弦 + 拨片箭头
      return (
        <svg {...common}>
          <path d="M3 7h18M3 10h18M3 13h18M3 16h18" />
          <path d="M16 4l4 4-4 4" />
        </svg>
      );
    case 'bass':
      // 大写 B 风格音符 - 用一个大头朝下的音符
      return (
        <svg {...common}>
          <circle cx="7" cy="17" r="3" />
          <path d="M10 17V5l9-2v9" />
          <path d="M10 9l9-2" />
        </svg>
      );

    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.5A8 8 0 119.5 4a6 6 0 0010.5 10.5z" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8" />
        </svg>
      );
    case 'play-fill':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M6 4l14 8-14 8z" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 2l1 6 4 2-1 4h-3v8l-2-4h-2l-1-4 4-2z" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0115-6.7L21 8M21 4v4h-4" />
          <path d="M21 12a9 9 0 01-15 6.7L3 16M3 20v-4h4" />
        </svg>
      );

    default:
      return null;
  }
}

export default Icon;
