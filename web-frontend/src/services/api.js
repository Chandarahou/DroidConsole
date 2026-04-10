// Dev: use same hostname as page (supports LAN access). Production: relative URL via nginx.
const API_BASE = import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : '');

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Devices
export const getDevices = () => request('/api/devices');
export const getDevice = (serial) => request(`/api/devices/${serial}`);
export const renameDevice = (serial, nickname) =>
  request(`/api/devices/${serial}/rename`, { method: 'POST', body: JSON.stringify({ nickname }) });
export const connectTcpDevice = (ip, port) =>
  request('/api/devices/connect-tcp', { method: 'POST', body: JSON.stringify({ ip, port }) });

// Sessions
export const getSessions = () => request('/api/sessions');
export const startSession = (serial, options = {}) =>
  request(`/api/sessions/${serial}/start`, { method: 'POST', body: JSON.stringify(options) });
export const stopSession = (serial) =>
  request(`/api/sessions/${serial}/stop`, { method: 'POST' });

// Groups
export const getGroups = () => request('/api/groups');
export const createGroup = (name) =>
  request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
export const deleteGroup = (id) =>
  request(`/api/groups/${id}`, { method: 'DELETE' });
export const addDeviceToGroup = (groupId, serial) =>
  request(`/api/groups/${groupId}/add-device`, { method: 'POST', body: JSON.stringify({ serial }) });
export const removeDeviceFromGroup = (groupId, serial) =>
  request(`/api/groups/${groupId}/remove-device`, { method: 'POST', body: JSON.stringify({ serial }) });

// Master/Slave
export const setMaster = (serial) =>
  request('/api/master/set', { method: 'POST', body: JSON.stringify({ serial }) });
export const clearMaster = () =>
  request('/api/master/clear', { method: 'POST' });

// Batch
export const batchInstallApk = (serials, apkPath) =>
  request('/api/batch/install-apk', { method: 'POST', body: JSON.stringify({ serials, apkPath }) });
export const batchClearData = (serials, packageName) =>
  request('/api/batch/clear-data', { method: 'POST', body: JSON.stringify({ serials, packageName }) });
export const batchReboot = (serials) =>
  request('/api/batch/reboot', { method: 'POST', body: JSON.stringify({ serials }) });
export const batchShell = (serials, command) =>
  request('/api/batch/shell', { method: 'POST', body: JSON.stringify({ serials, command }) });
export const batchScreenshot = (serials) =>
  request('/api/batch/screenshot', { method: 'POST', body: JSON.stringify({ serials }) });

// File Transfer — uses FormData (multipart), not JSON
export async function batchPushFile(serials, file, remotePath) {
  const form = new FormData();
  form.append('file', file);
  form.append('serials', JSON.stringify(serials));
  form.append('remotePath', remotePath);

  const res = await fetch(`${API_BASE}/api/batch/push-file`, {
    method: 'POST',
    body: form,
    // No Content-Type header — browser sets multipart boundary automatically
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Share
export const createShare = (serials, expiresInMinutes, permissions, name) =>
  request('/api/share/create', { method: 'POST', body: JSON.stringify({ serials, expiresInMinutes, permissions, name }) });
export const getShares = () => request('/api/share/list');
export const updateShareDevices = (token, serials) =>
  request(`/api/share/${token}/update-devices`, { method: 'POST', body: JSON.stringify({ serials }) });
export const revokeShare = (token) =>
  request(`/api/share/${token}/revoke`, { method: 'POST' });
export const validateShare = (token) =>
  request(`/api/share/${token}/validate`);

// WhatsApp Register
export const waRegisterType = (serial, phoneNumber, countryCode) =>
  request('/api/wa-register/type', { method: 'POST', body: JSON.stringify({ serial, phoneNumber, countryCode }) });
export const waRegisterBatch = (entries) =>
  request('/api/wa-register/batch', { method: 'POST', body: JSON.stringify({ entries }) });

// Warm-up
export const getWarmupStatus = () => request('/api/warmup/status');
export const getWarmupDevice = (serial) => request(`/api/warmup/${serial}`);
export const startWarmup = (serial, contacts, options) =>
  request('/api/warmup/start', { method: 'POST', body: JSON.stringify({ serial, contacts, options }) });
export const stopWarmup = (serial) =>
  request('/api/warmup/stop', { method: 'POST', body: JSON.stringify({ serial }) });
export const pauseWarmup = (serial) =>
  request('/api/warmup/pause', { method: 'POST', body: JSON.stringify({ serial }) });
export const updateWarmupContacts = (serial, contacts) =>
  request('/api/warmup/contacts', { method: 'POST', body: JSON.stringify({ serial, contacts }) });
export const executeWarmupAction = (serial, force = false, message = undefined) =>
  request('/api/warmup/execute', { method: 'POST', body: JSON.stringify({ serial, force, message }) });
export const warmupAutoStart = (serial) =>
  request('/api/warmup/auto-start', { method: 'POST', body: JSON.stringify({ serial }) });
export const warmupAutoStop = (serial) =>
  request('/api/warmup/auto-stop', { method: 'POST', body: JSON.stringify({ serial }) });

// Network info
export const getNetworkInfo = () => request('/api/network-info');

// Internet Tunnel
export const startTunnel = () => request('/api/tunnel/start', { method: 'POST' });
export const stopTunnel = () => request('/api/tunnel/stop', { method: 'POST' });
export const getTunnelStatus = () => request('/api/tunnel/status');

// --- Remote host helpers (for connecting to another APM instance) ---

export function remoteRequest(hostUrl, path, options = {}) {
  return fetch(`${hostUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      // localtunnel shows an auth/reminder page unless this header is set.
      // Safe to send on all remote requests — non-localtunnel hosts ignore it.
      'Bypass-Tunnel-Reminder': 'true',
      ...options.headers,
    },
    ...options,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  });
}

export const remoteValidateShare = (hostUrl, token) =>
  remoteRequest(hostUrl, `/api/share/${token}/validate`);

export const remoteHealthCheck = (hostUrl) =>
  remoteRequest(hostUrl, '/api/health');
