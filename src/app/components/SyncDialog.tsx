import { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';

interface SyncDialogProps {
  open: boolean;
  userKey: string;
  onClose: () => void;
  onUseKey: (key: string) => Promise<void>;
}

export function SyncDialog({ open, userKey, onClose, onUseKey }: SyncDialogProps) {
  const [input, setInput] = useState('');
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setError('');
    setCopied(false);
    setBusy(false);
    setReveal(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(userKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('复制失败，请手动选中同步码复制');
    }
  };

  const useKey = async () => {
    const key = input.trim();
    if (!key) {
      setError('请输入同步码');
      return;
    }
    if (!/^mck_[A-Za-z0-9_-]{32,64}$/.test(key)) {
      setError('同步码格式不正确，应以 mck_ 开头');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onUseKey(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">跨设备同步</h2>
              <p className="text-xs text-muted-foreground">用同一同步码在另一台设备继续学习</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground">当前设备同步码</label>
              <button
                onClick={() => setReveal((value) => !value)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {reveal ? '隐藏' : '显示'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={userKey}
                type={reveal ? 'text' : 'password'}
                className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground"
              />
              <button
                onClick={copyKey}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              同步码等同于账号凭证。熟悉度、答题记录和自定义标签都会保存在服务端；在另一台设备输入同一同步码即可接续。
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              使用其他设备的同步码
            </label>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void useKey();
                }}
                placeholder="mck_..."
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
              />
              <button
                onClick={() => void useKey()}
                disabled={busy}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                切换
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              切换后当前设备会立即改用新同步码的数据；原同步码仍可在其他设备继续使用。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}