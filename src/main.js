import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-gpx';
import './style.css';
import { mapConfig } from './map-config.js';
import { createCoverageLayer, createTrackLayer, extractTrackSegments, snapSegments } from './track-processing.js';
import { taskApi } from './task-api.js';

const COLORS = ['#f04444', '#2979ff', '#00a878', '#ff8a00', '#8b5cf6', '#00a6b2', '#e83e8c', '#70543e'];
const DEFAULT_VIEW = [23.1291, 113.2644];

document.querySelector('#app').innerHTML = `
  <main class="app-shell">
    <aside class="sidebar" aria-label="轨迹管理">
      <header class="brand">
        <span class="brand-mark" aria-hidden="true">迹</span>
        <div><h1>街巷轨迹</h1><p>多人 GPX 叠加查看</p></div>
      </header>

      <div class="task-actions">
        <button id="history-task" type="button">历史任务</button>
      </div>

      <section class="import-panel">
        <label class="import-button" for="gpx-input">
          <span class="plus">＋</span><span>导入 GPX 轨迹</span>
        </label>
        <input id="gpx-input" type="file" accept=".gpx,application/gpx+xml" multiple />
        <p class="privacy-note"><span aria-hidden="true">●</span> 文件在本机读取，历史任务保存在当前浏览器</p>
      </section>

      <section class="display-controls" aria-label="轨迹显示设置">
        <div class="control-block">
          <div class="control-title"><strong>轨迹形态</strong><span id="snap-status">保留原始坐标</span></div>
          <div class="segmented-control" id="track-mode">
            <button type="button" data-mode="original" class="is-active">原始轨迹</button>
            <button type="button" data-mode="snapped">道路吸附轨迹</button>
          </div>
          <p class="network-note">道路吸附按需联网；低置信度点保留原位</p>
        </div>
        <div class="control-block coverage-control">
          <label class="coverage-switch"><span><strong>消杀覆盖范围</strong><small>辅助观察，不计算覆盖率</small></span><input id="coverage-toggle" type="checkbox" /><i></i></label>
          <div id="radius-controls" class="radius-controls" hidden>
            <div class="radius-presets" role="group" aria-label="覆盖半径">
              <button type="button" data-radius="5">5 米</button>
              <button type="button" data-radius="10" class="is-active">10 米</button>
              <button type="button" data-radius="15">15 米</button>
              <button type="button" data-radius="20">20 米</button>
              <button type="button" data-radius="custom">自定义</button>
            </div>
            <label id="custom-radius-wrap" class="custom-radius" hidden>半径 <input id="custom-radius" type="number" min="1" max="500" step="1" value="30" /> 米</label>
          </div>
        </div>
      </section>

      <section class="track-section">
        <div class="section-heading">
          <h2>轨迹列表 <span id="track-count">0</span></h2>
          <div class="bulk-actions">
            <button id="show-all" type="button" disabled>全部显示</button>
            <i></i>
            <button id="hide-all" type="button" disabled>全部隐藏</button>
          </div>
        </div>
        <div id="track-folder" class="track-folder" hidden>
          <div class="folder-heading"><span aria-hidden="true">▾</span><strong id="folder-label">未保存任务</strong><button id="save-task" type="button">保存任务</button></div>
          <div id="track-list" class="track-list"></div>
        </div>
        <div id="empty-state" class="empty-state">
          <div class="empty-icon" aria-hidden="true"><span></span><span></span><span></span></div>
          <strong>还没有轨迹</strong>
          <p>一次可选择多份 GPX 1.1 文件<br />导入后会自动显示在地图上</p>
        </div>
      </section>

      <footer class="sidebar-footer">
        <button id="clear-all" class="clear-button" type="button" disabled>清空全部轨迹</button>
        <p id="storage-usage">本地存储占用：正在读取…</p>
      </footer>
    </aside>

    <section class="map-panel">
      <div id="map" aria-label="轨迹地图"></div>
      <div class="basemap-switch" role="group" aria-label="底图切换">
        <button type="button" data-basemap="vector" class="is-active">矢量地图</button>
        <button type="button" data-basemap="imagery">卫星影像</button>
      </div>
      <div id="map-config-notice" class="map-config-notice" hidden>
        <strong>需要配置天地图 Token</strong>
        <span>复制 .env.example 为 .env，填写 VITE_TDT_TOKEN 后重新启动。</span>
      </div>
      <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="打开轨迹列表">☰</button>
      <div class="map-status"><span></span><strong id="visible-count">0</strong> 条轨迹正在显示</div>
    </section>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <dialog id="save-dialog" class="task-dialog">
      <form id="task-form">
        <div class="dialog-heading"><div><strong>保存当前任务</strong><small>任务将作为日期文件夹保存</small></div><button type="button" data-close="save-dialog">×</button></div>
        <label>任务名称<input id="task-name" required maxlength="80" placeholder="例如：10月1日越秀区消杀" /></label>
        <div class="form-row"><label>日期<input id="task-date" type="date" required /></label><label>区域<input id="task-area" maxlength="80" placeholder="例如：越秀区" /></label></div>
        <label>备注<textarea id="task-notes" rows="3" maxlength="500" placeholder="选填"></textarea></label>
        <button class="primary-action" type="submit">保存任务</button>
      </form>
    </dialog>
    <dialog id="history-dialog" class="task-dialog history-dialog">
      <div class="dialog-heading"><div><strong>历史任务</strong><small>按日期分级查看</small></div><button type="button" data-close="history-dialog">×</button></div>
      <div id="history-list" class="history-list"></div>
    </dialog>
  </main>
`;

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(DEFAULT_VIEW, 12);
L.control.zoom({ position: 'topright' }).addTo(map);
map.createPane('labels');
map.getPane('labels').style.zIndex = 350;
map.getPane('labels').style.pointerEvents = 'none';
const tileOptions = {
  subdomains: mapConfig.subdomains,
  minZoom: 1,
  maxZoom: 18,
  attribution: '&copy; <a href="https://guangdong.tianditu.gov.cn/guangzhou/">天地图·广州</a> &amp; <a href="https://www.tianditu.gov.cn/">国家地理信息公共服务平台</a>',
};
const basemaps = {
  vector: L.layerGroup([
    L.tileLayer(mapConfig.vectorUrl, tileOptions),
    L.tileLayer(mapConfig.vectorLabelUrl, { ...tileOptions, pane: 'labels' }),
  ]),
  imagery: L.layerGroup([
    L.tileLayer(mapConfig.imageryUrl, tileOptions),
    L.tileLayer(mapConfig.imageryLabelUrl, { ...tileOptions, pane: 'labels' }),
  ]),
};
let activeBasemap = 'vector';
basemaps.vector.addTo(map);

