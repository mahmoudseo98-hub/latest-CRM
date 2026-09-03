# SEO For All OS — Node.js Web Edition

This folder is the complete web conversion of the supplied Electron desktop application. It preserves the original launcher, seven-step Configuration Center, 14-module Company Intelligence OS, role controls, reports, dark/light mode, Three.js 3D workspace and Office Decor Studio, and Fingerprint Devices Hub.

The Electron-only layer was replaced with a same-origin Node.js API. The project has no runtime npm dependencies, no CDN assets, and no front-end build step.


## Accounts and sign-in

The application is reached through a branded sign-in page at `/signin.html`, not the
browser's own credential prompt.

- **First run.** With no account yet, that page opens in "create the owner account"
  mode. On a public deployment this window is guarded by `APP_USERNAME` /
  `APP_PASSWORD`, so a stranger cannot claim the owner account before you do. The
  first account created is always Owner / CEO.
- **After that.** Individual accounts and session cookies are authoritative, and the
  shared deployment credential stops opening the application. Public sign-up is
  closed permanently — further accounts are created by an administrator.
- **Sessions.** Opaque random tokens, stored server-side as SHA-256 hashes, in an
  `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). They expire after 12
  hours idle and 7 days absolute, or 30 days with "keep me signed in". Changing a
  password signs every other session out.
- **Passwords.** Hashed with `scrypt` and a unique per-account salt, compared in
  constant time. Never stored, logged, returned by the API, or included in a backup.
- **Mutations** carry a double-submit CSRF token bound to the session, and repeated
  failed sign-ins are rate limited per account and per IP.
- **Password recovery** is not automated because no mail service is configured. The
  sign-in page says so plainly and points to the administrator rather than pretending
  an email was sent.


## Run locally

Requirements: Node.js 24.

```bash
cp .env.example .env
# Change APP_USERNAME and APP_PASSWORD in .env
npm start
```

Open `http://localhost:3000`. On the first visit, the seven-step setup wizard opens automatically.

## Production configuration

Set these environment variables in your hosting dashboard:

| Variable | Required | Recommended value |
|---|---:|---|
| `NODE_ENV` | Yes | `production` |
| `APP_USERNAME` | Yes for first run on public hosting | Guards the one-time owner-account setup. Once an owner account exists, individual sign-in replaces it and this no longer opens the app. |
| `APP_PASSWORD` | Yes for first run on public hosting | A long unique password for that one-time setup window. |
| `DATA_DIR` | Recommended | A writable persistent directory; default `./data` |
| `HOST` | No | `0.0.0.0` |
| `PORT` | No | The host-provided port; fallback is `3000` |
| `ENABLE_LAN_DEVICE_ACCESS` | No | `false` on Hostinger; `true` only on a trusted office-LAN server |

Do not commit `.env` or the contents of `data/`.

## Hostinger settings

- Application/framework type: `Other`
- Node.js version: `24.x`
- Entry file: `server.js`
- Start command: `npm start`
- Build command: leave empty
- Output directory: leave empty

See [HOSTINGER_DEPLOYMENT.md](docs/HOSTINGER_DEPLOYMENT.md) for the exact GitHub and ZIP deployment flow.

## Verification

```bash
npm test
npm run check
```

The health endpoint is `/api/health`.

## Important hardware note

A remote Hostinger server cannot discover or open TCP connections to fingerprint terminals on a private office LAN. On Hostinger, use:

- HTTP/ADMS push to the public HTTPS endpoint shown on each configured device card;
- attendance TXT/CSV/DAT import;
- browser-focused USB keyboard-wedge capture; or
- the built-in simulator.

ZK TCP polling and network scanning work only when this Node.js server runs on the same trusted private LAN as the terminal and `ENABLE_LAN_DEVICE_ACCESS=true`.

## Documentation

- [Feature audit and parity matrix](docs/FEATURE_AUDIT.md)
- [Hostinger deployment](docs/HOSTINGER_DEPLOYMENT.md)
- [Web user guide](docs/USER-GUIDE-WEB.md)
- [Security checklist](docs/SECURITY.md)
- [QA report](docs/QA-REPORT.md)

## Project structure

```text
public/             Original interface and locally vendored browser assets
src/                Node.js API, persistence, audit, device, and security layer
tests/              API, parser, static UI, and optional browser smoke tests
data/               Runtime data (ignored by Git)
server.js           Hostinger entry file
package.json        Start and verification commands
```

## Original prototype behavior retained

The Google Drive connection, many dashboard data sets, and approval demonstrations are deterministic prototype interfaces, not connections to live AI, Google Drive, payroll, or HR systems. This conversion preserves that behavior instead of claiming integrations the desktop source did not contain.
