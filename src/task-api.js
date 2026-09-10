const DATABASE_NAME = 'street-track-viewer';
const DATABASE_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('tasks')) database.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
      if (!database.objectStoreNames.contains('tracks')) {
        const tracks = database.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
        tracks.createIndex('taskId', 'taskId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开浏览器本地数据库'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('浏览器本地数据库操作失败'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('浏览器本地数据库操作失败'));
    transaction.onabort = () => reject(transaction.error || new Error('浏览器本地数据库操作已取消'));
  });
}

function normalizeTask(task) {
  if (!task?.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(task?.taskDate || '')) throw new Error('任务名称和日期不能为空');
  return {
    name: task.name.trim(), taskDate: task.taskDate, area: task.area?.trim() || '', notes: task.notes?.trim() || '',
    displaySettings: task.displaySettings || {}, tracks: Array.isArray(task.tracks) ? task.tracks : [],
  };
}

function storedTrack(taskId, track, sortOrder) {
  if (!track.originalGpx || !track.originalGeojson) throw new Error('轨迹缺少原始数据');
  return {
    taskId, name: track.name || track.originalFilename, originalFilename: track.originalFilename || track.name,
    color: track.color || '#f04444', originalGpx: track.originalGpx, originalGeojson: track.originalGeojson,
    snappedGeojson: track.snappedGeojson || null, visible: track.visible !== false, sortOrder,
  };
}

async function tracksForTask(store, taskId) {
  const tracks = await requestResult(store.index('taskId').getAll(IDBKeyRange.only(taskId)));
  return tracks.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
}

async function fullTask(id) {
  const database = await openDatabase();
  const transaction = database.transaction(['tasks', 'tracks'], 'readonly');
  const task = await requestResult(transaction.objectStore('tasks').get(id));
  if (!task) { database.close(); throw new Error('任务不存在'); }
  const tracks = await tracksForTask(transaction.objectStore('tracks'), id);
  await transactionDone(transaction);
  database.close();
  return { ...task, tracks };
}

async function saveTask(task, id = null) {
  const normalized = normalizeTask(task);
  const database = await openDatabase();
  const transaction = database.transaction(['tasks', 'tracks'], 'readwrite');
  const taskStore = transaction.objectStore('tasks');
  const trackStore = transaction.objectStore('tracks');
  const now = new Date().toISOString();
  const existing = id ? await requestResult(taskStore.get(id)) : null;
  if (id && !existing) { transaction.abort(); database.close(); throw new Error('任务不存在'); }
  const taskRecord = {
    ...(id ? { id } : {}), name: normalized.name, taskDate: normalized.taskDate, area: normalized.area, notes: normalized.notes,
    displaySettings: normalized.displaySettings, createdAt: existing?.createdAt || now, updatedAt: now,
  };
  const taskId = id || await requestResult(taskStore.add(taskRecord));
  if (id) taskStore.put(taskRecord);
  const oldTracks = await tracksForTask(trackStore, taskId);
  oldTracks.forEach((track) => trackStore.delete(track.id));
  normalized.tracks.forEach((track, index) => trackStore.add(storedTrack(taskId, track, index)));
  await transactionDone(transaction);
  database.close();
  return fullTask(taskId);
}

async function listTasks() {
  const database = await openDatabase();
  const transaction = database.transaction(['tasks', 'tracks'], 'readonly');
  const tasks = await requestResult(transaction.objectStore('tasks').getAll());
  const tracks = await requestResult(transaction.objectStore('tracks').getAll());
  await transactionDone(transaction);
  database.close();
  const counts = tracks.reduce((result, track) => result.set(track.taskId, (result.get(track.taskId) || 0) + 1), new Map());
  return tasks.map((task) => ({ ...task, trackCount: counts.get(task.id) || 0 }))
    .sort((left, right) => right.taskDate.localeCompare(left.taskDate) || right.updatedAt.localeCompare(left.updatedAt));
}

async function removeTask(id) {
  const database = await openDatabase();
  const transaction = database.transaction(['tasks', 'tracks'], 'readwrite');
  const taskStore = transaction.objectStore('tasks');
  const task = await requestResult(taskStore.get(id));
  if (!task) { transaction.abort(); database.close(); throw new Error('任务不存在'); }
  taskStore.delete(id);
  const trackStore = transaction.objectStore('tracks');
  const tracks = await tracksForTask(trackStore, id);
  tracks.forEach((track) => trackStore.delete(track.id));
  await transactionDone(transaction);
  database.close();
}

async function removeTrack(taskId, trackId) {
  const database = await openDatabase();
  const transaction = database.transaction('tracks', 'readwrite');
  const store = transaction.objectStore('tracks');
  const track = await requestResult(store.get(trackId));
  if (!track || track.taskId !== taskId) { transaction.abort(); database.close(); throw new Error('轨迹不存在'); }
  store.delete(trackId);
  await transactionDone(transaction);
  database.close();
}

export const taskApi = {
  list: listTasks, get: fullTask, create: (task) => saveTask(task), update: (id, task) => saveTask(task, id),
  remove: removeTask, removeTrack,
};
