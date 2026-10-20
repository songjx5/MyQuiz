export type LayoutOverride = 'auto' | 'desktop' | 'mobile';
export type LayoutReason = 'narrow' | 'touch' | 'desktop' | 'override';

export interface DeviceProfile {
  /** 是否应使用单列移动布局。 */
  isMobile: boolean;
  /** 自动判断的依据，便于在按钮提示里解释当前布局。 */
  reason: Exclude<LayoutReason, 'override'>;
  width: number;
  height: number;
  touch: boolean;
  coarsePointer: boolean;
  mobileUserAgent: boolean;
}

export const LAYOUT_STORAGE_KEY = 'memoquiz.layout';

const OVERRIDES: LayoutOverride[] = ['auto', 'desktop', 'mobile'];

function safeStorage(kind: 'get' | 'set', value?: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    if (kind === 'get') return window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, value ?? 'auto');
    return null;
  } catch {
    return null;
  }
}

export function readLayoutOverride(): LayoutOverride {
  const stored = safeStorage('get');
  return OVERRIDES.includes(stored as LayoutOverride) ? (stored as LayoutOverride) : 'auto';
}

export function writeLayoutOverride(value: LayoutOverride) {
  safeStorage('set', value);
}

/**
 * 自动判断移动布局。
 *
 * 不只依赖 UA 或单一断点：
 * - 窄屏（< 768px）直接使用移动布局，覆盖 Android / iPhone 竖屏；
 * - 触屏且宽度 < 1024px 使用移动布局，覆盖平板竖屏、Android 折叠屏和横屏手机；
 * - 桌面浏览器、宽屏平板保持三栏布局。
 *
 * 这里使用的是「设备 / 连接特征」而不是具体机型：视口、触控点数、pointer/hover
 * 媒体查询和 UA 只作为兜底，因此 Android、iPadOS、HarmonyOS 等都能正常工作。
 */
export function detectDeviceProfile(): DeviceProfile {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      reason: 'desktop',
      width: 0,
      height: 0,
      touch: false,
      coarsePointer: false,
      mobileUserAgent: false,
    };
  }

  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const ua = navigator.userAgent ?? '';
  const userAgentData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  const mobileUserAgent =
    /Android|iPhone|iPod|iPad|Mobile|HarmonyOS|Windows Phone|Opera Mini/i.test(ua) ||
    (/Macintosh/i.test(ua) && touchPoints > 1) ||
    userAgentData?.mobile === true;

  const touch = touchPoints > 0 || coarsePointer || noHover || mobileUserAgent;
  const narrow = width < 768;
  const compactTouch = touch && width < 1024;
  const isMobile = narrow || compactTouch;

  return {
    isMobile,
    reason: narrow ? 'narrow' : compactTouch ? 'touch' : 'desktop',
    width,
    height,
    touch,
    coarsePointer,
    mobileUserAgent,
  };
}

export function sameDeviceProfile(left: DeviceProfile, right: DeviceProfile) {
  return (
    left.isMobile === right.isMobile &&
    left.reason === right.reason &&
    left.width === right.width &&
    left.height === right.height &&
    left.touch === right.touch &&
    left.coarsePointer === right.coarsePointer &&
    left.mobileUserAgent === right.mobileUserAgent
  );
}
