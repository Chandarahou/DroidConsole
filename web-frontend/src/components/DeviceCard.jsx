import { useState } from 'react';
import * as api from '../services/api';
import './DeviceCard.css';

export function DeviceCard({ device, session, isMaster, onMirrorToggle, onSelectMaster }) {
  const [renaming, setRenaming] = useState(false);
  const [nickname, setNickname] = useState(device.nickname || '');
  const [mirrorLoading, setMirrorLoading] = useState(false);

  const statusColor = {
    device: '#4caf50',
    unauthorized: '#ff9800',
    offline: '#f44336',
  }[device.status] || '#999';

  const handleRename = async () => {
    if (nickname.trim()) {
      await api.renameDevice(device.serial, nickname.trim());
    }
    setRenaming(false);
  };

  return (
    <div className={`device-card ${isMaster ? 'master' : ''} ${session ? 'mirroring' : ''}`}>
      <div className="device-header">
        <span className="status-dot" style={{ backgroundColor: statusColor }} />
        {renaming ? (
          <input
            className="rename-input"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setNickname(device.nickname || ''); setRenaming(false); }
            }}
            autoFocus
          />
        ) : (
          <>
            <span className="device-name" onDoubleClick={() => setRenaming(true)}>
              {device.nickname || device.deviceName || device.model}
            </span>
            <button className="rename-btn" onClick={() => { setNickname(device.nickname || ''); setRenaming(true); }} title="Rename device">&#9998;</button>
          </>
        )}
        {isMaster && <span className="master-badge">MASTER</span>}
      </div>

      <div className="device-info">
        <div className="info-row">
          <span className="label">Serial:</span>
          <span className="value">{device.serial}</span>
        </div>
        <div className="info-row">
          <span className="label">Model:</span>
          <span className="value">{device.brand} {device.model}</span>
        </div>
        <div className="info-row">
          <span className="label">Android:</span>
          <span className="value">{device.androidVersion} (SDK {device.sdkLevel})</span>
        </div>
        <div className="info-row">
          <span className="label">Resolution:</span>
          <span className="value">{device.screenWidth}x{device.screenHeight}</span>
        </div>
      </div>

      <div className="device-actions">
        <button
          className={`btn ${session ? 'btn-danger' : 'btn-primary'}`}
          disabled={mirrorLoading}
          onClick={async () => {
            setMirrorLoading(true);
            try { await onMirrorToggle(device.serial, !!session); }
            finally { setMirrorLoading(false); }
          }}
        >
          {mirrorLoading ? (session ? 'Stopping...' : 'Starting...') : session ? 'Stop Mirror' : 'Start Mirror'}
        </button>
        <button
          className={`btn ${isMaster ? 'btn-warning' : 'btn-secondary'}`}
          onClick={() => onSelectMaster(device.serial)}
        >
          {isMaster ? 'Unset Master' : 'Set Master'}
        </button>
      </div>
    </div>
  );
}