if (!mapConfig.token || mapConfig.token === '请替换为你的天地图Token') {
  document.querySelector('#map-config-notice').hidden = false;
}

const input = document.querySelector('#gpx-input');
const list = document.querySelector('#track-list');
const emptyState = document.querySelector('#empty-state');
const countLabel = document.querySelector('#track-count');
const visibleLabel = document.querySelector('#visible-count');
const showAllButton = document.querySelector('#show-all');
const hideAllButton = document.querySelector('#hide-all');
const clearButton = document.querySelector('#clear-all');
const trackFolder = document.querySelector('#track-folder');
const toast = document.querySelector('#toast');
const sidebar = document.querySelector('.sidebar');
const tracks = [];
let toastTimer;
let trackMode = 'original';
let coverageEnabled = false;
let coverageRadius = 10;
let currentTask = { id: null, name: '未保存任务', taskDate: new Date().toISOString().slice(0, 10), area: '', notes: '' };

document.querySelectorAll('[data-basemap]').forEach((button) => {
  button.addEventListener('click', () => {
    const nextBasemap = button.dataset.basemap;
    if (nextBasemap === activeBasemap) return;
    map.removeLayer(basemaps[activeBasemap]);
    basemaps[nextBasemap].addTo(map);
    activeBasemap = nextBasemap;
    document.querySelectorAll('[data-basemap]').forEach((item) => item.classList.toggle('is-active', item === button));
  });
});

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function updateUi() {
  const total = tracks.length;
  const visible = tracks.filter((track) => track.visible).length;
  countLabel.textContent = total;
  visibleLabel.textContent = visible;
  emptyState.hidden = total > 0;
  trackFolder.hidden = total === 0;
  document.querySelector('#folder-label').textContent = currentTask.id ? `${currentTask.taskDate} · ${currentTask.name}` : '未保存任务';
  [showAllButton, hideAllButton, clearButton].forEach((button) => { button.disabled = total === 0; });
}

