import { useCallback, useEffect, useState } from 'react';
import {
  detectDeviceProfile,
  readLayoutOverride,
  sameDeviceProfile,
  writeLayoutOverride,
  type DeviceProfile,
  type LayoutOverride,
  type LayoutReason,
} from '../lib/deviceLayout';

export interface LayoutMode {
  isMobile: boolean;
  override: LayoutOverride;
  /** 自动模式下的判断依据；手动覆盖时为 override。 */
  source: LayoutReason;
  profile: DeviceProfile;
  setOverride: (value: LayoutOverride) => void;
  cycleLayout: () => void;
}

const NEXT_OVERRIDE: Record<LayoutOverride, LayoutOverride> = {
  auto: 'desktop',
  desktop: 'mobile',
  mobile: 'auto',
};

/**
 * 布局模式：auto 按设备特征自动切换，桌面 / 移动可手动覆盖。
 * 手动选择会写入 localStorage，刷新后仍然生效；自动模式不写死设备。
 */
export function useLayoutMode(): LayoutMode {
  const [override, setOverrideState] = useState<LayoutOverride>(readLayoutOverride);
  const [profile, setProfile] = useState<DeviceProfile>(detectDeviceProfile);

  useEffect(() => {
    const update = () => {
      setProfile((previous) => {
        const next = detectDeviceProfile();
        return sameDeviceProfile(previous, next) ? previous : next;
      });
    };

    update();
    const queries = [
      window.matchMedia?.('(max-width: 767px)'),
      window.matchMedia?.('(pointer: coarse)'),
      window.matchMedia?.('(hover: none)'),
    ].filter((query): query is MediaQueryList => Boolean(query));

    for (const query of queries) query.addEventListener('change', update);
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      for (const query of queries) query.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const setOverride = useCallback((value: LayoutOverride) => {
    setOverrideState(value);
    writeLayoutOverride(value);
  }, []);

  const cycleLayout = useCallback(() => {
    setOverrideState((previous) => {
      const next = NEXT_OVERRIDE[previous];
      writeLayoutOverride(next);
      return next;
    });
  }, []);

  const isMobile = override === 'auto' ? profile.isMobile : override === 'mobile';

  return {
    isMobile,
    override,
    source: override === 'auto' ? profile.reason : 'override',
    profile,
    setOverride,
    cycleLayout,
  };
}
