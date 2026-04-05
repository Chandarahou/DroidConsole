import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useDevices } from './hooks/useDevices';
import { DeviceCell } from './components/DeviceCell';
import { DeviceCard } from './components/DeviceCard';
import { VideoPlayer } from './components/VideoPlayer';
import { BatchPanel } from './components/BatchPanel';
import { GroupPanel } from './components/GroupPanel';
import { SharePanel } from './components/SharePanel';
import { ConnectDialog } from './components/ConnectDialog';
import { ReceivedPanel } from './components/ReceivedPanel';
import { ContextMenu } from './components/ContextMenu';
import { ShareView } from './pages/ShareView';
import { controlSocket } from './services/websocket';
import * as api from './services/api';
import './App.css';

function App() {
  const shareToken = useMemo(() => {
    const match = window.location.pathname.match(/^\/share\/([a-f0-9]+)$/);
    return match ? match[1] : null;
  }, []);

  if (shareToken) {
    return <ShareView token={shareToken} />;
  }

  const { devices, groups, sessions, masterSerial, connected } = useDevices();
  const [activeTab, setActiveTab] = useState('devices');
  const [openPlayers, setOpenPlayers] = useState([]);
  const [showConnect, setShowConnect] = useState(false);
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeGroup, setActiveGroup] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, device }
  const [focusedSerial, setFocusedSerial] = useState(null); // double-click main screen
  const [displayScale, setDisplayScale] = useState(
    () => parseInt(localStorage.getItem('displayScale') || '50', 10)
  );

  // --- Auto-start mirror for all connected devices ---
  const autoMirroredRef = useRef(new Set());

  useEffect(() => {
    if (!connected) return;
    const devicesToMirror = devices.filter(d =>
      d.status === 'device' &&
      !sessions.some(s => s.serial === d.serial) &&
      !autoMirroredRef.current.has(d.serial)
    );
    for (const device of devicesToMirror) {
      autoMirroredRef.current.add(device.serial);
      api.startSession(device.serial).catch(() => {
        autoMirroredRef.current.delete(device.serial);
      });
    }
  }, [devices, sessions, connected]);

  useEffect(() => {
    const currentSerials = new Set(devices.map(d => d.serial));
    for (const serial of autoMirroredRef.current) {
      if (!currentSerials.has(serial)) autoMirroredRef.current.delete(serial);
    }
  }, [devices]);

  const handleScaleChange = useCallback((val) => {
    setDisplayScale(val);
    localStorage.setItem('displayScale', String(val));
  }, []);

  const canvasWidth = Math.round(180 + (displayScale / 100) * 200);
  const canvasHeight = Math.round(400 + (displayScale / 100) * 440);

  const handleMirrorToggle = useCallback(async (serial, isActive) => {
    if (isActive) {
      await api.stopSession(serial);
      setOpenPlayers(prev => prev.filter(s => s !== serial));
    } else {
      await api.startSession(serial);
      setOpenPlayers(prev => [...prev, serial]);
    }
  }, []);

  const handleSelectMaster = useCallback(async (serial) => {
    if (serial === masterSerial) {
      await api.clearMaster();
    } else {
      await api.setMaster(serial);
    }
  }, [masterSerial]);

  const handleDoubleClick = useCallback((serial) => {
    setFocusedSerial(prev => prev === serial ? null : serial);
  }, []);

  const handleContextMenu = useCallback((e, device) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, device });
  }, []);

  const handleRename = useCallback(async (serial, nickname) => {
    await api.renameDevice(serial, nickname);
  }, []);

  const handleMoveToGroup = useCallback(async (groupId, serial) => {
    await api.addDeviceToGroup(groupId, serial);
  }, []);

  const handleRemoveFromGroup = useCallback(async (groupId, serial) => {
    await api.removeDeviceFromGroup(groupId, serial);
  }, []);

  const filteredDevices = useMemo(() => {
    if (!activeGroup) return devices;
    if (activeGroup === '__ungrouped') return devices.filter(d => !d.groupId);
    return devices.filter(d => d.groupId === activeGroup);
  }, [devices, activeGroup]);

  const navItems = [
    { id: 'devices', label: 'Devices', icon: '\u{1F4F1}' },
    { id: 'share', label: 'Remote Share', icon: '\u{1F517}' },
    { id: 'received', label: 'Received', icon: '\u{1F4E5}' },
    { id: 'display', label: 'Display Settings', icon: '\u{1F4BB}' },
  ];

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-brand">
          <h1>Droid</h1>
          {sidebarOpen && <span className="brand-full">Console</span>}
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(p => !p)} title={sidebarOpen ? 'Collapse' : 'Expand'}>
            {sidebarOpen ? '\u276E' : '\u276F'}
          </button>
        </div>

        <div className="sidebar-status">
          <span className={`connection-dot ${connected ? 'online' : 'offline'}`} />
          <span className="status-text">{connected ? 'Connected' : 'Offline'}</span>
          <span className="device-count">{devices.length}</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Laixi-style Groups panel in sidebar */}
        {sidebarOpen && (
          <GroupPanel
            devices={devices}
            groups={groups}
            activeGroup={activeGroup}
            onGroupSelect={(g) => { setActiveGroup(g); setActiveTab('devices'); }}
            onDeviceContextMenu={handleContextMenu}
          />
        )}

        <div className="sidebar-footer">
          <button className="btn btn-primary sidebar-btn" onClick={() => setShowConnect(true)}>
            + TCP Connect
          </button>
        </div>
      </aside>

      <div className="main-wrapper">
        <main className="app-main">
          <div className="content-area">
            {activeTab === 'devices' && (
              <>
                {filteredDevices.length === 0 ? (
                  <div className="empty-state">
                    <h2>{devices.length === 0 ? 'No devices connected' : 'No devices in this group'}</h2>
                    <p>{devices.length === 0
                      ? 'Connect Android devices via USB or use TCP Connect to add wireless devices.'
                      : 'Select a different group or add devices to this group.'
                    }</p>
                  </div>
                ) : focusedSerial ? (
                  /* Laixi-style main screen: large phone left + control bar + grid right */
                  <div className="ms-layout">
                    {/* Main screen area (left) */}
                    <div className="ms-left">
                      {(() => {
                        const device = devices.find(d => d.serial === focusedSerial);
                        if (!device) { setFocusedSerial(null); return null; }
                        const displayName = device.nickname || device.deviceName || device.model;
                        return (
                          <>
                            <div className="ms-header">
                              <span className="ms-name">{displayName}</span>
                              <span className="ms-info">Connection:usb</span>
                              <button className="ms-close" onClick={() => setFocusedSerial(null)} title="Back to grid">X</button>
                            </div>
                            <div className="ms-phone-row">
                              <DeviceCell
                                device={device}
                                hasSession={sessions.some(s => s.serial === device.serial)}
                                isMaster={device.serial === masterSerial}
                                onMirrorToggle={handleMirrorToggle}
                                onSelectMaster={handleSelectMaster}
                                onContextMenu={handleContextMenu}
                                onDoubleClick={handleDoubleClick}
                                canvasWidth={380}
                                canvasHeight={820}
                              />
                              {/* Control buttons panel */}
                              <div className="ms-controls">
                                {[
                                  { label: 'Home', key: 3 },
                                  { label: 'Task', key: 187 },
                                  { label: 'Back', key: 4 },
                                  { label: 'Up', key: 19 },
                                  { label: 'Down', key: 20 },
                                  { label: 'Left', key: 21 },
                                  { label: 'Right', key: 22 },
                                  { label: 'Enter', key: 23 },
                                  { label: 'OFF', key: 26 },
                                  { label: 'Vol+', key: 24 },
                                  { label: 'Vol-', key: 25 },
                                ].map(btn => (
                                  <button
                                    key={btn.label}
                                    className="ms-ctrl-btn"
                                    onClick={() => {
                                      controlSocket.sendKey(focusedSerial, 0, btn.key, 0, 0);
                                      setTimeout(() => controlSocket.sendKey(focusedSerial, 1, btn.key, 0, 0), 80);
                                    }}
                                  >{btn.label}</button>
                                ))}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Other devices grid (right) */}
                    <div className="ms-right">
                      {filteredDevices.filter(d => d.serial !== focusedSerial).map(device => (
                        <DeviceCell
                          key={device.serial}
                          device={device}
                          hasSession={sessions.some(s => s.serial === device.serial)}
                          isMaster={device.serial === masterSerial}
                          onMirrorToggle={handleMirrorToggle}
                          onSelectMaster={handleSelectMaster}
                          onContextMenu={handleContextMenu}
                          onDoubleClick={handleDoubleClick}
                          canvasWidth={canvasWidth}
                          canvasHeight={canvasHeight}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="dashboard-grid" style={{ gridTemplateColumns: `repeat(${filteredDevices.length <= 1 ? 1 : filteredDevices.length <= 4 ? 2 : filteredDevices.length <= 9 ? 3 : 4}, 1fr)` }}>
                    {filteredDevices.map(device => (
                      <DeviceCell
                        key={device.serial}
                        device={device}
                        hasSession={sessions.some(s => s.serial === device.serial)}
                        isMaster={device.serial === masterSerial}
                        onMirrorToggle={handleMirrorToggle}
                        onSelectMaster={handleSelectMaster}
                        onContextMenu={handleContextMenu}
                        onDoubleClick={handleDoubleClick}
                        canvasWidth={canvasWidth}
                        canvasHeight={canvasHeight}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === 'batch' && (
              <BatchPanel
                devices={devices}
                selectedSerials={selectedSerials}
                onSelectionChange={setSelectedSerials}
              />
            )}

            {activeTab === 'share' && (
              <SharePanel devices={devices} />
            )}

            {activeTab === 'received' && (
              <ReceivedPanel />
            )}

            {activeTab === 'display' && (
              <div className="display-settings-panel">
                <h3>Display Settings</h3>
                <div className="setting-group">
                  <label className="setting-label">Screen Mirror Size</label>
                  <div className="slider-row">
                    <span className="slider-label-min">Small</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={displayScale}
                      onChange={e => handleScaleChange(Number(e.target.value))}
                      className="scale-slider"
                    />
                    <span className="slider-label-max">Large</span>
                  </div>
                  <div className="scale-preview">
                    {canvasWidth} x {canvasHeight} px
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {showConnect && <ConnectDialog onClose={() => setShowConnect(false)} />}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          device={ctxMenu.device}
          groups={groups}
          onClose={() => setCtxMenu(null)}
          onRename={handleRename}
          onMoveToGroup={handleMoveToGroup}
          onRemoveFromGroup={handleRemoveFromGroup}
        />
      )}
    </div>
  );
}

export default App;