function refreshCoverage(track) {
  if (track.coverageLayer && map.hasLayer(track.coverageLayer)) map.removeLayer(track.coverageLayer);
  track.coverageLayer = null;
  if (!coverageEnabled || !track.visible) return;
  const segments = trackMode === 'snapped' && track.snappedSegments ? track.snappedSegments : track.originalSegments;
  track.coverageLayer = createCoverageLayer(segments, coverageRadius, track.color).addTo(map);
  track.layer.bringToFront?.();
}

function refreshAllCoverage() {
  tracks.forEach(refreshCoverage);
}

function fitVisibleTracks() {
  const visibleBounds = tracks
    .filter((track) => track.visible && track.layer.getBounds().isValid())
    .map((track) => track.layer.getBounds());
  if (!visibleBounds.length) return;
  const bounds = visibleBounds.slice(1).reduce((all, next) => all.extend(next), visibleBounds[0]);
  map.fitBounds(bounds, { padding: [44, 44], maxZoom: 17 });
}

function setTrackVisibility(track, visible, fit = false) {
  track.visible = visible;
  if (visible && !map.hasLayer(track.layer)) track.layer.addTo(map);
  if (!visible && map.hasLayer(track.layer)) map.removeLayer(track.layer);
  track.row.classList.toggle('is-hidden', !visible);
  track.checkbox.checked = visible;
  refreshCoverage(track);
  updateUi();
  if (fit) fitVisibleTracks();
}

function addTrackRow(track) {
  const row = document.createElement('article');
  row.className = 'track-item';
  row.innerHTML = `
    <label class="visibility-toggle" title="显示或隐藏轨迹">
      <input type="checkbox" checked aria-label="显示 ${escapeHtml(track.name)}" />
      <span style="--track-color:${track.color}"></span>
    </label>
    <button class="track-focus" type="button" title="定位到此轨迹">
      <strong>${escapeHtml(track.name)}</strong>
      <small class="track-meta">${formatDistance(track.distance) || 'GPX 轨迹'} · 原始</small>
    </button>
    <div class="track-row-actions"><button class="locate-button" type="button" aria-label="定位 ${escapeHtml(track.name)}" title="定位到此轨迹">⌖</button><button class="delete-track" type="button" aria-label="删除 ${escapeHtml(track.name)}" title="删除轨迹">×</button></div>
  `;
  track.row = row;
  track.checkbox = row.querySelector('input');
  track.meta = row.querySelector('.track-meta');
  track.checkbox.addEventListener('change', () => setTrackVisibility(track, track.checkbox.checked));
  const focus = () => {
    if (!track.visible) setTrackVisibility(track, true);
    map.fitBounds(track.layer.getBounds(), { padding: [54, 54], maxZoom: 18 });
    if (window.innerWidth <= 760) sidebar.classList.remove('is-open');
  };
  row.querySelector('.track-focus').addEventListener('click', focus);
  row.querySelector('.locate-button').addEventListener('click', focus);
  row.querySelector('.delete-track').addEventListener('click', () => deleteTrack(track));
  list.append(row);
}

async function deleteTrack(track) {
  try {
    const synced = Boolean(currentTask.id && track.dbId);
    if (currentTask.id && track.dbId) await taskApi.removeTrack(currentTask.id, track.dbId);
    if (map.hasLayer(track.layer)) map.removeLayer(track.layer);
    if (track.coverageLayer && map.hasLayer(track.coverageLayer)) map.removeLayer(track.coverageLayer);
    tracks.splice(tracks.indexOf(track), 1);
    track.row.remove();
    updateUi();
    if (synced) await updateStorageUsage();
    showToast(synced ? '轨迹已删除并同步数据库' : '轨迹已删除');
  } catch (error) {
    showToast(error.message, 'warning');
  }
}

async function ensureSnapped(track) {
  if (track.snappedLayer) return true;
  try {
    track.meta.textContent = '道路匹配中…';
    const result = await snapSegments(track.originalSegments, mapConfig.mapMatchingUrl);
    track.snappedSegments = result.segments;
    track.snappedLayer = createTrackLayer(result.segments, track.color);
    track.snapSummary = `${result.snappedCount}/${result.pointCount} 点可靠吸附`;
    return true;
  } catch (error) {
    track.snapError = error.message;
    track.snappedSegments = track.originalSegments.map((segment) => segment.map((item) => ({ ...item, snapped: false })));
    track.snappedLayer = createTrackLayer(track.snappedSegments, track.color);
    track.snapSummary = '无可靠吸附，保留原始';
    track.meta.textContent = `${formatDistance(track.distance)} · 吸附失败，保留原始`;
    return false;
  }
}

