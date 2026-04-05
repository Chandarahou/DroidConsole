import { useEffect, useRef, useCallback, useState } from 'react';
import { VideoSocket } from '../services/websocket';
import { controlSocket } from '../services/websocket';
import './VideoPlayer.css';

/**
 * Computes the letterboxed video rect inside the canvas.
 * Returns { x, y, w, h } of the actual video content area.
 */
function computeVideoRect(canvasW, canvasH, videoW, videoH) {
  if (!videoW || !videoH) return { x: 0, y: 0, w: canvasW, h: canvasH };
  const scale = Math.min(canvasW / videoW, canvasH / videoH);
  const w = Math.round(videoW * scale);
  const h = Math.round(videoH * scale);
  return { x: Math.round((canvasW - w) / 2), y: Math.round((canvasH - h) / 2), w, h };
}

export function VideoPlayer({ serial, deviceName, token, onClose, canvasWidth = 280, canvasHeight = 620 }) {
  const canvasRef = useRef(null);
  const videoSocketRef = useRef(null);
  const decoderRef = useRef(null);
  const containerRef = useRef(null);
  const videoDimRef = useRef({ w: 0, h: 0 });
  const CANVAS_W = canvasWidth;
  const CANVAS_H = canvasHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas to fixed display size (CSS pixels = canvas pixels, no scaling distortion)
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    let decoder = null;
    let configData = null;
    let hasReceivedKeyFrame = false;

    if (typeof VideoDecoder !== 'undefined') {
      decoder = new VideoDecoder({
        output: (frame) => {
          const vw = frame.displayWidth;
          const vh = frame.displayHeight;
          videoDimRef.current = { w: vw, h: vh };

          // Draw with letterboxing (black bars)
          const rect = computeVideoRect(CANVAS_W, CANVAS_H, vw, vh);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
          ctx.drawImage(frame, rect.x, rect.y, rect.w, rect.h);
          frame.close();
        },
        error: (err) => {
          console.error('Decoder error:', err);
          hasReceivedKeyFrame = false;
          if (decoder.state === 'closed') return;
          try { decoder.reset(); } catch { /* ignore */ }
          try { decoder.configure({ codec: 'avc1.640028', optimizeForLatency: true }); } catch { /* ignore */ }
        },
      });

      decoder.configure({
        codec: 'avc1.42001f',  // Baseline 3.1 — widely compatible, reconfigured on first SPS
        optimizeForLatency: true,
      });

      decoderRef.current = decoder;
    }

    const vs = new VideoSocket(serial, token);

    vs.onData = (data) => {
      if (!decoder || decoder.state !== 'configured') return;
      if (data.length < 2) return;

      const flags = data[0];
      const nalData = data.subarray(1);
      const isConfig = (flags & 0x01) !== 0;
      const isKeyFrame = (flags & 0x02) !== 0;

      if (isConfig) {
        configData = nalData.slice();
        // Parse SPS to extract correct codec string and reconfigure decoder
        for (let i = 0; i < nalData.length - 4; i++) {
          if (nalData[i] === 0 && nalData[i+1] === 0 && nalData[i+2] === 0 && nalData[i+3] === 1 && (nalData[i+4] & 0x1f) === 7) {
            const profile = nalData[i+5];
            const compat = nalData[i+6];
            const level = nalData[i+7];
            const codecStr = `avc1.${profile.toString(16).padStart(2,'0')}${compat.toString(16).padStart(2,'0')}${level.toString(16).padStart(2,'0')}`;
            try {
              decoder.configure({ codec: codecStr, optimizeForLatency: true });
            } catch { /* fallback to initial config */ }
            break;
          }
        }
        return;
      }

      if (!hasReceivedKeyFrame && !isKeyFrame) return;

      try {
        let frameData;
        if (isKeyFrame && configData) {
          frameData = new Uint8Array(configData.length + nalData.length);
          frameData.set(configData, 0);
          frameData.set(nalData, configData.length);
        } else {
          frameData = nalData;
        }

        decoder.decode(new EncodedVideoChunk({
          type: isKeyFrame ? 'key' : 'delta',
          timestamp: performance.now() * 1000,
          data: frameData,
        }));
        hasReceivedKeyFrame = true;
      } catch (err) {
        console.warn('Decode error:', err.message);
        hasReceivedKeyFrame = false;
      }
    };

    vs.connect();
    videoSocketRef.current = vs;

    return () => {
      vs.disconnect();
      if (decoder && decoder.state !== 'closed') {
        try { decoder.close(); } catch { /* ignore */ }
      }
    };
  }, [serial, token]);

  /**
   * Convert mouse event coords (relative to canvas element) to
   * normalized coordinates (0..1) within the actual video content area.
   * Returns null if the click is in the black bar area.
   */
  const mapMouseToVideo = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const { w: vw, h: vh } = videoDimRef.current;
    if (!vw || !vh) return null;

    const elemRect = canvas.getBoundingClientRect();
    // Mouse position in canvas CSS pixels
    const mx = e.clientX - elemRect.left;
    const my = e.clientY - elemRect.top;

    // Canvas CSS size may differ from canvas.width/height if CSS scales it
    const scaleX = canvas.width / elemRect.width;
    const scaleY = canvas.height / elemRect.height;
    const cx = mx * scaleX;
    const cy = my * scaleY;

    // Video content rect inside the canvas
    const vidRect = computeVideoRect(CANVAS_W, CANVAS_H, vw, vh);

    // Position relative to video content area
    const rx = (cx - vidRect.x) / vidRect.w;
    const ry = (cy - vidRect.y) / vidRect.h;

    // Clamp to [0,1] so clicks near edges still register
    return {
      x: Math.max(0, Math.min(1, rx)),
      y: Math.max(0, Math.min(1, ry)),
    };
  }, []);

  const handleMouseEvent = useCallback((e, action) => {
    const pos = mapMouseToVideo(e);
    if (!pos) return;
    // Send normalized coords with width=1 height=1 so server maps directly
    controlSocket.sendTouch(serial, action, pos.x, pos.y, 1, 1);
  }, [serial, mapMouseToVideo]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    canvasRef.current?.focus();
    handleMouseEvent(e, 0);
  }, [handleMouseEvent]);

  const handleMouseUp = useCallback((e) => {
    e.preventDefault();
    handleMouseEvent(e, 1);
  }, [handleMouseEvent]);

  const handleMouseMove = useCallback((e) => {
    if (e.buttons === 1) {
      handleMouseEvent(e, 2);
    }
  }, [handleMouseEvent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = mapMouseToVideo(e);
      if (!pos) return;
      controlSocket.sendScroll(
        serial, pos.x, pos.y,
        Math.sign(-e.deltaX), Math.sign(-e.deltaY),
        1, 1
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [serial, mapMouseToVideo]);

  // Track repeat count per key for proper Android DPAD repeat
  const repeatCountRef = useRef({});

  const handleKeyDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    const keyCode = mapKeyCode(e.code);
    if (keyCode !== null) {
      if (e.repeat) {
        // Browser repeat: send a full down+up tap so Android DPAD moves one step
        const count = (repeatCountRef.current[e.code] || 0) + 1;
        repeatCountRef.current[e.code] = count;
        controlSocket.sendKey(serial, 0, keyCode, count, getMetaState(e));
        controlSocket.sendKey(serial, 1, keyCode, 0, getMetaState(e));
      } else {
        // First press
        repeatCountRef.current[e.code] = 0;
        controlSocket.sendKey(serial, 0, keyCode, 0, getMetaState(e));
      }
      return;
    }

    // Digit keys → send as Android keycodes (works without IME/soft keyboard)
    // Android KEYCODE_0..9 = 7..16
    const digitKeyCode = mapDigitKeyCode(e.code);
    if (digitKeyCode !== null) {
      controlSocket.sendKey(serial, 0, digitKeyCode, 0, getMetaState(e));
      controlSocket.sendKey(serial, 1, digitKeyCode, 0, getMetaState(e));
      return;
    }

    // Printable characters → text injection
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      controlSocket.sendText(serial, e.key);
    }
  }, [serial]);

  const handleKeyUp = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    delete repeatCountRef.current[e.code];

    const keyCode = mapKeyCode(e.code);
    if (keyCode !== null) {
      controlSocket.sendKey(serial, 1, keyCode, 0, getMetaState(e));
    }
    // Digit keyUp already sent above in handleKeyDown (full tap)
  }, [serial]);

  return (
    <div className="video-player" ref={containerRef}>
      <div className="video-header">
        <span className="video-serial">{deviceName || serial}</span>
        <button className="btn btn-small btn-danger" onClick={onClose}>Close</button>
      </div>
      <canvas
        ref={canvasRef}
        className="video-canvas"
        width={CANVAS_W}
        height={CANVAS_H}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />
    </div>
  );
}

