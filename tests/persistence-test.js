import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const tempDir = await mkdtemp(join(tmpdir(), 'gpx-v1-rc-'));
const dbPath = join(tempDir, 'test.sqlite');
const port = 8799;
const base = `http://127.0.0.1:${port}`;
const rawGpx = await readFile(new URL('../test-data/模拟-广州平行道路吸附.gpx', import.meta.url), 'utf8');
const originalGeojson = { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[113.33, 23.12732], [113.331, 23.12726]]] } };
const snappedGeojson = { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[113.33004, 23.127283], [113.331029, 23.127219]]] } };

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), GPX_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('本地服务')) { clearTimeout(timer); resolve(child); }
    });
    child.on('error', reject);
  });
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function payload(index) {
  return {
    name: `V1验收任务${index}`,
    taskDate: `2026-10-0${index}`,
    area: '广州市测试区域',
    notes: '持久化自动验收',
    displaySettings: { basemap: index % 2 ? 'vector' : 'imagery', trackMode: 'snapped', coverageEnabled: true, coverageRadius: index * 5 },
    tracks: [{ name: `测试轨迹${index}`, originalFilename: `测试${index}.gpx`, color: '#f04444', originalGpx: rawGpx, originalGeojson, snappedGeojson, visible: true }],
  };
}

let server;
try {
  server = await startServer();
  for (let index = 1; index <= 3; index += 1) await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload(index)) });
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));

  server = await startServer();
  const tasks = await api('/api/tasks');
  if (tasks.length !== 3) throw new Error(`重启后应恢复 3 个任务，实际 ${tasks.length}`);
  const restored = await api(`/api/tasks/${tasks[0].id}`);
  if (restored.tracks[0].originalGpx !== rawGpx) throw new Error('原始 GPX 未原样恢复');
  if (!restored.tracks[0].snappedGeojson || restored.displaySettings.trackMode !== 'snapped') throw new Error('派生轨迹或设置未恢复');

  await api(`/api/tasks/${restored.id}/tracks/${restored.tracks[0].id}`, { method: 'DELETE' });
  const afterTrackDelete = await api(`/api/tasks/${restored.id}`);
  if (afterTrackDelete.tracks.length !== 0) throw new Error('轨迹删除未同步数据库');
  await api(`/api/tasks/${tasks[1].id}`, { method: 'DELETE' });
  const afterTaskDelete = await api('/api/tasks');
  if (afterTaskDelete.length !== 2) throw new Error('任务删除未同步数据库');

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  if (tables.join(',') !== 'tasks,tracks') throw new Error(`发现非预期数据表：${tables.join(',')}`);
  db.close();
  console.log('PASS: 3 个任务保存 → 服务重启 → 历史恢复 → 轨迹删除同步 → 任务删除同步');
  console.log('PASS: 原始 GPX 字节一致，原始/吸附 GeoJSON 与显示设置恢复，数据库仅 tasks/tracks 两张业务表');
} finally {
  if (server && server.exitCode === null) server.kill();
  await rm(tempDir, { recursive: true, force: true });
}
