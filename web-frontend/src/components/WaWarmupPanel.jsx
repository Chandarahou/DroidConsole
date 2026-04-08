import { useState, useEffect } from 'react';
import * as api from '../services/api';
import './WaWarmupPanel.css';

const PHASES = {
  1: { name: 'Setup', desc: 'Profile setup only, no messages' },
  2: { name: 'Light', desc: '3-5 messages/day to friendly numbers' },
  3: { name: 'Moderate', desc: '10-15 messages/day, join groups' },
  4: { name: 'Scaling', desc: '20-30 messages/day, new contacts' },
  5: { name: 'Operational', desc: 'Full volume ready' },
};

export function WaWarmupPanel({ devices }) {
  const [warmupStates, setWarmupStates] = useState({});
  const [autoRunning, setAutoRunning] = useState({});
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [contactsText, setContactsText] = useState('');
  const [delayMin, setDelayMin] = useState(45);
  const [delayMax, setDelayMax] = useState(120);
  const [loading, setLoading] = useState({});
  const [distribute, setDistribute] = useState(false); // split contacts across devices
  const [useBusiness, setUseBusiness] = useState(false); // use WhatsApp Business instead
  const [expandedLogs, setExpandedLogs] = useState({}); // serial -> bool
  const [customMessages, setCustomMessages] = useState({}); // serial -> custom message text

  const activeDevices = devices.filter(d => d.status === 'device');

  // Poll warm-up status
  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const res = await api.getWarmupStatus();
      setWarmupStates(res.devices || {});
      // Check auto-run status for each
      const autoStatus = {};
      for (const serial of Object.keys(res.devices || {})) {
        try {
          const d = await api.getWarmupDevice(serial);
          autoStatus[serial] = d.autoRunning;
        } catch { /* ignore */ }
      }
      setAutoRunning(autoStatus);
    } catch { /* ignore */ }
  };

  const handleStart = async () => {
    if (selectedSerials.length === 0 || !contactsText.trim()) return;
    const allContacts = contactsText.split('\n').map(l => l.trim()).filter(Boolean);
    if (allContacts.length === 0) return;

    // If distribute is on, split contacts evenly across devices
    // Otherwise, each device gets the full contact list
    const contactsPerDevice = distribute
      ? splitContacts(allContacts, selectedSerials.length)
      : selectedSerials.map(() => allContacts);

    const results = await Promise.allSettled(
      selectedSerials.map(async (serial, i) => {
        setLoading(prev => ({ ...prev, [serial]: true }));
        try {
          await api.startWarmup(serial, contactsPerDevice[i], { delayMin, delayMax, useBusiness });
          return { serial, success: true };
        } catch (err) {
          return { serial, success: false, error: err.message };
        } finally {
          setLoading(prev => ({ ...prev, [serial]: false }));
        }
      })
    );

    const failed = results.filter(r => r.status === 'fulfilled' && !r.value.success);
    if (failed.length > 0) {
      alert(`Failed on ${failed.length} devices:\n` + failed.map(f => `${f.value.serial}: ${f.value.error}`).join('\n'));
    }

    setContactsText('');
    setSelectedSerials([]);
    await loadStatus();
  };

  // Split contacts array into N roughly-equal chunks
  const splitContacts = (arr, n) => {
    const result = Array.from({ length: n }, () => []);
    arr.forEach((c, i) => result[i % n].push(c));
    return result;
  };

  const toggleSerial = (serial) => {
    setSelectedSerials(prev =>
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  const selectAllDevices = () => {
    setSelectedSerials(devicesWithoutWarmup.map(d => d.serial));
  };

  const clearSelection = () => setSelectedSerials([]);

  const handleStop = async (serial) => {
    await api.stopWarmup(serial);
    await loadStatus();
  };

  const handlePause = async (serial) => {
    await api.pauseWarmup(serial);
    await loadStatus();
  };

  const handleExecuteOne = async (serial, force = false, message = undefined) => {
    setLoading(prev => ({ ...prev, [serial]: true }));
    const result = await api.executeWarmupAction(serial, force, message);
    await loadStatus();
    setLoading(prev => ({ ...prev, [serial]: false }));
    if (!result.success) alert(result.error);
  };

  const handleForceSend = async (serial) => {
    // If the user typed a custom message into the per-device input, use it.
    // Otherwise fall back to the random template (legacy Force Send behavior).
    const custom = (customMessages[serial] || '').trim();
    await handleExecuteOne(serial, true, custom || undefined);
  };

  const handleAutoToggle = async (serial) => {
    if (autoRunning[serial]) {
      await api.warmupAutoStop(serial);
    } else {
      await api.warmupAutoStart(serial);
    }
    await loadStatus();
  };

  const warmupEntries = Object.entries(warmupStates);
  const devicesWithoutWarmup = activeDevices.filter(d => !warmupStates[d.serial]);

  const formatTime = (ts) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="wu-panel">
      <h3>WhatsApp Warm-Up</h3>

      <div className="wu-info-box">
        Gradually warms up WhatsApp accounts by sending randomized messages to contacts over days.
        Messages are sent with random delays to mimic human behavior.
      </div>

      {/* Phase guide */}
      <div className="wu-phases">
        <div className="wu-phases-title">Warm-Up Phases</div>
        <div className="wu-phase-list">
          {Object.entries(PHASES).map(([num, p]) => (
            <div key={num} className="wu-phase-item">
              <span className="wu-phase-num">{num}</span>
              <span className="wu-phase-name">{p.name}</span>
              <span className="wu-phase-desc">{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Start / Add warm-up.
          Always render the section so it stays discoverable when active
          warm-ups already exist. Show a hint when no eligible devices are
          available so the user understands why the form is empty. */}
      <div className="wu-start-section">
        <div className="wu-start-title">
          {warmupEntries.length > 0 ? 'Add Another Device to Warm-Up' : 'Start Warm-Up'}
        </div>

        {devicesWithoutWarmup.length === 0 && (
          <p className="wu-hint">
            {activeDevices.length === 0
              ? 'No devices connected. Connect a device via USB to start.'
              : 'All connected devices are already in warm-up. Connect another device to add it.'}
          </p>
        )}

        {devicesWithoutWarmup.length > 0 && (
          <>
          <div className="wu-form-row">
            <label>
              Devices ({selectedSerials.length} / {devicesWithoutWarmup.length} selected)
              <span className="wu-select-actions">
                <button type="button" className="wu-link-btn" onClick={selectAllDevices}>Select All</button>
                <button type="button" className="wu-link-btn" onClick={clearSelection}>Clear</button>
              </span>
            </label>
            <div className="wu-device-list">
              {devicesWithoutWarmup.map(d => {
                const selected = selectedSerials.includes(d.serial);
                return (
                  <label key={d.serial} className={`wu-device-item ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSerial(d.serial)}
                    />
                    <span className="wu-device-name">{d.nickname || d.deviceName || d.model}</span>
                    <span className="wu-device-serial">{d.serial.slice(0, 10)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="wu-form-row">
            <label className="wu-checkbox-label">
              <input
                type="checkbox"
                checked={distribute}
                onChange={e => setDistribute(e.target.checked)}
              />
              <span>Distribute contacts across devices (split list)</span>
            </label>
            <p className="wu-hint">
              {distribute
                ? 'Each device gets a unique subset of contacts (no duplicates).'
                : 'Each device gets the full contact list (may send same contacts from different devices).'}
            </p>
          </div>

          <div className="wu-form-row">
            <label className="wu-checkbox-label">
              <input
                type="checkbox"
                checked={useBusiness}
                onChange={e => setUseBusiness(e.target.checked)}
              />
              <span>Use WhatsApp Business instead of regular WhatsApp</span>
            </label>
            <p className="wu-hint">
              By default messages go through regular WhatsApp (com.whatsapp). Enable this to use WhatsApp Business (com.whatsapp.w4b).
            </p>
          </div>

          <div className="wu-form-row">
            <label>Contacts (one phone per line, with country code)</label>
            <textarea
              className="wu-contacts-input"
              placeholder={"+60123456789\n+60198765432\n+601112223333"}
              value={contactsText}
              onChange={e => setContactsText(e.target.value)}
              rows={4}
            />
          </div>

          <div className="wu-form-row wu-delay-row">
            <label>Delay between messages (seconds)</label>
            <div className="wu-delay-inputs">
              <input type="number" min={10} max={300} value={delayMin} onChange={e => setDelayMin(Number(e.target.value))} className="wu-delay-input" />
              <span>to</span>
              <input type="number" min={30} max={600} value={delayMax} onChange={e => setDelayMax(Number(e.target.value))} className="wu-delay-input" />
              <span>sec</span>
            </div>
          </div>

          <button
            className="btn btn-primary wu-start-btn"
            onClick={handleStart}
            disabled={selectedSerials.length === 0 || !contactsText.trim()}
          >
            {warmupEntries.length > 0 ? 'Add' : 'Start Warm-Up on'} {selectedSerials.length} Device{selectedSerials.length !== 1 ? 's' : ''}
          </button>
          </>
        )}
      </div>

      {/* Active warm-ups */}
      {warmupEntries.length > 0 && (
        <div className="wu-active">
          <div className="wu-active-title">Active Warm-Ups ({warmupEntries.length})</div>

          {warmupEntries.map(([serial, state]) => {
            const device = devices.find(d => d.serial === serial);
            const deviceName = device?.nickname || device?.deviceName || device?.model || serial.slice(0, 10);
            const phase = PHASES[state.phase];
            const isAuto = autoRunning[serial];
            const isLoading = loading[serial];

            return (
              <div key={serial} className={`wu-card ${state.paused ? 'paused' : ''}`}>
                <div className="wu-card-header">
                  <span className="wu-card-name">{deviceName}</span>
                  <span className={`wu-card-phase phase-${state.phase}`}>
                    Phase {state.phase}: {phase.name}
                  </span>
                  <span className="wu-card-day">Day {state.dayNumber}</span>
                  {state.paused && <span className="wu-card-paused">PAUSED</span>}
                </div>

                <div className="wu-card-stats">
                  <div className="wu-stat">
                    <span className="wu-stat-label">Today</span>
                    <span className="wu-stat-value">{state.messagesSentToday} msgs</span>
                  </div>
                  <div className="wu-stat">
                    <span className="wu-stat-label">Total</span>
                    <span className="wu-stat-value">{state.totalMessagesSent} msgs</span>
                  </div>
                  <div className="wu-stat">
                    <span className="wu-stat-label">Contacts</span>
                    <span className="wu-stat-value">{state.contacts.length}</span>
                  </div>
                  <div className="wu-stat">
                    <span className="wu-stat-label">Phase limit</span>
                    <span className="wu-stat-value">{phase.maxMessages}/day</span>
                  </div>
                </div>

                {/* Progress bar for today */}
                <div className="wu-progress">
                  <div
                    className="wu-progress-fill"
                    style={{ width: `${Math.min(100, (state.messagesSentToday / Math.max(1, phase.maxMessages)) * 100)}%` }}
                  />
                </div>

                {/* Activity log (collapsible) */}
                {(state.log?.length > 0 || state.todayActions.length > 0) && (
                  <div className="wu-log">
                    <button
                      className="wu-log-toggle"
                      onClick={() => setExpandedLogs(prev => ({ ...prev, [serial]: !prev[serial] }))}
                    >
                      <span>{expandedLogs[serial] ? '\u25BC' : '\u25B6'}</span>
                      <span>Activity Log ({state.log?.length || state.todayActions.length} entries)</span>
                    </button>

                    {!expandedLogs[serial] && state.todayActions.length > 0 && (
                      <div className="wu-recent-inline">
                        {state.todayActions.slice(-3).reverse().map((a, i) => (
                          <div key={i} className={`wu-recent-item ${a.success ? '' : 'failed'}`}>
                            <span>{a.success ? '\u2705' : '\u274C'}</span>
                            <span className="wu-recent-contact">{a.contact}</span>
                            <span className="wu-recent-msg">{a.message?.slice(0, 30)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {expandedLogs[serial] && (
                      <div className="wu-log-full">
                        {(state.log || state.todayActions).slice().reverse().map((a, i) => (
                          <div key={i} className={`wu-log-item ${a.success ? '' : 'failed'}`}>
                            <span className="wu-log-icon">{a.success ? '\u2705' : '\u274C'}</span>
                            <span className="wu-log-time">{formatTime(a.time)}</span>
                            <span className="wu-log-contact">{a.contact}</span>
                            <span className="wu-log-msg">{a.message}</span>
                            {a.error && <span className="wu-log-error">{a.error}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Custom message for Force Send */}
                <div className="wu-custom-msg-row">
                  <input
                    type="text"
                    className="wu-custom-msg-input"
                    placeholder="Custom message for Force Send (leave blank for random template)"
                    value={customMessages[serial] || ''}
                    onChange={(e) => setCustomMessages(prev => ({ ...prev, [serial]: e.target.value }))}
                    disabled={isLoading || state.paused}
                  />
                </div>

                {/* Controls */}
                <div className="wu-card-actions">
                  <button
                    className={`btn btn-small ${isAuto ? 'btn-warning' : 'btn-primary'}`}
                    onClick={() => handleAutoToggle(serial)}
                    disabled={state.paused}
                  >
                    {isAuto ? 'Stop Auto' : 'Start Auto'}
                  </button>
                  <button
                    className="btn btn-small btn-secondary"
                    onClick={() => handleExecuteOne(serial)}
                    disabled={isLoading || state.paused}
                    title="Send 1 message (respects daily phase limit)"
                  >
                    {isLoading ? '...' : 'Send 1'}
                  </button>
                  <button
                    className="btn btn-small btn-warning"
                    onClick={() => handleForceSend(serial)}
                    disabled={isLoading || state.paused}
                    title="Force send — bypasses daily phase limit. Uses custom message if provided."
                  >
                    {(customMessages[serial] || '').trim() ? 'Force Send (Custom)' : 'Force Send'}
                  </button>
                  <button className="btn btn-small btn-secondary" onClick={() => handlePause(serial)}>
                    {state.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => handleStop(serial)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
