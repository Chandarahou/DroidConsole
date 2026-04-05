import { useState, useCallback } from 'react';
import * as api from '../services/api';

export function RotateButton({ serial }) {
  const [loading, setLoading] = useState(false);

  const handleRotate = useCallback(async () => {
    setLoading(true);
    try {
      // Toggle rotation: check current, then flip
      // user_rotation: 0=portrait, 1=landscape, 2=reverse portrait, 3=reverse landscape
      await api.batchShell([serial],
        'settings put system accelerometer_rotation 0 && ' +
        'current=$(settings get system user_rotation) && ' +
        'if [ "$current" = "1" ]; then settings put system user_rotation 0; ' +
        'else settings put system user_rotation 1; fi'
      );
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [serial]);

  return (
    <button
      className="rotate-btn"
      onClick={handleRotate}
      disabled={loading}
      title="Rotate screen"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 4v6h6" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    </button>
  );
}