function mapKeyCode(code) {
  const MAP = {
    // DPAD navigation (Laixi-style: blue focus box moves between elements)
    ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
    // Android nav keys
    Escape: 4,        // KEYCODE_BACK (Android back button)
    Home: 3,          // KEYCODE_HOME
    F5: 82,           // KEYCODE_MENU (app switch / recent apps)
    // DPAD select (tap the focused element — same as Laixi Enter key)
    Enter: 23,            // KEYCODE_DPAD_CENTER
    // Editing
    Backspace: 67, Delete: 112, Tab: 61, Space: 62,
    // Volume / Power
    VolumeUp: 24, VolumeDown: 25,
    // F-keys for Android shortcuts
    F1: 224,          // KEYCODE_BRIGHTNESS_DOWN
    F2: 225,          // KEYCODE_BRIGHTNESS_UP
  };
  return MAP[code] ?? null;
}

/** Map digit keys to Android keycodes (KEYCODE_0=7 .. KEYCODE_9=16) */
function mapDigitKeyCode(code) {
  const MAP = {
    Digit0: 7, Digit1: 8, Digit2: 9, Digit3: 10, Digit4: 11,
    Digit5: 12, Digit6: 13, Digit7: 14, Digit8: 15, Digit9: 16,
    Numpad0: 144, Numpad1: 145, Numpad2: 146, Numpad3: 147, Numpad4: 148,
    Numpad5: 149, Numpad6: 150, Numpad7: 151, Numpad8: 152, Numpad9: 153,
  };
  return MAP[code] ?? null;
}

function getMetaState(e) {
  let state = 0;
  if (e.shiftKey) state |= 1;
  if (e.ctrlKey) state |= 0x1000;
  if (e.altKey) state |= 0x02;
  return state;
}
