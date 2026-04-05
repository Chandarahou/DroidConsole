import { useState, useEffect, useCallback } from 'react';
import { VideoPlayer } from '../components/VideoPlayer';
import { PowerButton } from '../components/PowerButton';
import { controlSocket } from '../services/websocket';
import * as api from '../services/api';
import './ShareView.css';

export function ShareView({ token }) {
  const [status, setStatus] = useState('validating');
  const [share, setShare] = useState(null);
  const [error, setError] = useState('');
  const [gridCols, setGridCols] = useState(0); // 0 = auto

  // Connect the control WebSocket for touch/keyboard input
  useEffect(() => {
    controlSocket.connect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function validate() {
      try {
        const res = await api.validateShare(token);
        if (cancelled) return;
        setShare(res.share);
        setStatus('active');
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Invalid or expired share link');
        setStatus('error');
      }
    }

    validate();
    return () => { cancelled = true; };
  }, [token]);

  if (status === 'validating') {
    return (
      <div className="share-view">
        <div className="share-view-center">
          <div className="share-loading">Validating share link...</div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="share-view">
        <div className="share-view-center">
          <div className="share-error">
            <h2>Share Link Invalid</h2>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const deviceCount = share.devices.length;
  const autoGridCols = deviceCount <= 1 ? 1 : deviceCount <= 4 ? 2 : deviceCount <= 9 ? 3 : 4;
  const cols = gridCols || autoGridCols;

  // Scale canvas size based on grid columns
  const canvasSizes = {
    1: { w: 320, h: 700 },
    2: { w: 260, h: 570 },
    3: { w: 200, h: 440 },
    4: { w: 170, h: 375 },
  };
  const { w: canvasW, h: canvasH } = canvasSizes[cols] || canvasSizes[4];

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

  return (
    <div className="share-view">
      <div className="share-view-header">
        <div className="share-header-left">
          <h2>{share.name ? `Shared to: ${share.name}` : 'Shared Devices'}</h2>
          <span className="share-view-badge">
            {share.permissions.view && 'View'}
            {share.permissions.view && share.permissions.control && ' + '}
            {share.permissions.control && 'Control'}
          </span>
          <span className="share-view-count">{deviceCount} device{deviceCount !== 1 ? 's' : ''}</span>
          <span className="share-view-expiry">{formatExpiry(share.expiresAt)}</span>
        </div>
        <div className="share-header-right">
          <label className="grid-selector">
            Grid:
            <select value={gridCols} onChange={e => setGridCols(Number(e.target.value))}>
              <option value={0}>Auto</option>
              <option value={1}>1 col</option>
              <option value={2}>2 cols</option>
              <option value={3}>3 cols</option>
              <option value={4}>4 cols</option>
            </select>
          </label>
        </div>
      </div>

      <div className="share-view-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {share.devices.map(device => (
          <div key={device.serial} className="share-device-cell">
            <div className="share-device-label">
              <span className={`share-dot ${device.connected ? 'online' : 'offline'}`} />
              <span className="share-device-title">{device.name}</span>
              {device.connected && share.permissions.control && (
                <PowerButton serial={device.serial} />
              )}
            </div>
            {device.connected ? (
              <VideoPlayer
                serial={device.serial}
                deviceName={device.name}
                token={token}
                canvasWidth={canvasW}
                canvasHeight={canvasH}
                onClose={() => {}}
              />
            ) : (
              <div className="share-device-offline" style={{ width: canvasW, height: canvasH }}>
                <p>Device offline</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
