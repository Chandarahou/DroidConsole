import { useState } from 'react';
import * as api from '../services/api';
import './GroupPanel.css';

export function GroupPanel({ devices, groups, activeGroup, onGroupSelect, onDeviceContextMenu }) {
  const [newGroupName, setNewGroupName] = useState('');

  const connectedDevices = devices.filter(d => d.status === 'device');
  const ungroupedDevices = connectedDevices.filter(d => !d.groupId);

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await api.createGroup(name);
    setNewGroupName('');
  };

  const handleDeleteGroup = async (id, e) => {
    e.stopPropagation();
    await api.deleteGroup(id);
    if (activeGroup === id) onGroupSelect(null);
  };

  const handleAddDevice = async (groupId, serial) => {
    await api.addDeviceToGroup(groupId, serial);
  };

  const handleRemoveDevice = async (groupId, serial) => {
    await api.removeDeviceFromGroup(groupId, serial);
  };

  const handleToggleDevice = async (device) => {
    // Only works when a named group is selected
    if (!activeGroup || activeGroup === '__ungrouped') return;

    if (device.groupId === activeGroup) {
      // Already in this group — remove it
      await handleRemoveDevice(activeGroup, device.serial);
    } else {
      // Not in this group — add it (moves from other group if needed)
      await handleAddDevice(activeGroup, device.serial);
    }
  };

  const isInActiveGroup = (device) => {
    if (!activeGroup) return true;
    if (activeGroup === '__ungrouped') return !device.groupId;
    return device.groupId === activeGroup;
  };

  // Is a named group selected (not "all" or "ungrouped")
  const isNamedGroupActive = activeGroup && activeGroup !== '__ungrouped';

  const getGroupOnlineCount = (groupId) => {
    if (!groupId) return connectedDevices.length;
    if (groupId === '__ungrouped') return ungroupedDevices.length;
    const group = groups.find(g => g.id === groupId);
    return group ? group.deviceSerials.filter(s => devices.find(d => d.serial === s && d.status === 'device')).length : 0;
  };

  const getSelectedCount = () => {
    if (!activeGroup) return connectedDevices.length;
    if (activeGroup === '__ungrouped') return ungroupedDevices.length;
    return getGroupOnlineCount(activeGroup);
  };

  // Display label for device chip (nickname or short index number)
  const getChipLabel = (device, index) => {
    if (device.nickname) return device.nickname;
    return String(index + 1);
  };

  return (
    <div className="gp-sidebar">
      <div className="gp-header">Groups</div>

      {/* All devices row with selected count */}
      <div
        className={`gp-row ${!activeGroup ? 'active' : ''}`}
        onClick={() => onGroupSelect(null)}
      >
        <span className="gp-dot online" />
        <span className="gp-label">All devices({connectedDevices.length})</span>
        {!activeGroup && (
          <span className="gp-selected">{getSelectedCount()} units selected</span>
        )}
      </div>

      {/* Hint when a group is selected */}
      {isNamedGroupActive && (
        <div className="gp-hint">Click a device to add/remove from group</div>
      )}

      {/* Device number grid */}
      <div className="gp-grid">
        {connectedDevices.map((device, i) => (
          <div
            key={device.serial}
            className={`gp-chip ${isInActiveGroup(device) ? 'active' : 'dimmed'} ${isNamedGroupActive ? 'clickable' : ''}`}
            title={`${device.nickname || device.deviceName || device.model}\n${device.serial}${isNamedGroupActive ? '\nClick to toggle group membership' : ''}\nRight-click for options`}
            onClick={() => handleToggleDevice(device)}
            onContextMenu={e => onDeviceContextMenu?.(e, device)}
          >
            {getChipLabel(device, i)}
          </div>
        ))}
      </div>

      {/* Group list */}
      <div className="gp-list">
        {/* Ungrouped */}
        <div
          className={`gp-row ${activeGroup === '__ungrouped' ? 'active' : ''}`}
          onClick={() => onGroupSelect('__ungrouped')}
        >
          <span className="gp-dot" />
          <span className="gp-label">Ungrouped({ungroupedDevices.length})</span>
        </div>

        {/* Named groups */}
        {groups.map(group => {
          const count = getGroupOnlineCount(group.id);
          const isActive = activeGroup === group.id;
          return (
            <div
              key={group.id}
              className={`gp-row ${isActive ? 'active' : ''}`}
              onClick={() => onGroupSelect(group.id)}
            >
              <span className="gp-dot" />
              <span className="gp-label">{group.name}({count})</span>
              {isActive && <span className="gp-selected">{count} units selected</span>}
              <button className="gp-delete" onClick={(e) => handleDeleteGroup(group.id, e)} title="Delete">x</button>
            </div>
          );
        })}
      </div>

      {/* Create group */}
      <div className="gp-create">
        <input
          className="gp-create-input"
          placeholder="Enter a group name"
          value={newGroupName}
          onChange={e => setNewGroupName(e.target.value.slice(0, 10))}
          onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
          maxLength={10}
        />
        <span className="gp-char-count">{newGroupName.length} / 10</span>
        <button className="gp-add-btn" onClick={handleCreateGroup} disabled={!newGroupName.trim()} title="Add group">
          + Add
        </button>
      </div>
    </div>
  );
}
