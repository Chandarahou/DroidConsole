import { useState, useEffect } from 'react';
import * as api from '../services/api';
import './SharePanel.css';

export function SharePanel({ devices }) {
  const [shares, setShares] = useState([]);
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [expiryValue, setExpiryValue] = useState(1);
  const [expiryUnit, setExpiryUnit] = useState('hours');
  const [permissions, setPermissions] = useState({ view: true, control: true });
  const [shareName, setShareName] = useState('');
  const [newShareUrl, setNewShareUrl] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [editSerials, setEditSerials] = useState([]);
  const [networkInfo, setNetworkInfo] = useState(null);

  useEffect(() => {
    loadShares();
    api.getNetworkInfo().then(setNetworkInfo).catch(() => {});
    const interval = setInterval(loadShares, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadShares = async () => {
    try {
      const res = await api.getShares();
      setShares(res.shares || []);
    } catch { /* ignore */ }
  };

  const toggleDevice = (serial) => {
    setSelectedSerials(prev =>
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  const selectAll = () => {
    const allSerials = devices.filter(d => d.status === 'device').map(d => d.serial);
    setSelectedSerials(allSerials);
  };

  const selectNone = () => setSelectedSerials([]);

  const getExpiryMinutes = () => {
    const v = Math.max(1, expiryValue);
    switch (expiryUnit) {
      case 'minutes': return Math.min(v, 30 * 24 * 60);
      case 'hours': return Math.min(v * 60, 30 * 24 * 60);
      case 'days': return Math.min(v * 24 * 60, 30 * 24 * 60);
      default: return 60;
    }
  };

  const handleCreateShare = async () => {
    if (selectedSerials.length === 0 || !shareName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createShare(selectedSerials, getExpiryMinutes(), permissions, shareName.trim());
      // Build a LAN-accessible URL using the detected IP
      const lanIp = networkInfo?.addresses?.[0]?.address || window.location.hostname;
      const port = networkInfo?.port || 3001;
      setNewShareUrl(`${lanIp}:${port}|${res.share.token}`);
      loadShares();
    } catch (err) {
      alert('Failed to create share: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token) => {
    await api.revokeShare(token);
    loadShares();
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const formatExpiry = (expiresAt) => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const mins = Math.floor(remaining / 60000);
    if (mins < 60) return `${mins}m left`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h left`;
  };

  const connectedDevices = devices.filter(d => d.status === 'device');

  return (
    <div className="share-panel">
      <h3>Remote Sharing</h3>

      <div className="share-create">
        {/* Share Name */}
        <div className="share-section">
          <label className="share-section-label">Share To (Name)</label>
          <input
            className="share-name-input"
            placeholder="e.g. John, QA Team, Client..."
            value={shareName}
            onChange={e => setShareName(e.target.value)}
          />
        </div>

        {/* Device Selection */}
        <div className="share-section">
          <label className="share-section-label">Select Devices</label>
          <div className="share-select-actions">
            <button className="btn btn-small btn-secondary" onClick={selectAll}>Select All</button>
            <button className="btn btn-small btn-secondary" onClick={selectNone}>Clear</button>
            <span className="share-selected-count">{selectedSerials.length} selected</span>
          </div>
          <div className="share-device-list">
            {connectedDevices.map(d => (
              <label key={d.serial} className={`share-device-item ${selectedSerials.includes(d.serial) ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedSerials.includes(d.serial)}
                  onChange={() => toggleDevice(d.serial)}
                />
                <span className="share-device-name">{d.nickname || d.deviceName || d.model}</span>
                <span className="share-device-serial">{d.serial}</span>
              </label>
            ))}
            {connectedDevices.length === 0 && (
              <p className="share-empty">No devices connected</p>
            )}
          </div>
        </div>

        {/* Duration */}
        <div className="share-section">
          <label className="share-section-label">Duration (max 30 days)</label>
          <div className="share-duration-row">
            <input
              type="number"
              min="1"
              max={expiryUnit === 'days' ? 30 : expiryUnit === 'hours' ? 720 : 43200}
              value={expiryValue}
              onChange={e => setExpiryValue(Math.max(1, parseInt(e.target.value) || 1))}
              className="share-duration-input"
            />
            <select value={expiryUnit} onChange={e => setExpiryUnit(e.target.value)} className="share-duration-unit">
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>

        {/* Permissions */}
        <div className="share-section">
          <label className="share-section-label">Permissions</label>
          <div className="share-perms-row">
            <label className="checkbox-label">
              <input type="checkbox" checked={permissions.view} onChange={e => setPermissions(p => ({ ...p, view: e.target.checked }))} />
              View
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={permissions.control} onChange={e => setPermissions(p => ({ ...p, control: e.target.checked }))} />
              Control
            </label>
          </div>
        </div>

        <button
          className="btn btn-primary share-create-btn"
          onClick={handleCreateShare}
          disabled={selectedSerials.length === 0 || !shareName.trim() || creating}
        >
          {creating ? 'Creating...' : `Share ${selectedSerials.length} Device${selectedSerials.length !== 1 ? 's' : ''}`}
        </button>

        {newShareUrl && (
          <div className="share-url-result">
            <label className="share-section-label">Share Code (send this to receiver)</label>
            <div className="share-url-box">
              <input readOnly value={newShareUrl} />
              <button className="btn btn-secondary" onClick={() => copyToClipboard(newShareUrl)}>Copy</button>
            </div>
            <p className="share-url-hint">
              The receiver pastes this in their DroidConsole app under "Received" tab to connect.
            </p>
            {networkInfo && networkInfo.addresses.length > 1 && (
              <details className="share-ip-details">
                <summary>Other network addresses</summary>
                {networkInfo.addresses.map((a, i) => {
                  const code = `${a.address}:${networkInfo.port}|${newShareUrl.split('|')[1]}`;
                  return (
                    <div key={i} className="share-alt-ip">
                      <span>{a.name}: {a.address}</span>
                      <button className="btn btn-small btn-secondary" onClick={() => copyToClipboard(code)}>Copy</button>
                    </div>
                  );
                })}
              </details>
            )}
          </div>
        )}
      </div>

      {/* Active Shares */}
      {shares.length > 0 && (
        <div className="active-shares">
          <h4>Active Shares ({shares.length})</h4>
          {shares.map(share => {
            const isEditing = editingToken === share.token;
            const sharedDeviceNames = share.serials.map(s => {
              const d = devices.find(dev => dev.serial === s);
              return { serial: s, name: d?.nickname || d?.deviceName || d?.model || s };
            });
            const connectedAll = devices.filter(d => d.status === 'device');

            const startEdit = () => {
              setEditingToken(share.token);
              setEditSerials([...share.serials]);
            };

            const toggleEditDevice = (serial) => {
              setEditSerials(prev => prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]);
            };

            const saveEdit = async () => {
              if (editSerials.length === 0) return;
              try {
                await api.updateShareDevices(share.token, editSerials);
                setEditingToken(null);
                loadShares();
              } catch (err) {
                alert('Failed to update: ' + err.message);
              }
            };

            const cancelEdit = () => {
              setEditingToken(null);
              setEditSerials([]);
            };

            return (
            <div key={share.token} className="share-row">
              <div className="share-info">
                <div className="share-info-top">
                  <span className={`share-name-tag ${share.name ? '' : 'no-name'}`}>
                    {share.name ? `To: ${share.name}` : 'No name'}
                  </span>
                  <span className="share-perms">
                    {share.permissions.view && 'View'}
                    {share.permissions.view && share.permissions.control && ' + '}
                    {share.permissions.control && 'Control'}
                  </span>
                  <span className="share-expiry">{formatExpiry(share.expiresAt)}</span>
                </div>

                {isEditing ? (
                  <div className="share-edit-devices">
                    {connectedAll.map(d => {
                      const name = d.nickname || d.deviceName || d.model;
                      const checked = editSerials.includes(d.serial);
                      return (
                        <label key={d.serial} className={`share-edit-device-item ${checked ? 'selected' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleEditDevice(d.serial)} />
                          <span>{name}</span>
                        </label>
                      );
                    })}
                    <div className="share-edit-actions">
                      <button className="btn btn-small btn-primary" onClick={saveEdit} disabled={editSerials.length === 0}>
                        Save ({editSerials.length})
                      </button>
                      <button className="btn btn-small btn-secondary" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="share-info-devices">
                    {sharedDeviceNames.map((d, i) => (
                      <span key={i} className="share-device-chip">{d.name}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="share-row-actions">
                {!isEditing && (
                  <button className="btn btn-small btn-secondary" onClick={startEdit}>Edit</button>
                )}
                <button className="btn btn-small btn-secondary" onClick={() => {
                  const lanIp = networkInfo?.addresses?.[0]?.address || window.location.hostname;
                  const port = networkInfo?.port || 3001;
                  copyToClipboard(`${lanIp}:${port}|${share.token}`);
                }}>
                  Copy Code
                </button>
                <button className="btn btn-small btn-danger" onClick={() => handleRevoke(share.token)}>
                  Revoke
                </button>
              </div>
            </div>);})}

        </div>
      )}
    </div>
  );
}
