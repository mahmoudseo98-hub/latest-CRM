# SEO For All OS — Web User Guide

## 1. First visit

The application opens a seven-step setup wizard when no company configuration exists:

1. Company name, tagline, country, timezone, currency and optional logo.
2. Registering person and primary role.
3. Departments.
4. Employee roster and fingerprint/device IDs.
5. Fingerprint devices.
6. Work rules and preferences.
7. Review and launch.

Configuration is stored on the Node.js server. Reopen it from **Configuration** on the launcher.

## 2. Launcher

The launcher opens:

- **Company Intelligence OS** — the complete 14-module workspace.
- **Fingerprint Devices Hub** — device connection, live punches and name enrollment.

It also shows configured projects, audit actions, punches and device status. **Download Server Backup** downloads a protected full JSON backup.

## 3. Company Intelligence OS

The left navigation contains:

1. Overview
2. Organization
3. Attendance & Payroll Events
4. Tasks
5. Projects
6. Project Tools
7. Assistance Requests
8. Company Discussions
9. Performance
10. Permissions
11. Reports
12. 3D Workspace
13. Settings

The role selector applies the original UI policy. Owner/CEO has the full scope. The 3D Workspace is owner/CEO-only.

Use the moon/sun button to switch dark and light mode. The preference is saved in the current browser.

## 4. 3D Workspace and Office Decor Studio

Open **3D Workspace** as Owner/CEO. The scene includes department zones, employee workstations, themes, occupancy, risk layers and view controls.

The docked Office Decor Studio supports:

- four decor templates;
- 12 furniture types;
- click-to-place with a ghost preview;
- select, drag, rotate and delete;
- editing existing plants, lights and employee desks;
- undo, clear and reset;
- brand colors and room themes;
- live item cost and egress indicator;
- browser-local auto-save;
- PNG download.

## 5. Devices Hub

### HTTP push

Add the device, then copy the HTTPS endpoint shown on its card into the terminal ADMS/server settings. This is the recommended Hostinger connection.

### ZK TCP

Available only when the Node server is on the same private LAN and the administrator enabled LAN device access.

### USB keyboard wedge

Start the device and keep the Devices page focused. Scan while no text field is active. The reader’s typed ID is sent as a punch.

### File import

Choose **Import File** and select TXT, CSV or DAT. Delimiters and common employee/date/time/verify/status columns are detected automatically.

### Simulator

Use manual or automatic punches to test enrollment, attendance and audit behavior without hardware.

## 6. Register a scanned person

1. An unknown ID arrives in the live stream.
2. The enrollment card opens with the ID filled in.
3. Enter the person’s name and optional department.
4. Save.
5. Future punches show the name, and the company roster is updated.

## 7. Backup and privacy

- Use **Download Server Backup** from the launcher.
- Keep backups outside the Git repository.
- Never commit `.env` or `data/`.
- A configured public deployment is protected by the server username/password and HTTPS.
- Browser-local prototype settings are not shared between different browsers; server company/device/people/project/audit records are shared.

## 8. Browser permissions

Screen capture and voice input may require HTTPS, a supported browser and explicit permission. Keyboard-wedge capture requires page focus. WebGL must be enabled for the 3D workspace.