function segmentsToGeojson(segments) {
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: segments.map((segment) => segment.map(({ lng, lat }) => [lng, lat])) } };
}

function geojsonToSegments(geojson) {
  const geometry = geojson?.type === 'Feature' ? geojson.geometry : geojson;
  if (geometry?.type === 'LineString') return [geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates.map((segment) => segment.map(([lng, lat]) => ({ lat, lng })));
  return [];
}

function createTrackFromGpx({ rawGpx, name, fileName, color, visible = true, dbId = null, snappedGeojson = null }) {
  const documentXml = new DOMParser().parseFromString(rawGpx, 'application/xml');
  if (documentXml.querySelector('parsererror') || !documentXml.documentElement.matches('gpx')) throw new Error('不是有效的 GPX 文件');
  const originalLayer = new L.GPX(rawGpx, {
    async: false,
    gpx_options: { parseElements: ['track', 'route'] },
    markers: { startIcon: null, endIcon: null },
    polyline_options: { color, weight: 5, opacity: 0.88, lineCap: 'round', lineJoin: 'round' },
  });
  const originalSegments = extractTrackSegments(documentXml);
  if (!originalLayer.getBounds().isValid() || !originalSegments.length) throw new Error('文件中没有完整的经纬度轨迹线段');
  const snappedSegments = snappedGeojson ? geojsonToSegments(snappedGeojson) : null;
  const snappedLayer = snappedSegments?.length ? createTrackLayer(snappedSegments, color) : null;
  const track = {
    id: crypto.randomUUID(), dbId, name, fileName, color, rawGpx, originalSegments, originalLayer,
    snappedSegments, snappedLayer, snapSummary: snappedSegments ? '已读取保存的吸附结果' : null,
    layer: trackMode === 'snapped' && snappedLayer ? snappedLayer : originalLayer,
    distance: originalLayer.get_distance(), visible,
  };
  if (visible) track.layer.addTo(map);
  tracks.push(track);
  addTrackRow(track);
  setTrackVisibility(track, visible);
  return track;
}

async function applyTrackMode(nextMode, force = false) {
  if (!force && nextMode === trackMode) return;
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  modeButtons.forEach((button) => { button.disabled = true; });
  document.querySelector('#snap-status').textContent = nextMode === 'snapped' ? '正在谨慎匹配道路…' : '保留原始坐标';
  let failures = 0;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (nextMode === 'snapped' && !(await ensureSnapped(track))) failures += 1;
    if (track.visible && map.hasLayer(track.layer)) map.removeLayer(track.layer);
    track.layer = nextMode === 'snapped' && track.snappedLayer ? track.snappedLayer : track.originalLayer;
    if (track.visible) track.layer.addTo(map);
    track.meta.textContent = `${formatDistance(track.distance)} · ${nextMode === 'snapped' && track.snappedLayer ? track.snapSummary : '原始'}`;
    if (nextMode === 'snapped' && index < tracks.length - 1) await new Promise((resolve) => setTimeout(resolve, 1050));
  }
  trackMode = nextMode;
  modeButtons.forEach((button) => {
    button.disabled = false;
    button.classList.toggle('is-active', button.dataset.mode === trackMode);
  });
  document.querySelector('#snap-status').textContent = trackMode === 'snapped' ? '可靠点吸附，疑点保留' : '保留原始坐标';
  refreshAllCoverage();
  fitVisibleTracks();
  if (nextMode === 'snapped') showToast(failures ? `${failures} 条轨迹无法可靠匹配，已保留原始位置` : '道路吸附轨迹已生成', failures ? 'warning' : 'success');
}

function loadGpxFile(file, color) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => {
      try {
        const xml = String(reader.result);
        resolve(createTrackFromGpx({ rawGpx: xml, name: file.name.replace(/\.gpx$/i, ''), fileName: file.name, color }));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file);
  });
}

input.addEventListener('change', async () => {
  const files = [...input.files];
  if (!files.length) return;
  const results = await Promise.allSettled(files.map((file, index) => loadGpxFile(file, COLORS[(tracks.length + index) % COLORS.length])));
  input.value = '';
  const added = results.filter((result) => result.status === 'fulfilled').length;
  const failed = results.length - added;
  updateUi();
  if (added && trackMode === 'snapped') await applyTrackMode('snapped', true);
  if (added) fitVisibleTracks();
  showToast(failed ? `已导入 ${added} 条轨迹，${failed} 个文件无法解析` : `已导入 ${added} 条轨迹`, failed ? 'warning' : 'success');
});

