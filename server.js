import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.GPX_DATA_DIR ? resolve(process.env.GPX_DATA_DIR) : join(projectRoot, 'data');
mkdirSync(dataDir, { recursive: true });
const databasePath = process.env.GPX_DB_PATH ? resolve(process.env.GPX_DB_PATH) : join(dataDir, 'tracks.sqlite');
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    task_date TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    display_settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    color TEXT NOT NULL,
    original_gpx TEXT NOT NULL,
    original_geojson TEXT NOT NULL,
    snapped_geojson TEXT,
    visible INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

const statements = {
  listTasks: db.prepare(`SELECT t.id, t.name, t.task_date AS taskDate, t.area, t.notes,
    t.display_settings AS displaySettings, t.created_at AS createdAt, t.updated_at AS updatedAt,
    COUNT(tr.id) AS trackCount FROM tasks t LEFT JOIN tracks tr ON tr.task_id = t.id
    GROUP BY t.id ORDER BY t.task_date DESC, t.updated_at DESC`),
  getTask: db.prepare('SELECT id, name, task_date AS taskDate, area, notes, display_settings AS displaySettings, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?'),
  getTracks: db.prepare(`SELECT id, task_id AS taskId, name, original_filename AS originalFilename, color,
    original_gpx AS originalGpx, original_geojson AS originalGeojson, snapped_geojson AS snappedGeojson,
    visible, sort_order AS sortOrder FROM tracks WHERE task_id = ? ORDER BY sort_order, id`),
  insertTask: db.prepare('INSERT INTO tasks (name, task_date, area, notes, display_settings) VALUES (?, ?, ?, ?, ?)'),
  updateTask: db.prepare("UPDATE tasks SET name = ?, task_date = ?, area = ?, notes = ?, display_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
  deleteTracks: db.prepare('DELETE FROM tracks WHERE task_id = ?'),
  insertTrack: db.prepare(`INSERT INTO tracks (task_id, name, original_filename, color, original_gpx, original_geojson, snapped_geojson, visible, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  deleteTrack: db.prepare('DELETE FROM tracks WHERE id = ? AND task_id = ?'),
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 50 * 1024 * 1024) throw new Error('请求数据超过 50MB 限制');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizeTask(body) {
  if (!body?.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(body?.taskDate || '')) throw new Error('任务名称和日期不能为空');
  return {
    name: body.name.trim(), taskDate: body.taskDate, area: body.area?.trim() || '', notes: body.notes?.trim() || '',
    displaySettings: JSON.stringify(body.displaySettings || {}), tracks: Array.isArray(body.tracks) ? body.tracks : [],
  };
}

function insertTracks(taskId, tracks) {
  tracks.forEach((track, index) => {
    if (!track.originalGpx || !track.originalGeojson) throw new Error('轨迹缺少原始数据');
    statements.insertTrack.run(taskId, track.name || track.originalFilename, track.originalFilename || track.name, track.color || '#f04444',
      track.originalGpx, JSON.stringify(track.originalGeojson), track.snappedGeojson ? JSON.stringify(track.snappedGeojson) : null,
      track.visible === false ? 0 : 1, index);
  });
}

function fullTask(id) {
  const task = statements.getTask.get(id);
  if (!task) return null;
  task.displaySettings = JSON.parse(task.displaySettings);
  task.tracks = statements.getTracks.all(id).map((track) => ({
    ...track, visible: Boolean(track.visible), originalGeojson: JSON.parse(track.originalGeojson),
    snappedGeojson: track.snappedGeojson ? JSON.parse(track.snappedGeojson) : null,
  }));
  return task;
}

function inTransaction(operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function replaceTask(id, task) {
  return inTransaction(() => {
    statements.updateTask.run(task.name, task.taskDate, task.area, task.notes, task.displaySettings, id);
    statements.deleteTracks.run(id);
    insertTracks(id, task.tracks);
  });
}

function createTask(task) {
  return inTransaction(() => {
    const result = statements.insertTask.run(task.name, task.taskDate, task.area, task.notes, task.displaySettings);
    insertTracks(Number(result.lastInsertRowid), task.tracks);
    return Number(result.lastInsertRowid);
  });
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    return json(response, 200, statements.listTasks.all().map((task) => ({ ...task, displaySettings: JSON.parse(task.displaySettings) })));
  }
  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const id = createTask(normalizeTask(await readJson(request)));
    return json(response, 201, fullTask(id));
  }
  const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch && request.method === 'GET') {
    const task = fullTask(Number(taskMatch[1]));
    return task ? json(response, 200, task) : json(response, 404, { error: '任务不存在' });
  }
  if (taskMatch && request.method === 'PUT') {
    const id = Number(taskMatch[1]);
    if (!statements.getTask.get(id)) return json(response, 404, { error: '任务不存在' });
    replaceTask(id, normalizeTask(await readJson(request)));
    return json(response, 200, fullTask(id));
  }
  if (taskMatch && request.method === 'DELETE') {
    return json(response, statements.deleteTask.run(Number(taskMatch[1])).changes ? 204 : 404, {});
  }
  const trackMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/tracks\/(\d+)$/);
  if (trackMatch && request.method === 'DELETE') {
    const result = statements.deleteTrack.run(Number(trackMatch[2]), Number(trackMatch[1]));
    return json(response, result.changes ? 204 : 404, {});
  }
  return json(response, 404, { error: '接口不存在' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function serveStatic(response, pathname) {
  const distRoot = join(projectRoot, 'dist');
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  let filePath = resolve(distRoot, requested);
  if (!filePath.startsWith(resolve(distRoot)) || !existsSync(filePath)) filePath = join(distRoot, 'index.html');
  const content = await readFile(filePath);
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
  response.end(content);
}

const port = Number(process.env.PORT || 8787);
createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else await serveStatic(response, url.pathname);
  } catch (error) {
    json(response, 400, { error: error.message || '请求处理失败' });
  }
}).listen(port, '127.0.0.1', () => console.log(`街巷轨迹本地服务：http://127.0.0.1:${port}`));
