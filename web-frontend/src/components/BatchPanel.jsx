import { useState } from 'react';
import * as api from '../services/api';
import './BatchPanel.css';

export function BatchPanel({ devices, selectedSerials, onSelectionChange }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [apkPath, setApkPath] = useState('');
  const [packageName, setPackageName] = useState('');
  const [shellCmd, setShellCmd] = useState('');
  const [transferFile, setTransferFile] = useState(null);
  const [remotePath, setRemotePath] = useState('/sdcard/Download/');
  const [transferProgress, setTransferProgress] = useState('');

  const serials = selectedSerials.length > 0
    ? selectedSerials
    : devices.filter(d => d.status === 'device').map(d => d.serial);

  const handleAction = async (action) => {
    setLoading(true);
    setResults(null);
    try {
      let res;
      switch (action) {
        case 'push-file':
          if (!transferFile) return;
          setTransferProgress(`Uploading ${transferFile.name}...`);
          res = await api.batchPushFile(serials, transferFile, remotePath.trim() || '/sdcard/Download/');
          setTransferProgress('');
          setTransferFile(null);
          break;
        case 'install':
          if (!apkPath.trim()) return;
          res = await api.batchInstallApk(serials, apkPath.trim());
          break;
        case 'clear':
          if (!packageName.trim()) return;
          res = await api.batchClearData(serials, packageName.trim());
          break;
        case 'reboot':
          res = await api.batchReboot(serials);
          break;
        case 'shell':
          if (!shellCmd.trim()) return;
          res = await api.batchShell(serials, shellCmd.trim());
          break;
        case 'screenshot':
          res = await api.batchScreenshot(serials);
          break;
      }
      setResults(res?.results || []);
    } catch (err) {
      setResults([{ serial: 'all', success: false, error: err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const toggleDevice = (serial) => {
    const next = selectedSerials.includes(serial)
      ? selectedSerials.filter(s => s !== serial)
      : [...selectedSerials, serial];
    onSelectionChange(next);
  };

  return (
    <div className="batch-panel">
      <h3>Batch Operations</h3>

      <div className="batch-targets">
        <span className="target-label">
          Targets: {serials.length} device{serials.length !== 1 ? 's' : ''}
        </span>
        <div className="target-chips">
          {devices.filter(d => d.status === 'device').map(d => (
            <button
              key={d.serial}
              className={`chip ${selectedSerials.includes(d.serial) || selectedSerials.length === 0 ? 'active' : ''}`}
              onClick={() => toggleDevice(d.serial)}
            >
              {d.nickname || d.deviceName || d.model}
            </button>
          ))}
        </div>
      </div>

      <div className="batch-actions">
        <div className="action-group file-transfer-group">
          <label className="file-transfer-label">File Transfer (PC → Phone)</label>
          <div className="file-transfer-row">
            <label className="file-pick-btn btn btn-secondary">
              {transferFile ? transferFile.name : 'Choose File'}
              <input
                type="file"
                style={{ display: 'none' }}
                onChange={e => setTransferFile(e.target.files[0] || null)}
              />
            </label>
            <input
              placeholder="Destination: /sdcard/Download/"
              value={remotePath}
              onChange={e => setRemotePath(e.target.value)}
              className="remote-path-input"
            />
            <button
              className="btn btn-primary"
              onClick={() => handleAction('push-file')}
              disabled={loading || !transferFile}
            >
              {loading && transferProgress ? 'Pushing...' : 'Push File'}
            </button>
          </div>
          {transferFile && (
            <div className="file-info">
              {transferFile.name} ({(transferFile.size / 1024 / 1024).toFixed(1)} MB)
              → {serials.length} device{serials.length !== 1 ? 's' : ''}
            </div>
          )}
          {transferProgress && <div className="transfer-progress">{transferProgress}</div>}
        </div>

        <div className="action-group">
          <input
            placeholder="APK path on host PC..."
            value={apkPath}
            onChange={e => setApkPath(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => handleAction('install')} disabled={loading}>
            Install APK
          </button>
        </div>

        <div className="action-group">
          <input
            placeholder="Package name (e.g. com.example.app)"
            value={packageName}
            onChange={e => setPackageName(e.target.value)}
          />
          <button className="btn btn-warning" onClick={() => handleAction('clear')} disabled={loading}>
            Clear Data
          </button>
        </div>

        <div className="action-group">
          <input
            placeholder="Shell command..."
            value={shellCmd}
            onChange={e => setShellCmd(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={() => handleAction('shell')} disabled={loading}>
            Run Shell
          </button>
        </div>

        <div className="action-buttons">
          <button className="btn btn-danger" onClick={() => handleAction('reboot')} disabled={loading}>
            Reboot All
          </button>
          <button className="btn btn-primary" onClick={() => handleAction('screenshot')} disabled={loading}>
            Screenshot All
          </button>
        </div>
      </div>

      {loading && <div className="batch-loading">Running batch operation...</div>}

      {results && (
        <div className="batch-results">
          <h4>Results</h4>
          {results.map((r, i) => (
            <div key={i} className={`result-row ${r.success ? 'success' : 'error'}`}>
              <span className="result-serial">{r.serial}</span>
              <span className="result-status">{r.success ? 'OK' : r.error}</span>
              {r.image && <img src={r.image} alt={r.serial} className="result-screenshot" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
