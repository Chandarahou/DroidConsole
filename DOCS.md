# DroidConsole - Technical Documentation

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Core Components](#core-components)
- [Communication Protocol](#communication-protocol)
- [scrcpy Integration](#scrcpy-integration)
- [UHID Keyboard](#uhid-keyboard)
- [Remote Sharing](#remote-sharing)
- [Device Management](#device-management)
- [Build & Deployment](#build--deployment)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Electron Main Process               │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ Express HTTP  │  │ WebSocket  │  │   scrcpy     │ │
│  │   Server      │  │  Server    │  │  Sessions    │ │
│  │  (port 3001)  │  │ /ws/*      │  │  (per device)│ │
│  └──────┬───────┘  └─────┬──────┘  └──────┬───────┘ │
│         │                │                │          │
│         │           ┌────┴────┐     ┌─────┴──────┐  │
│         │           │ Control │     │  ADB       │  │
│         │           │ Video   │     │  Client    │  │
│         │           │ Signal  │     │            │  │
│         │           └─────────┘     └─────┬──────┘  │
│         │                                 │          │
├─────────┼─────────────────────────────────┼──────────┤
│         │     BrowserWindow (Renderer)    │          │
│  ┌──────┴───────────────────────────┐     │          │
│  │          React Frontend          │     │          │
│  │  ┌──────────┐  ┌──────────────┐  │     │          │
│  │  │ DeviceGrid│  │ VideoPlayer  │  │     │          │
│  │  │ Groups   │  │ (H.264 dec) │  │     │          │
│  │  │ Share    │  │ Touch/Key   │  │     │          │
│  │  └──────────┘  └──────────────┘  │     │          │
│  └──────────────────────────────────┘     │          │
└───────────────────────────────────────────┼──────────┘
                                            │
                                    ┌───────┴───────┐
                                    │  Android      │
                                    │  Devices      │
                                    │  (USB/TCP)    │
                                    └───────────────┘
```

DroidConsole runs as an Electron desktop app. The main process starts an Express HTTP server and WebSocket server on port 3001. The React frontend is served as static files and loaded into a BrowserWindow. scrcpy sessions manage device mirroring via ADB.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Desktop Framework** | Electron | 35.x | Windows .exe application shell |
| **Frontend** | React | 19.x | UI components and state management |
| **Build Tool** | Vite | 8.x | Fast frontend bundling and HMR |
| **Backend** | Express | 5.x | REST API server |
| **Real-time** | ws (WebSocket) | 8.x | Live video streaming and control |
| **Screen Capture** | scrcpy-server | 3.3.4 | Android screen mirroring (H.264) |
| **Device Bridge** | ADB | - | Android Debug Bridge communication |
| **Video Decoding** | WebCodecs API | - | Browser-native H.264 decoding |
| **Virtual Input** | UHID | - | USB HID keyboard emulation |
| **Packaging** | electron-builder | 26.x | .exe installer generation |
| **Styling** | CSS Variables (Catppuccin) | - | Night/Light theme support |
| **Icon Embedding** | rcedit | - | Embed custom .ico into packaged .exe |

---

## Project Structure

```
DroidConsole/
├── electron/                    # Electron main process
│   ├── main.cjs                 # CJS bootstrap (Electron entry)
│   ├── app.js                   # ESM app logic (server, window, splash)
│   ├── preload.cjs              # Renderer preload script
│   └── splash.html              # Splash screen with bounce animation
│
├── desktop-host/                # Backend server
│   ├── src/
│   │   ├── index.js             # Standalone entry (non-Electron)
│   │   ├── adb/
│   │   │   ├── adb-client.js    # ADB command execution
│   │   │   └── device-manager.js # Device discovery and polling
│   │   ├── scrcpy/
│   │   │   ├── scrcpy-client.js # scrcpy session + UHID keyboard
│   │   │   └── session-manager.js # Multi-device session management
│   │   ├── server/
│   │   │   ├── http-api.js      # REST API endpoints
│   │   │   ├── ws-server.js     # WebSocket server (control/video/signaling)
│   │   │   ├── batch-controller.js # Multi-device batch operations
│   │   │   ├── warmup-manager.js # WhatsApp warm-up state machine + scheduling
│   │   │   └── share-manager.js # Remote sharing token management
│   │   └── utils/
│   │       └── logger.js        # Logging utility
│   └── vendor/
│       └── scrcpy-server.jar    # scrcpy server binary (v3.3.4)
│
├── web-frontend/                # React frontend
│   ├── src/
│   │   ├── App.jsx              # Main app layout + routing
│   │   ├── App.css              # Global styles (Catppuccin dark)
│   │   ├── components/
│   │   │   ├── DeviceCell.jsx   # Device card in grid
│   │   │   ├── VideoPlayer.jsx  # H.264 video player + input
│   │   │   ├── GroupPanel.jsx   # Sidebar group management
│   │   │   ├── SharePanel.jsx   # Remote sharing creator
│   │   │   ├── ReceivedPanel.jsx # Remote share receiver
│   │   │   ├── ContextMenu.jsx  # Right-click device menu
│   │   │   ├── ConnectDialog.jsx # TCP/WiFi connect dialog
│   │   │   ├── PowerButton.jsx  # Power toggle button
│   │   │   ├── RotateButton.jsx # Screen rotation button
│   │   │   ├── BatchPanel.jsx   # Batch operations UI
│   │   │   ├── WaRegisterPanel.jsx # WhatsApp registration automation (UHID)
│   │   │   └── WaWarmupPanel.jsx # WhatsApp warm-up automation (5 phases)
│   │   ├── hooks/
│   │   │   └── useDevices.js    # WebSocket device state hook
│   │   ├── services/
│   │   │   ├── api.js           # REST API client
│   │   │   └── websocket.js     # WebSocket client (control + video)
│   │   └── pages/
│   │       └── ShareView.jsx    # Share viewer page
│   ├── index.html
│   └── vite.config.js
│
├── shared/
│   └── constants.js             # Shared constants
│
├── assets/
│   ├── icon.ico                 # Windows app icon
│   └── icon-256.png             # Square icon for builds
│
├── package.json                 # Root config + electron-builder
├── docker-compose.yml           # Docker deployment (alternative)
├── Icon.png                     # Original app icon
├── README.md                    # Project readme
└── DOCS.md                      # This file
```

---

## Core Components

### Electron Main Process (`electron/`)

**main.cjs** - CJS bootstrap that clears `ELECTRON_RUN_AS_NODE` (needed when launched from VS Code/Electron hosts) and dynamically imports the ESM app module.

**app.js** - Main application logic:
- Shows splash screen with bounce animation
- Starts Express server on `0.0.0.0:3001` (accessible on LAN)
- Serves React frontend as static files (SPA fallback for `/share/:token` routes)
- Creates BrowserWindow pointing at `http://localhost:3001/`
- Resolves paths for packaged mode (`process.resourcesPath`)

### ADB Client (`desktop-host/src/adb/`)

**adb-client.js** - Wraps ADB commands via `child_process.execFile`:
- Auto-discovers ADB in 10+ common Windows locations
- Supports remote ADB server (Docker mode via `ADB_HOST`)
- Methods: `listDevices`, `getDeviceInfo`, `pushFile`, `installApk`, `shell`, `screenshot`, etc.

**device-manager.js** - Polls ADB every 3 seconds:
- Detects new/disconnected devices
- Fetches device info (model, brand, Android version, screen resolution)
- Manages device nicknames (persisted to JSON file)
- Manages groups and master/slave relationships
- Emits events: `device:connected`, `device:disconnected`, `device:updated`, `groups:updated`, `master:changed`

### scrcpy Integration (`desktop-host/src/scrcpy/`)

**scrcpy-client.js** - Manages a scrcpy session per device:
- Pushes `scrcpy-server.jar` to the device
- Auto-detects server version
- Sets up ADB port forwarding
- Connects video + control sockets
- Parses scrcpy v3 H.264 frame format (PTS + packet size + NAL data)
- Touch injection (32-byte scrcpy v3 format)
- UHID keyboard (virtual USB HID device)
- Scroll injection, key events, text injection

**session-manager.js** - Manages multiple concurrent scrcpy sessions:
- Start/stop sessions per device serial
- Forwards video data and input events
- Tracks active sessions

### WebSocket Server (`desktop-host/src/server/ws-server.js`)

Three WebSocket endpoints using `noServer` mode (avoids Express 5 middleware conflicts):

| Endpoint | Purpose |
|----------|---------|
| `/ws/control` | JSON messages: device state, touch/key input, master broadcast |
| `/ws/video?serial=X` | Binary: H.264 video frames per device |
| `/ws/signaling?token=X` | WebRTC signaling relay for remote sharing |

**Video caching**: Stores latest SPS/PPS config and keyframe per device so late-joining viewers can start rendering immediately.

### React Frontend (`web-frontend/src/`)

**VideoPlayer.jsx** - Core component:
- WebCodecs VideoDecoder for hardware-accelerated H.264 decoding
- Canvas rendering with letterboxing
- Mouse → normalized touch coordinate mapping
- Keyboard → Android keycode mapping (DPAD, digits, letters)
- Scroll wheel → Android scroll injection

**App.jsx** - Main layout:
- Sidebar with navigation + groups panel
- Device grid with auto-scaling columns
- Main screen view (double-click to enlarge)
- Auto-mirror on device connect
- Right-click context menu for device management

---

## Communication Protocol

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all connected devices |
| GET | `/api/devices/:serial` | Get device details |
| POST | `/api/devices/:serial/rename` | Set device nickname |
| POST | `/api/devices/connect-tcp` | Connect device via WiFi/TCP |
| GET | `/api/sessions` | List active mirror sessions |
| POST | `/api/sessions/:serial/start` | Start screen mirroring |
| POST | `/api/sessions/:serial/stop` | Stop screen mirroring |
| GET | `/api/groups` | List device groups |
| POST | `/api/groups` | Create a group |
| DELETE | `/api/groups/:id` | Delete a group |
| POST | `/api/groups/:id/add-device` | Add device to group |
| POST | `/api/groups/:id/remove-device` | Remove device from group |
| POST | `/api/master/set` | Set master device |
| POST | `/api/master/clear` | Clear master |
| POST | `/api/batch/install-apk` | Install APK on multiple devices |
| POST | `/api/batch/reboot` | Reboot multiple devices |
| POST | `/api/batch/shell` | Run shell command on multiple devices |
| POST | `/api/batch/screenshot` | Take screenshots |
| POST | `/api/share/create` | Create a share link |
| GET | `/api/share/list` | List active shares |
| GET | `/api/share/:token/validate` | Validate and get share info |
| POST | `/api/share/:token/revoke` | Revoke a share |
| GET | `/api/network-info` | Get LAN IP addresses |
| GET | `/api/health` | Health check |
| POST | `/api/wa-register/type` | Type country code + phone via UHID and Tab-navigate |
| POST | `/api/wa-register/batch` | Run WA Register flow on multiple devices |
| GET | `/api/warmup/state` | Get warm-up state for all devices |
| POST | `/api/warmup/start` | Start warm-up for selected devices (contacts, distribute, useBusiness) |
| POST | `/api/warmup/stop` | Stop warm-up for a device |
| POST | `/api/warmup/execute` | Execute one warm-up action immediately (`force=true` bypasses daily phase limit) |
| GET | `/api/warmup/log/:serial` | Get activity log for a device |

### WebSocket Messages (Control)

**Client → Server:**
```json
{ "type": "input:touch", "data": { "serial": "...", "action": 0, "x": 0.5, "y": 0.3, "width": 1, "height": 1 } }
{ "type": "input:key", "data": { "serial": "...", "action": 0, "keyCode": 23, "repeat": 0, "metaState": 0 } }
{ "type": "input:text", "data": { "serial": "...", "text": "hello" } }
{ "type": "input:scroll", "data": { "serial": "...", "x": 0.5, "y": 0.5, "scrollX": 0, "scrollY": -1, "width": 1, "height": 1 } }
{ "type": "input:clipboard", "data": { "serial": "...", "text": "hello", "paste": true } }
```

**Server → Client:**
```json
{ "type": "init", "data": { "devices": [...], "groups": [...], "sessions": [...], "master": null } }
{ "type": "device:connected", "data": { "serial": "...", "model": "...", ... } }
{ "type": "device:disconnected", "data": { "serial": "..." } }
{ "type": "session:started", "data": { "serial": "..." } }
{ "type": "session:stopped", "data": { "serial": "..." } }
{ "type": "master:changed", "data": "serial" }
```

### Video Stream (Binary)

Each frame: `[1 byte flags] [H.264 NAL data]`

- Flag `0x01`: Config packet (SPS/PPS)
- Flag `0x02`: Keyframe (IDR)
- Flag `0x00`: Delta frame

---

## scrcpy Integration

DroidConsole uses **scrcpy-server v3.3.4** with the following configuration:

```
tunnel_forward=true    # Client connects to server (not reverse)
max_size=1024          # Max dimension in pixels
max_fps=30             # Frame rate cap
video_bit_rate=4000000 # 4 Mbps
video_codec=h264       # H.264 for WebCodecs compatibility
audio=false            # Audio disabled
control=true           # Touch/key input enabled
keyboard=uhid          # Virtual USB HID keyboard
cleanup=false          # Don't restore settings on exit
```

### Connection Flow

1. Push `scrcpy-server.jar` to `/data/local/tmp/` via ADB
2. Auto-detect server version from error output
3. Set up ADB forward: `tcp:<random_port>` → `localabstract:scrcpy`
4. Start server via `app_process`
5. Wait for "Device:" in stderr
6. Connect video socket (receives 77-byte header + H.264 stream)
7. Connect control socket (receives 1-byte dummy, accepts control messages)

---

## UHID Keyboard

Standard Android input injection (`inject_keycode`) is blocked by some apps (e.g., WhatsApp registration). DroidConsole uses scrcpy's **UHID mode** to create a virtual USB keyboard at the Linux kernel level.

### Protocol

1. **UHID_CREATE** (type 12): Creates virtual keyboard with a 65-byte USB HID report descriptor
2. **UHID_INPUT** (type 13): Sends 8-byte HID key reports: `[modifiers, 0x00, key1-key6]`

### Key Mapping

Android keycodes are mapped to USB HID scancodes:
- DPAD arrows → HID arrow keys
- Digits 0-9 → HID digit keys
- Letters A-Z → HID letter keys
- Enter/DPAD_CENTER → HID Return
- Backspace, Tab, Space, Escape → corresponding HID keys

Text input maps characters directly to HID key press/release sequences with shift handling.

---

## Clipboard Sync (PC ⇄ Phone)

Browser `navigator.clipboard.readText()` is used to read the PC clipboard when the user presses **Ctrl+V** on a mirrored canvas. The text is sent to the backend via the `input:clipboard` WebSocket message and forwarded into a scrcpy `SET_CLIPBOARD` control message (type 9):

```
[u8 type=9] [u64 sequence=0] [u8 paste_flag] [u32 text_len] [text bytes]
```

When `paste=true`, scrcpy auto-pastes the clipboard contents into the focused input field on the phone. If the device is the master, clipboard is broadcast to all slave devices.

Ctrl+C / Ctrl+X / Ctrl+A / Ctrl+Z are sent as Android letter keycodes (KEYCODE_A=29 .. KEYCODE_Z=54) with proper meta state (`META_CTRL_ON | META_CTRL_LEFT_ON`).

---

## Screen Rotation

DroidConsole rotates the device screen using:

```
adb shell cmd window user-rotation lock <0|1>
```

This bypasses the `WRITE_SETTINGS` permission requirement of `settings put system user_rotation` and works on OPPO and other locked-down devices.

---

## WhatsApp Register Automation

The WA Register feature drives the WhatsApp registration page using the **UHID virtual keyboard** (since WhatsApp blocks `inject_touch` and `inject_keycode` on this screen).

Flow:
1. User enters country code + phone number in the UI
2. Backend types the country code via UHID
3. Sends 1× Tab → types phone number
4. Sends 1× Tab → Enter (next button)
5. Sleeps 5 seconds
6. Sends 2× Tab → Enter (confirm number dialog)

---

## WhatsApp Warm-Up

The warm-up manager (`warmup-manager.js`) implements a 5-phase state machine that schedules WhatsApp messages over time to age accounts safely.

### Phases

| Phase | Daily Limit | Purpose |
|-------|-------------|---------|
| 1. Setup | small | Initial profile activity |
| 2. Light | low | Manual-feeling messages |
| 3. Moderate | medium | Slowly ramping volume |
| 4. Scaling | higher | Approaching operational |
| 5. Operational | full | Account is warm |

### Action Execution

Each action opens a chat to a contact via deep link:

```
am start -a android.intent.action.VIEW \
  -d "https://api.whatsapp.com/send?phone=<NUMBER>" \
  -p <com.whatsapp | com.whatsapp.w4b>
```

The `-p` package flag is critical — without it Android may pick WhatsApp Business when both apps are installed. The package is chosen from `state.options.useBusiness`.

### Multi-Device Warm-Up

- Multiple devices can warm up concurrently from the WaWarmupPanel
- Contacts can be **distributed** across selected devices, or each device can use the full list
- State is persisted per-device to `data/warmup/warmup-state.json`

### Force Send

`POST /api/warmup/execute` accepts `{ serial, force: true }`. When `force=true`, the daily phase limit check is skipped — useful for manual sends without waiting for the schedule.

### Activity Log

Each device maintains an action history readable via `GET /api/warmup/log/:serial`, displayed in an expandable section in the panel.

---

## Theming (Night/Light Mode)

All component CSS uses CSS variables (Catppuccin palette). The theme is toggled by adding/removing a `data-theme="light"` attribute on `<html>`, which swaps the variable values. A sun/moon button in the header toggles the theme and persists the choice to `localStorage`.

---

## Remote Sharing

### Architecture

```
PC-A (Sharer)                      PC-B (Receiver)
┌─────────────────┐                ┌─────────────────┐
│ DroidConsole    │  LAN/Internet  │ DroidConsole    │
│ + Phones        │ ◄────────────► │ (no phones)     │
│ Port 3001       │                │ Connects to     │
│ Creates share   │                │ PC-A:3001       │
└─────────────────┘                └─────────────────┘
```

### Share Code Format

```
<IP>:<PORT>|<TOKEN>
Example: 192.168.1.100:3001|a1b2c3d4e5f6...
```

### Flow

1. Sharer creates share → gets token with selected devices, permissions, expiry
2. Share code includes the sharer's LAN IP (auto-detected via `/api/network-info`)
3. Receiver pastes code → validates token against remote host
4. Receiver opens WebSocket video streams from remote host
5. Receiver opens control WebSocket for touch/keyboard input
6. For internet: sharer must port-forward 3001

---

## Build & Deployment

### Development

```bash
npm run setup          # Install all dependencies
npm run dev            # Build frontend + launch Electron
```

### Production Build

```bash
npm run build          # Build frontend + create .exe installer
npm run pack           # Build frontend + create unpacked app
```

### Build Output

```
release/
├── DroidConsole Setup 1.0.0.exe    # NSIS installer
├── DroidConsole 1.0.0.exe          # Portable executable
└── win-unpacked/                    # Unpacked app directory
    ├── DroidConsole.exe
    └── resources/
        ├── app.asar               # Application code + node_modules
        ├── vendor/                # scrcpy-server.jar
        └── web-frontend-dist/     # Built React frontend
```

### Docker (Alternative)

```bash
docker-compose up -d   # Runs host + frontend containers
```

Requires ADB server running on the host: `adb -a nodaemon server start`

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `ADB_PATH` | Auto-detected | Path to adb.exe |
| `ADB_HOST` | *(empty)* | Remote ADB server host (Docker) |
| `ADB_PORT` | `5037` | ADB server port |
| `LOG_LEVEL` | `INFO` | Logging: DEBUG, INFO, WARN, ERROR |
| `SCRCPY_JAR_PATH` | Auto | Override scrcpy-server.jar location |
| `NICKNAMES_PATH` | Auto | Override nicknames.json location |

### ADB Auto-Discovery

DroidConsole searches for `adb.exe` in these locations (in order):

1. `ADB_PATH` environment variable
2. `%LOCALAPPDATA%\Android\Sdk\platform-tools\`
3. `%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\`
4. `%USERPROFILE%\adb.exe`
5. `%USERPROFILE%\platform-tools\`
6. `%ProgramFiles%\Android\platform-tools\`
7. `C:\adb\`, `C:\platform-tools\`, `C:\scrcpy\`
8. All directories in system PATH
9. Falls back to `adb` (assumes it's on PATH)

---

## Troubleshooting

### Devices not detected

- Ensure USB Debugging is enabled on the phone
- Accept the RSA key prompt on the device
- Check `adb devices` works in Command Prompt
- DroidConsole logs the ADB path on startup: look for "Found ADB" in logs

### Mirror won't start

- Ensure `scrcpy-server.jar` exists in `desktop-host/vendor/`
- Check device is authorized (not "unauthorized" status)
- Try restarting ADB: `adb kill-server && adb start-server`

### Port 3001 already in use

- Another DroidConsole instance may be running
- Check: `netstat -ano | findstr :3001`
- Kill the process or change the port via `PORT` env var

### Keyboard doesn't work on WhatsApp

- UHID keyboard is enabled by default (`keyboard=uhid`)
- Use Tab to navigate, Enter to tap, digits to type
- If scrcpy version doesn't support UHID, update `scrcpy-server.jar` to v3.1+

### Remote share can't connect

- Ensure both PCs are on the same network
- Check if port 3001 is open: `curl http://<IP>:3001/api/health`
- Windows Firewall may block incoming connections — add an exception
- For internet: port-forward 3001 on the router
