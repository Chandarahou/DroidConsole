import { useState, useEffect, useCallback } from 'react';
import { controlSocket } from '../services/websocket';

export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [masterSerial, setMasterSerial] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    controlSocket.connect();

    const unsubs = [
      controlSocket.on('connected', () => setConnected(true)),
      controlSocket.on('disconnected', () => setConnected(false)),

      controlSocket.on('init', (data) => {
        setDevices(data.devices || []);
        setGroups(data.groups || []);
        setSessions(data.sessions || []);
        setMasterSerial(data.master || null);
      }),

      controlSocket.on('device:connected', (device) => {
        setDevices(prev => [...prev.filter(d => d.serial !== device.serial), device]);
      }),

      controlSocket.on('device:disconnected', ({ serial }) => {
        setDevices(prev => prev.filter(d => d.serial !== serial));
      }),

      controlSocket.on('device:updated', (device) => {
        setDevices(prev => prev.map(d => d.serial === device.serial ? device : d));
      }),

      controlSocket.on('groups:updated', (groups) => {
        setGroups(groups);
      }),

      controlSocket.on('master:changed', (serial) => {
        setMasterSerial(serial);
      }),

      controlSocket.on('session:started', ({ serial }) => {
        setSessions(prev => [...prev, { serial, running: true }]);
      }),

      controlSocket.on('session:stopped', ({ serial }) => {
        setSessions(prev => prev.filter(s => s.serial !== serial));
      }),
    ];

    return () => {
      unsubs.forEach(unsub => unsub());
      // Don't disconnect the singleton socket on unmount — React Strict Mode
      // will remount and reconnect, causing a connect/disconnect loop.
    };
  }, []);

  const getDeviceSession = useCallback(
    (serial) => sessions.find(s => s.serial === serial),
    [sessions]
  );

  return { devices, groups, sessions, masterSerial, connected, getDeviceSession };
}
