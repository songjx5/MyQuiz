#!/usr/bin/env node
/**
 * 同时启动 Vite 开发服务器与 Node API。
 * 子进程使用 inherit stdio，避免在受限环境下因管道捕获输出而失败。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(viteBin)) {
  console.error('找不到 Vite，请先运行 npm install。');
  process.exit(1);
}

const children = new Set();
let shuttingDown = false;

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`\n[dev] ${name} 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）。`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // 忽略。
    }
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`[dev] 启动 API (${process.env.PORT || 8787}) 与 Vite…`);
start('api', [path.join(ROOT, 'server', 'index.mjs')]);
start('web', [viteBin]);