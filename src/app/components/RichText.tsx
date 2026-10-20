import { useMemo } from 'react';
import { parseRichText } from '../../lib/richText';
import { DataTable } from './DataTable';

/**
 * 文本内容渲染：保留原有换行，并把 GFM 管道表格渲染成真正的表格。
 * 不解析 HTML，避免题库文本注入页面结构。
 */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  if (blocks.length === 0) return null;

  if (blocks.length === 1 && blocks[0].type === 'text') {
    return <div className={`whitespace-pre-wrap ${className}`}>{blocks[0].text}</div>;
  }

  return (
    <div className={className}>
      {blocks.map((block, index) =>
        block.type === 'text' ? (
          <div key={index} className="whitespace-pre-wrap">
            {block.text}
          </div>
        ) : (
          <DataTable key={index} table={block.table} />
        ),
      )}
    </div>
  );
}
