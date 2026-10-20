import { Laptop, Monitor, Smartphone } from 'lucide-react';
import type { LayoutOverride } from '../../lib/deviceLayout';

const CONFIG = {
  auto: { label: '自动', Icon: Monitor },
  desktop: { label: '桌面', Icon: Laptop },
  mobile: { label: '移动', Icon: Smartphone },
} as const;

/**
 * 布局切换：自动 → 桌面 → 移动 → 自动。
 * 自动模式会说明当前是按窄屏还是触屏特征判断的。
 */
export function LayoutToggle({
  override,
  autoIsMobile,
  onCycle,
  compact = false,
}: {
  override: LayoutOverride;
  autoIsMobile: boolean;
  onCycle: () => void;
  compact?: boolean;
}) {
  const { label, Icon } = CONFIG[override];
  const effective = override === 'auto' ? (autoIsMobile ? '移动' : '桌面') : label;
  const hint =
    override === 'auto'
      ? `自动适配（当前：${effective}布局，按设备/连接特征判断）`
      : `当前：${label}布局。点击切换`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onCycle}
        title={hint}
        aria-label={`切换布局，${hint}`}
        data-layout-override={override}
        className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onCycle}
      title={hint}
      aria-label={`切换布局，${hint}`}
      data-layout-override={override}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
