/**
 * 顶级标签（特殊种类）由卡片题型自动决定，每张卡片有且只有一个。
 *
 * - 判断题按“单选”处理：它本质上是在「正确 / 错误」两个选项中选择一个。
 * - 完型填空按“填空”处理：它与填空题共用同一套空位作答逻辑。
 *
 * 顶级标签会写入 item_tags，但用户不能在前端新增、修改或删除；
 * 用户标签覆盖只保存普通标签，读取时再由本模块补回顶级标签。
 *
 * 前端镜像定义在 src/types/ui.ts，修改本文件时请同步。
 */
export const TOP_TAGS = ['单选题', '多选题', '填空题', '记忆卡片'];

export const TOP_TAG_BY_TYPE = {
  single: '单选题',
  multi: '多选题',
  judge: '单选题',
  fill: '填空题',
  cloze: '填空题',
  knowledge: '记忆卡片',
};

const TOP_TAG_SET = new Set(TOP_TAGS);

export function isTopTag(tag) {
  return TOP_TAG_SET.has(tag);
}

export function topTagForType(type) {
  return TOP_TAG_BY_TYPE[type] ?? null;
}

/**
 * 保证返回的标签数组以正确的顶级标签开头，并移除其他顶级标签。
 * 普通标签保持原有顺序（调用方负责去重）。
 */
export function withTopTag(tags, type) {
  const top = topTagForType(type);
  const list = Array.isArray(tags) ? tags : [];
  if (!top) return list.slice();
  return [top, ...list.filter((tag) => typeof tag === 'string' && !isTopTag(tag))];
}