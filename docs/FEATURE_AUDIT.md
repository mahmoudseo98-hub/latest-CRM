# Feature Audit and Conversion Parity

## Audit scope

The supplied ZIP was checked without executing its Windows binaries.

- Archive size: 265,660,014 bytes
- Entries: 64,043
- ZIP integrity: passed with no compressed-data errors
- Original technology: Electron shell, static HTML/CSS/JavaScript, Three.js, jsPDF, Font Awesome, Tailwind browser build, local JSON/JSONL storage
- Original product surfaces: launcher, Configuration Center, Company Intelligence OS, embedded 3D Office Decor Studio, Fingerprint Devices Hub

The archive also contained an earlier `seo-for-all-nodejs` folder. It was not a literal conversion: it used a small React interface, omitted most of the Company OS, contained two conflicting backend entry implementations, and did not preserve the 3D/decor or full role/device workflows. The production folder in this deliverable replaces that partial rewrite.

## Defects found in the supplied application

| Finding | Impact | Resolution in this folder |
|---|---|---|
| Missing closing brace in `wireTaskDragAndDrop()` | The Company OS main inline script could not parse | Repaired and syntax-tested |
| Devices page referenced nonexistent `#dPunches` | Refresh ended with a null-element exception | Removed the dead counter/read |
| Network-scan ADD handler referenced an out-of-scope variable | Clicking a discovered terminal raised a reference error | Vendor is stored in button data and read safely |
| Electron export hook referenced browser-undefined `Buffer` | Native string export fell into an exception path | Replaced with browser-safe length/download handling |
| `app://` company-logo URLs | Invalid after web deployment | Replaced with protected same-origin `/company-logo/` route |
| Referenced logo asset was absent from the package | Repeated 404/broken image icon | Missing asset reference removed; configured company logo is used |
| Electron file/folder dialogs and filesystem calls | Unavailable in a browser | Browser file picker/download and server backup equivalents added |
| Auto-backup preference was stored but did not create a backup | Enabling the option had no operational effect | Saving configuration now also downloads a complete server backup when enabled |
| Electron keyboard-wedge window | Unavailable on Hostinger | Focused web-page capture bridge added |
| Device HTTP connector opened a second local port | Incompatible with managed single-port hosting | Merged into the main HTTPS Node application routes |
| Existing Node rewrite omitted most application features | Not feature-parity | Original renderer preserved rather than recreated partially |
| Existing Node rewrite had no public-host authentication | Employee/device data could be exposed | Optional HTTP Basic authentication plus same-origin write guard added |

## Feature parity matrix

| Area | Original capability | Web conversion status |
|---|---|---|
| Launcher | Two application cards, metrics, configuration, audit, guide | Preserved; runtime labels and backup action adapted for web |
| First-run setup | Seven steps: company, registrant, departments, employees, devices, preferences, review | Preserved; saved to server-side `company/config.json` |
| Branding | Company name, tagline, country, logo, avatar initials | Preserved; logo upload is validated and served same-origin |
| Role selection | CEO, director, manager, lead, employee | Preserved exactly as the original UI policy model |
| Overview | Greeting, KPIs, activity, quick actions, scoped dashboard | Preserved |
| Organization | Hierarchy/digital twin and department scope | Preserved |
| Attendance | Ledger, timer, deductions, leave simulation, date filters | Preserved; live web device punches feed the ledger |
| Projects | Workspaces, work logs, document timer, issues, resources, Drive mock | Preserved |
| Tasks | Four-column board, creation, detail, privileges, filters, drag/drop | Preserved; source parse defect repaired |
| Requests | Cross-department requests, SLA/status, handoff display | Preserved |
| Discussions | Threads, composer, new discussion workflow | Preserved |
| Performance | Contribution scores, risks, ranking/evidence views | Preserved |
| Project Tools | Work evidence, screen capture, issue queue, categories | Preserved; browser permission is used for screen capture |
| Reports | Builder, CSV export, KPIs, preview, Drive mock | Preserved; export uses browser download |
| 3D Workspace | Three.js room, departments, workstations, coverage and risks | Preserved with local Three.js assets |
| Office Decor Studio | 12 catalog items, four templates, placement, drag, rotate, delete, undo, brand/theme, cost/egress, persistence | Preserved |
| Settings | Workflow, Drive mock, Fun scheduler, backup import/export, reset | Preserved; client preferences remain browser-local as in source |
| Governance | RBAC matrix, role scope, privilege-center display/edit prototype | Preserved |
| Theme | Full dark/light mode and persistence | Preserved in browser localStorage |
| Responsive layout | Desktop, tablet and narrow-screen rules | Preserved |
| Project snapshots | Save/list/load/delete layout projects | Ported to server-side JSON storage |
| Audit trail | Append-only action history | Ported to server-side JSONL |
| Backup | Export/import application data | Added full protected server backup plus original client backup |

## Fingerprint device options

| Option | Web implementation | Hostinger suitability |
|---|---|---|
| HTTP push / ADMS / iClock | Main web server exposes GET health and POST punch endpoints; optional per-device token | Best real-time option when the terminal can reach public HTTPS |
| ZK TCP port 4370 | Pure Node ZKTeco handshake, test and polling retained | Only when Node runs on the same private LAN; not from remote Hostinger to an office LAN |
| LAN scan | Private-interface enumeration, bounded port probes and vendor detection retained | Only on same-LAN deployments and disabled by default |
| USB keyboard wedge | Captures scanner keystrokes while the Devices page is focused and device is started | Works in a desktop browser; focus is required |
| File import | TXT/CSV/DAT selection, delimiter/header/profile detection, normalized punches | Fully suitable |
| Simulator | Manual or interval punches through the same event pipeline | Fully suitable |
| Name enrollment | Unknown punch opens form; saved binding enriches later punches and roster | Fully suitable |
| Live stream | Server-Sent Events to every connected authenticated browser | Fully suitable |

## Persistence map

| Data | Location |
|---|---|
| Company configuration and logo | `DATA_DIR/company/` |
| Devices | `DATA_DIR/devices.json` |
| Registered people | `DATA_DIR/people.json` |
| Project snapshots | `DATA_DIR/projects/*.json` |
| Punches | `DATA_DIR/punches.jsonl` |
| Audit history | `DATA_DIR/audit.jsonl` |
| Theme, Fun schedule, workflow prototype settings | Browser localStorage, matching the original behavior |

All JSON records are written atomically where replacement is used. Audit and punch records remain append-only JSONL.

## Honest web constraints

1. The original role selector is a prototype policy switch, not individual user authentication. Server-wide authentication protects the deployment, but separate employee accounts would be a new feature.
2. A hosted server cannot access a private office network without VPN/tunneling or an on-premise deployment.
3. Browser screen capture, voice input and keyboard-wedge capture depend on browser support, HTTPS/localhost security rules, user permission and page focus.
4. LocalStorage settings are browser/profile specific; server records are shared.
5. Google Drive remains a simulation because the original source did not contain live credentials or APIs. The Executive AI module was removed from the product entirely (nav, view, dashboard cards, permissions and engine code).
6. JSON storage is appropriate for a single Node process. A multi-instance deployment or mission-critical payroll system should use a managed database.
