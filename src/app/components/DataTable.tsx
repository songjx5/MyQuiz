import type { TableData } from '../../types/deck';

function alignStyle(index: number, table: TableData) {
  return { textAlign: table.align?.[index] ?? 'left' } as const;
}

/**
 * 结构化表格渲染。所有题型都可以带一个 `table` 字段；这里只负责呈现，
 * 不参与判分。窄屏时表格在卡片内部横向滚动，不撑破页面。
 */
export function DataTable({ table, className = '' }: { table: TableData; className?: string }) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (columns.length === 0) return null;
  const showHeader = table.header !== false;

  return (
    <figure className={`my-3 ${className}`}>
      {table.caption && (
        <figcaption className="mb-1.5 text-xs font-semibold text-muted-foreground">
          {table.caption}
        </figcaption>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-max border-collapse text-left text-sm font-normal">
          {showHeader && (
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={`${column}-${index}`}
                    scope="col"
                    style={alignStyle(index, table)}
                    className="border-b border-border bg-muted/70 px-3 py-2 text-xs font-semibold text-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-muted/20' : undefined}>
                {columns.map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    style={alignStyle(columnIndex, table)}
                    className="whitespace-pre-wrap border-b border-border/70 px-3 py-2 align-top leading-relaxed text-foreground last:border-r-0"
                  >
                    {row?.[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.footnote && (
        <figcaption className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {table.footnote}
        </figcaption>
      )}
    </figure>
  );
}
