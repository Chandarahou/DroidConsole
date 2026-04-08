import { useState, useMemo } from 'react';
import * as api from '../services/api';
import './WaRegisterPanel.css';

/**
 * WhatsApp Register panel.
 * Precondition: devices must already be on the WhatsApp registration page.
 * Each row = 1 device. User enters phone numbers, clicks Register All.
 */
export function WaRegisterPanel({ devices, sessions }) {
  const [countryCode, setCountryCode] = useState('');
  const [phoneNumbers, setPhoneNumbers] = useState({}); // serial -> number
  const [statuses, setStatuses] = useState({}); // serial -> 'idle' | 'typing' | 'done' | 'error'
  const [bulkText, setBulkText] = useState('');
  const [running, setRunning] = useState(false);

  // Only show devices that have an active mirror session (precondition: must be on WA register page)
  const activeDevices = useMemo(() =>
    devices.filter(d => d.status === 'device' && sessions.some(s => s.serial === d.serial)),
    [devices, sessions]
  );

  const setPhone = (serial, number) => {
    setPhoneNumbers(prev => ({ ...prev, [serial]: number }));
  };

  // Bulk paste: one number per line, fills rows top to bottom
  const handleBulkPaste = () => {
    const lines = bulkText.split('\n').map(l => l.trim().replace(/\D/g, '')).filter(Boolean);
    const updated = { ...phoneNumbers };
    activeDevices.forEach((device, i) => {
      if (i < lines.length) {
        updated[device.serial] = lines[i];
      }
    });
    setPhoneNumbers(updated);
    setBulkText('');
  };

  // Register a single device
  const handleRegisterOne = async (serial) => {
    const number = phoneNumbers[serial];
    if (!number) return;

    setStatuses(prev => ({ ...prev, [serial]: 'typing' }));
    try {
      const cc = countryCode.replace(/\D/g, '') || undefined;
      await api.waRegisterType(serial, number, cc);
      setStatuses(prev => ({ ...prev, [serial]: 'done' }));
    } catch (err) {
      setStatuses(prev => ({ ...prev, [serial]: 'error' }));
    }
  };

  // Register all devices
  const handleRegisterAll = async () => {
    const entries = activeDevices
      .filter(d => phoneNumbers[d.serial]?.trim())
      .map(d => ({
        serial: d.serial,
        phoneNumber: phoneNumbers[d.serial],
        countryCode: countryCode.replace(/\D/g, '') || undefined,
      }));

    if (entries.length === 0) return;

    setRunning(true);
    // Mark all as typing
    const newStatuses = {};
    entries.forEach(e => { newStatuses[e.serial] = 'typing'; });
    setStatuses(prev => ({ ...prev, ...newStatuses }));

    try {
      const res = await api.waRegisterBatch(entries);
      const updated = {};
      res.results.forEach(r => {
        updated[r.serial] = r.success ? 'done' : 'error';
      });
      setStatuses(prev => ({ ...prev, ...updated }));
    } catch {
      entries.forEach(e => {
        setStatuses(prev => ({ ...prev, [e.serial]: 'error' }));
      });
    }
    setRunning(false);
  };

  const filledCount = activeDevices.filter(d => phoneNumbers[d.serial]?.trim()).length;

  const statusIcon = (status) => {
    switch (status) {
      case 'typing': return '\u23F3'; // hourglass
      case 'done': return '\u2705';   // green check
      case 'error': return '\u274C';  // red X
      default: return '';
    }
  };

  return (
    <div className="wa-panel">
      <h3>WhatsApp Register</h3>

      <div className="wa-warning">
        All devices must already be on the WhatsApp "Enter your phone number" page before using this feature.
        The mirror session must be active (screen visible in Devices tab).
      </div>

      {/* Country code (shared for all) */}
      <div className="wa-cc-row">
        <label className="wa-label">Country Code (optional, applies to all)</label>
        <input
          className="wa-cc-input"
          placeholder="e.g. 1 for US, 60 for MY"
          value={countryCode}
          onChange={e => setCountryCode(e.target.value)}
        />
      </div>

      {/* Bulk paste */}
      <div className="wa-bulk-section">
        <label className="wa-label">Bulk Paste (one number per line)</label>
        <div className="wa-bulk-row">
          <textarea
            className="wa-bulk-input"
            placeholder={"1234567890\n0987654321\n5551234567"}
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            rows={3}
          />
          <button className="btn btn-secondary" onClick={handleBulkPaste} disabled={!bulkText.trim()}>
            Fill Rows
          </button>
        </div>
      </div>

      {/* Device grid */}
      <div className="wa-grid">
        <div className="wa-grid-header">
          <span className="wa-col-status">#</span>
          <span className="wa-col-device">Device</span>
          <span className="wa-col-phone">Phone Number</span>
          <span className="wa-col-action">Action</span>
        </div>

        {activeDevices.length === 0 ? (
          <div className="wa-empty">
            No devices with active mirror sessions.
            Start mirroring devices on the Devices tab first, then navigate them to WhatsApp registration.
          </div>
        ) : (
          activeDevices.map((device, i) => {
            const status = statuses[device.serial] || 'idle';
            const displayName = device.nickname || device.deviceName || device.model;
            return (
              <div key={device.serial} className={`wa-row ${status}`}>
                <span className="wa-col-status">
                  {status === 'idle' ? i + 1 : statusIcon(status)}
                </span>
                <span className="wa-col-device" title={device.serial}>
                  {displayName}
                </span>
                <input
                  className="wa-col-phone wa-phone-input"
                  placeholder="Phone number"
                  value={phoneNumbers[device.serial] || ''}
                  onChange={e => setPhone(device.serial, e.target.value)}
                  disabled={status === 'typing'}
                />
                <button
                  className="btn btn-small btn-primary wa-col-action"
                  onClick={() => handleRegisterOne(device.serial)}
                  disabled={!phoneNumbers[device.serial]?.trim() || status === 'typing'}
                >
                  {status === 'typing' ? '...' : 'Go'}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Register All button */}
      {activeDevices.length > 0 && (
        <button
          className="btn btn-primary wa-register-all"
          onClick={handleRegisterAll}
          disabled={filledCount === 0 || running}
        >
          {running ? 'Registering...' : `Register All (${filledCount} device${filledCount !== 1 ? 's' : ''})`}
        </button>
      )}
    </div>
  );
}