showAllButton.addEventListener('click', () => {
  tracks.forEach((track) => setTrackVisibility(track, true));
  fitVisibleTracks();
});

hideAllButton.addEventListener('click', () => tracks.forEach((track) => setTrackVisibility(track, false)));

async function clearTracks(syncDatabase = false) {
  if (syncDatabase && currentTask.id) {
    await Promise.all(tracks.filter((track) => track.dbId).map((track) => taskApi.removeTrack(currentTask.id, track.dbId)));
  }
  tracks.forEach((track) => map.removeLayer(track.layer));
  tracks.forEach((track) => { if (track.coverageLayer) map.removeLayer(track.coverageLayer); });
  tracks.length = 0;
  list.replaceChildren();
  updateUi();
  if (syncDatabase) await updateStorageUsage();
}

clearButton.addEventListener('click', async () => {
  try {
    const synced = Boolean(currentTask.id);
    await clearTracks(true);
    showToast(synced ? '已清空全部轨迹并同步数据库' : '已清空全部轨迹');
  } catch (error) {
    showToast(error.message, 'warning');
  }
});

function taskPayload() {
  const center = map.getCenter();
  return {
    name: currentTask.name,
    taskDate: currentTask.taskDate,
    area: currentTask.area,
    notes: currentTask.notes,
    displaySettings: {
      basemap: activeBasemap, trackMode, coverageEnabled, coverageRadius,
      center: [center.lat, center.lng], zoom: map.getZoom(),
    },
    tracks: tracks.map((track) => ({
      name: track.name, originalFilename: track.fileName, color: track.color, visible: track.visible,
      originalGpx: track.rawGpx, originalGeojson: segmentsToGeojson(track.originalSegments),
      snappedGeojson: track.snappedSegments ? segmentsToGeojson(track.snappedSegments) : null,
    })),
  };
}

async function saveCurrentTask() {
  if (!tracks.length) throw new Error('请先导入至少一条轨迹');
  const saved = currentTask.id ? await taskApi.update(currentTask.id, taskPayload()) : await taskApi.create(taskPayload());
  currentTask.id = saved.id;
  saved.tracks.forEach((savedTrack, index) => { if (tracks[index]) tracks[index].dbId = savedTrack.id; });
  updateUi();
  await updateStorageUsage();
}

function formatStorageSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function updateStorageUsage() {
  const label = document.querySelector('#storage-usage');
  try {
    const stats = await taskApi.stats();
    label.textContent = `本地存储占用：${stats.taskCount} 个任务 · ${stats.trackCount} 条轨迹 · ${formatStorageSize(stats.bytes)}`;
  } catch {
    label.textContent = '本地存储占用：暂时无法读取';
  }
}

