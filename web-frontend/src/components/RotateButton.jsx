import { useState, useCallback } from 'react';
import * as api from '../services/api';

export function RotateButton({ serial }) {
  const [loading, setLoading] = useState(false);

  const [isLandscape, setIsLandscape] = useState(false);

  const handleRotate = useCallback(async () => {
    setLoading(true);
    try {
      const nextRotation = isLandscape ? 0 : 1;
      // Lock rotation to portrait(0) or landscape(1) via window manager
      await api.batchShell([serial], `cmd window user-rotation lock ${nextRotation}`);
      setIsLandscape(!isLandscape);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [serial, isLandscape]);

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
