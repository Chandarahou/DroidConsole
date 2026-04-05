import { useState, useEffect, useRef } from 'react';
import './ContextMenu.css';

/**
 * Right-click context menu for devices.
 * Shows "Set Name" and "Move to Group >" with submenu.
 */
export function ContextMenu({ x, y, device, groups, onClose, onRename, onMoveToGroup, onRemoveFromGroup }) {
  const [showGroupSub, setShowGroupSub] = useState(false);
  const [showRenameInput, setShowRenameInput] = useState(false);
  const [nickname, setNickname] = useState(device.nickname || '');
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Focus rename input when shown
  useEffect(() => {
    if (showRenameInput && inputRef.current) inputRef.current.focus();
  }, [showRenameInput]);

  // Adjust position if menu goes off screen
  const style = { left: x, top: y };

  const handleRenameSubmit = () => {
    const trimmed = nickname.trim();
    if (trimmed) {
      onRename(device.serial, trimmed);
    }
    onClose();
  };

  return (
    <div className="ctx-menu" ref={menuRef} style={style}>
      {/* Device info header */}
      <div className="ctx-header">
        {device.nickname || device.deviceName || device.model}
        <span className="ctx-serial">{device.serial.slice(0, 10)}...</span>
      </div>

      {/* Set Name */}
      {showRenameInput ? (
        <div className="ctx-rename-row">
          <input
            ref={inputRef}
            className="ctx-rename-input"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') { setShowRenameInput(false); setNickname(device.nickname || ''); }
            }}
            placeholder="Device name..."
          />
          <button className="ctx-rename-ok" onClick={handleRenameSubmit}>OK</button>
        </div>
      ) : (
        <div className="ctx-item" onClick={() => setShowRenameInput(true)}>
          Set Name
        </div>
      )}

      {/* Move to Group */}
      <div
        className="ctx-item ctx-has-sub"
        onMouseEnter={() => setShowGroupSub(true)}
        onMouseLeave={() => setShowGroupSub(false)}
      >
        Move to Group
        <span className="ctx-arrow">{'\u25B6'}</span>

        {showGroupSub && (
          <div className="ctx-submenu">
            {/* Remove from current group */}
            {device.groupId && (
              <div
                className="ctx-sub-item ctx-remove"
                onClick={() => { onRemoveFromGroup(device.groupId, device.serial); onClose(); }}
              >
                Remove from group
              </div>
            )}

            {/* List all groups */}
            {groups.length === 0 ? (
              <div className="ctx-sub-empty">No groups created</div>
            ) : (
              groups.map(group => {
                const isCurrentGroup = device.groupId === group.id;
                return (
                  <div
                    key={group.id}
                    className={`ctx-sub-item ${isCurrentGroup ? 'current' : ''}`}
                    onClick={() => {
                      if (!isCurrentGroup) {
                        onMoveToGroup(group.id, device.serial);
                      }
                      onClose();
                    }}
                  >
                    {group.name}
                    {isCurrentGroup && <span className="ctx-check">{'\u2713'}</span>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