function formatTaskDate(value) {
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日`;
}

async function renderHistory() {
  const historyList = document.querySelector('#history-list');
  historyList.innerHTML = '<p class="history-loading">正在读取…</p>';
  try {
    const tasks = await taskApi.list();
    if (!tasks.length) {
      historyList.innerHTML = '<p class="history-empty">暂无已保存任务</p>';
      return;
    }
    const groups = Map.groupBy(tasks, (task) => task.taskDate);
    historyList.innerHTML = [...groups].map(([date, items]) => `
      <details class="date-folder" open><summary><span>▾</span><strong>${escapeHtml(formatTaskDate(date))}</strong><small>${items.length} 个任务</small></summary>
        <div class="folder-tasks">${items.map((task) => `<article class="history-item">
          <button type="button" class="open-task" data-task-id="${task.id}"><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.area || '未填写区域')} · ${task.trackCount} 条轨迹</small></button>
          <button type="button" class="delete-task" data-delete-task="${task.id}" aria-label="删除任务 ${escapeHtml(task.name)}">×</button>
        </article>`).join('')}</div>
      </details>`).join('');
    historyList.querySelectorAll('[data-task-id]').forEach((button) => button.addEventListener('click', () => openTask(Number(button.dataset.taskId))));
    historyList.querySelectorAll('[data-delete-task]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const id = Number(button.dataset.deleteTask);
        await taskApi.remove(id);
        if (currentTask.id === id) {
          await clearTracks(false);
          currentTask = { id: null, name: '未保存任务', taskDate: new Date().toISOString().slice(0, 10), area: '', notes: '' };
          updateUi();
        }
        await renderHistory();
        await updateStorageUsage();
        showToast('历史任务已删除');
      } catch (error) { showToast(error.message, 'warning'); }
    }));
  } catch (error) {
    historyList.innerHTML = `<p class="history-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function openTask(id) {
  try {
    const saved = await taskApi.get(id);
    await clearTracks(false);
    currentTask = { id: saved.id, name: saved.name, taskDate: saved.taskDate, area: saved.area, notes: saved.notes };
    const settings = saved.displaySettings || {};
    trackMode = settings.trackMode === 'snapped' ? 'snapped' : 'original';
    coverageEnabled = Boolean(settings.coverageEnabled);
    coverageRadius = Number(settings.coverageRadius) || 10;
    saved.tracks.forEach((track) => createTrackFromGpx({
      rawGpx: track.originalGpx, name: track.name, fileName: track.originalFilename, color: track.color,
      visible: track.visible, dbId: track.id, snappedGeojson: track.snappedGeojson,
    }));
    document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === trackMode));
    document.querySelector('#snap-status').textContent = trackMode === 'snapped' ? '已读取保存的吸附结果' : '保留原始坐标';
    document.querySelector('#coverage-toggle').checked = coverageEnabled;
    document.querySelector('#radius-controls').hidden = !coverageEnabled;
    const preset = [5, 10, 15, 20].includes(coverageRadius) ? String(coverageRadius) : 'custom';
    document.querySelectorAll('[data-radius]').forEach((button) => button.classList.toggle('is-active', button.dataset.radius === preset));
    document.querySelector('#custom-radius-wrap').hidden = preset !== 'custom';
    document.querySelector('#custom-radius').value = coverageRadius;
    if (settings.basemap && basemaps[settings.basemap] && settings.basemap !== activeBasemap) document.querySelector(`[data-basemap="${settings.basemap}"]`).click();
    refreshAllCoverage();
    updateUi();
    document.querySelector('#history-dialog').close();
    if (Array.isArray(settings.center) && Number.isFinite(settings.zoom)) map.setView(settings.center, settings.zoom);
    else fitVisibleTracks();
    showToast(`已打开任务：${saved.name}`, 'success');
  } catch (error) { showToast(error.message, 'warning'); }
}

document.querySelector('#save-task').addEventListener('click', () => {
  if (!tracks.length) return showToast('请先导入至少一条轨迹', 'warning');
  document.querySelector('#task-name').value = currentTask.id ? currentTask.name : '';
  document.querySelector('#task-date').value = currentTask.taskDate;
  document.querySelector('#task-area').value = currentTask.area;
  document.querySelector('#task-notes').value = currentTask.notes;
  document.querySelector('#save-dialog').showModal();
});

document.querySelector('#task-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  currentTask.name = document.querySelector('#task-name').value.trim();
  currentTask.taskDate = document.querySelector('#task-date').value;
  currentTask.area = document.querySelector('#task-area').value.trim();
  currentTask.notes = document.querySelector('#task-notes').value.trim();
  try {
    await saveCurrentTask();
    document.querySelector('#save-dialog').close();
    showToast('任务已保存到当前浏览器', 'success');
  } catch (error) { showToast(error.message, 'warning'); }
});

document.querySelector('#history-task').addEventListener('click', async () => {
  document.querySelector('#history-dialog').showModal();
  await renderHistory();
});

document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));

document.querySelector('#sidebar-toggle').addEventListener('click', () => sidebar.classList.toggle('is-open'));
map.on('click', () => sidebar.classList.remove('is-open'));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => applyTrackMode(button.dataset.mode)));

document.querySelector('#coverage-toggle').addEventListener('change', (event) => {
  coverageEnabled = event.target.checked;
  document.querySelector('#radius-controls').hidden = !coverageEnabled;
  refreshAllCoverage();
});

document.querySelectorAll('[data-radius]').forEach((button) => button.addEventListener('click', () => {
  const custom = button.dataset.radius === 'custom';
  document.querySelector('#custom-radius-wrap').hidden = !custom;
  document.querySelectorAll('[data-radius]').forEach((item) => item.classList.toggle('is-active', item === button));
  coverageRadius = custom ? Number(document.querySelector('#custom-radius').value) : Number(button.dataset.radius);
  refreshAllCoverage();
}));

document.querySelector('#custom-radius').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  if (Number.isFinite(value) && value >= 1 && value <= 500) {
    coverageRadius = value;
    refreshAllCoverage();
  }
});
updateUi();
updateStorageUsage();
