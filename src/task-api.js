async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('未连接到本地数据库服务，请通过“启动轨迹查看器.bat”重新打开项目');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本地数据服务请求失败');
  return data;
}

export const taskApi = {
  list: () => request('/api/tasks'),
  get: (id) => request(`/api/tasks/${id}`),
  create: (task) => request('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
  update: (id, task) => request(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(task) }),
  remove: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  removeTrack: (taskId, trackId) => request(`/api/tasks/${taskId}/tracks/${trackId}`, { method: 'DELETE' }),
};
