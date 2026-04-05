import { useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { PowerButton } from './PowerButton';
import { RotateButton } from './RotateButton';
import * as api from '../services/api';
import './DeviceCell.css';

export function DeviceCell({ device, hasSession, isMaster, onMirrorToggle, onSelectMaster, onContextMenu, onDoubleClick, canvasWidth, canvasHeight }) {
  const [renaming, setRenaming] = useState(false);
  const [nickname, setNickname] = useState(device.nickname || '');

  const displayName = device.nickname || device.deviceName || device.model;

  const handleRename = async () => {
    const trimmed = nickname.trim();
    if (trimmed) {
      await api.renameDevice(device.serial, trimmed);
    }
    setRenaming(false);
  };

  return (
    <div className="dashboard-device-cell" onContextMenu={e => onContextMenu?.(e, device)} onDoubleClick={() => onDoubleClick?.(device.serial)}>
      {/* Top bar: name + power */}
      <div className="dashboard-device-topbar">
        <span className="dashboard-dot" style={{ background: device.status === 'device' ? '#a6e3a1' : '#f38ba8' }} />

        {renaming ? (
          <input
            className="dashboard-rename-input"
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
          <span
            className="dashboard-device-name"
            onClick={() => { setNickname(device.nickname || ''); setRenaming(true); }}
            title="Click to rename"
          >
            {displayName}
          </span>
        )}

        {isMaster && <span className="dashboard-master-badge">MASTER</span>}

        <RotateButton serial={device.serial} />
        <PowerButton serial={device.serial} />
      </div>

      {/* Phone screen or placeholder */}
      {hasSession ? (
        <VideoPlayer
          key={`${device.serial}-${canvasWidth}-${canvasHeight}`}
          serial={device.serial}
          deviceName={displayName}
          onClose={() => onMirrorToggle(device.serial, true)}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      ) : (
        <div className="dashboard-device-placeholder" style={{ width: canvasWidth, height: canvasHeight }}>
          <p className="placeholder-model">{device.brand} {device.model}</p>
          <p className="placeholder-info">{device.screenWidth}x{device.screenHeight} &middot; Android {device.androidVersion}</p>
          <div className="placeholder-actions">
            <button className="btn btn-primary" onClick={() => onMirrorToggle(device.serial, false)}>
              Start Mirror
            </button>
            <button
              className={`btn ${isMaster ? 'btn-warning' : 'btn-secondary'}`}
              onClick={() => onSelectMaster(device.serial)}
            >
              {isMaster ? 'Unset Master' : 'Set Master'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
