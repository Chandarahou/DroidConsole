# DroidConsole

A desktop application for managing, mirroring, and controlling multiple Android devices simultaneously from your PC.

![Electron](https://img.shields.io/badge/Electron-35-blue) ![Node.js](https://img.shields.io/badge/Node.js-22+-green) ![React](https://img.shields.io/badge/React-19-61DAFB) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Multi-Device Screen Mirroring** - Mirror dozens of Android phone screens simultaneously with live H.264 video streaming via scrcpy
- **Full Device Control** - Touch, keyboard, scroll, and DPAD navigation from your PC
- **UHID Keyboard** - Virtual USB keyboard that bypasses app input restrictions (works on WhatsApp registration, etc.)
- **Auto-Mirror** - All connected devices start mirroring automatically on app launch
- **Splash Screen** - Animated bouncing logo splash screen on launch
- **Custom Branding** - Custom Yihao app icon embedded into the .exe
- **Main Screen View** - Double-click any device to enlarge it as the main screen with a control panel (Laixi-style)
- **Device Groups** - Laixi-style sidebar Groups panel: create/edit/delete groups, device chips, filter the grid by group
- **Right-Click Context Menu** - Set device name, move device between groups
- **Screen Rotation Button** - Toggle portrait/landscape per device using `cmd window user-rotation lock` (no permissions needed)
- **Night/Light Theme Toggle** - Sun/moon button switches between Catppuccin dark and light themes (CSS variables)
- **WA Register** - Automate WhatsApp registration: enters country code + phone number using UHID keyboard (bypasses WhatsApp input blocks), then Tab navigation to confirm
- **WA Warm-Up** - Automate WhatsApp account warm-up across multiple devices:
  - 5 phases (Setup → Light → Moderate → Scaling → Operational) with daily message limits
  - Multi-device selection with checkbox list and contact distribution
  - WhatsApp vs WhatsApp Business toggle (correct app picked via `-p com.whatsapp` intent flag)
  - Activity log with expandable history
  - **Force Send** button bypasses daily phase limits
- **PC ⇄ Phone Clipboard Sync** - Ctrl+V on the mirrored screen reads the PC clipboard and pushes it to the phone via scrcpy `SET_CLIPBOARD` (auto-pastes into focused field). Ctrl+C/X/A/Z send proper Android keycodes with meta state
- **Master/Slave Input** - Set a master device and broadcast touch/keyboard/clipboard input to all other devices
- **Remote Sharing** - Share device screens with other PCs on LAN or internet via share codes
- **Batch Operations** - Install APKs, reboot, clear data, take screenshots, run shell commands across multiple devices
- **TCP/WiFi Connect** - Connect devices wirelessly via ADB TCP

## Quick Start

### Prerequisites

- **Windows 10/11** (64-bit)
- **ADB** (Android Debug Bridge) installed and on PATH
- **Android devices** with USB Debugging enabled
- **Node.js 18+** (for development only)

### Install from Release

1. Download `DroidConsole Setup 1.0.0.exe` from Releases
2. Run the installer
3. Connect Android devices via USB
4. Launch DroidConsole - devices auto-mirror immediately

### Build from Source

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/DroidConsole.git
cd DroidConsole

# Install all dependencies
npm run setup

# Run in development mode
npm run dev

# Build the .exe installer
npm run build
```

## Usage

### Keyboard Shortcuts (on mirrored screen)

| Key | Action |
|-----|--------|
| Arrow Keys | DPAD navigation (focus box) |
| Enter | Tap focused element (DPAD Center) |
| Tab | Navigate between UI elements |
| Esc | Android Back button |
| Backspace | Delete character |
| 0-9 | Type digits |
| Letters | Text input |
| Ctrl+V | Push PC clipboard to phone and auto-paste |
| Ctrl+C / Ctrl+X / Ctrl+A / Ctrl+Z | Send copy/cut/select-all/undo as Android keycodes |
| F5 | Recent apps (Menu) |

### WA Register

1. Open the WhatsApp registration page on the device
2. Go to the **WA Register** tab, enter country code and phone number
3. Click Send — DroidConsole types via UHID keyboard and Tab-navigates to confirm

### WA Warm-Up

1. Go to the **WA Warm-Up** tab
2. Select one or more devices, paste contacts (and toggle "Distribute contacts" for multi-device)
3. Toggle **Use WhatsApp Business** if needed
4. Start — actions follow phase-based daily limits
5. Use **Force Send** to bypass the daily phase limit when needed
6. Expand **Activity Log** to view history

### Theme

Click the sun/moon button in the header to toggle Night/Light theme.

### Remote Sharing

1. **Sharer**: Go to "Remote Share" tab, select devices, click Share to get a share code
2. **Receiver**: Go to "Received" tab, paste the share code, click Connect
3. Works on LAN directly. For internet, port-forward port 3001

### Device Groups

- Create groups in the sidebar Groups panel
- Right-click a device to "Move to Group"
- Click a group name to filter the main grid

## Screenshots

*Connect your devices and the screens appear automatically in the grid view.*

## Tech Stack

- **Electron** - Desktop application framework
- **React + Vite** - Frontend UI
- **Express + WebSocket** - Backend server
- **scrcpy-server** - Android screen capture and control
- **UHID** - Virtual USB HID keyboard for unrestricted input

## License

MIT
