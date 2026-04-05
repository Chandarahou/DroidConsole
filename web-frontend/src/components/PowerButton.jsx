import { useState, useCallback } from 'react';
import * as api from '../services/api';

export function PowerButton({ serial }) {
  const [loading, setLoading] = useState(false);

  const handlePower = useCallback(async () => {
    setLoading(true);
    try {
      await api.batchShell([serial], 'input keyevent 26');
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [serial]);

  return (
    <button
      className="power-btn"
      onClick={handlePower}
      disabled={loading}
      title="Power on/off"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="2" x2="12" y2="12" />
        <path d="M16.24 7.76a6 6 0 1 1-8.49 0" />
      </svg>
    </button>
  );
}
