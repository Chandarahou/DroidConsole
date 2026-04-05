import { useState } from 'react';
import * as api from '../services/api';
import './ConnectDialog.css';

export function ConnectDialog({ onClose }) {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('5555');
  const [status, setStatus] = useState(null);

  const handleConnect = async () => {
    if (!ip.trim()) return;
    setStatus('connecting');
    try {
      const res = await api.connectTcpDevice(ip.trim(), parseInt(port));
      setStatus(res.success ? 'success' : 'failed');
      if (res.success) {
        setTimeout(onClose, 1000);
      }
    } catch (err) {
      setStatus('failed');
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Connect TCP/IP Device</h3>
        <p className="dialog-hint">
          First run <code>adb tcpip 5555</code> on the device while connected via USB.
        </p>
        <div className="dialog-form">
          <input
            placeholder="Device IP address"
            value={ip}
            onChange={e => setIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
            autoFocus
          />
          <input
            placeholder="Port"
            value={port}
            onChange={e => setPort(e.target.value)}
            style={{ width: 80 }}
          />
          <button className="btn btn-primary" onClick={handleConnect} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
        </div>
        {status === 'success' && <p className="status-success">Connected successfully!</p>}
        {status === 'failed' && <p className="status-error">Connection failed. Check IP and ensure device is reachable.</p>}
      </div>
    </div>
  );
}
