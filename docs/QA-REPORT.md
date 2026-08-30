# QA Report

## Completed checks

- ZIP integrity and path-safety inspection.
- Syntax validation for every new server/client JavaScript file.
- Parsing validation for every inline classic/module script in all five HTML applications.
- Runtime-asset validation: all browser `src`/`href` assets are local and present; no Electron `app://` URLs remain.
- Node API integration workflow: company setup, app-data seed, projects, people, simulator, punches, file import, HTTP push authorization, backup and audit.
- Authentication and same-origin mutation guard.
- Attendance parsers: CSV headers, quoted CSV, classic ZKTeco tab format.
- HTTP punch parsers: ADMS, generic `/iclock/cdata`, JSON and form payloads.
- Vendor detection and private-address safety checks.
- DOM execution checks for launcher, setup, devices and the Company OS main script with representative interactions.
- Company OS inventory: exactly 14 primary navigation modules.
- Company OS task creation in a DOM runtime after repairing the original drag/drop syntax defect.

## Automated result

All committed dependency-free tests pass with:

```bash
npm test
npm run check
```

The optional `tests/e2e-smoke.js` exercises setup, all modules, tasks, 3D/decor, RBAC, themes, device events and name enrollment when Playwright plus Chromium is installed. The packaging environment exposed Playwright’s library but did not include its Chromium executable, so no screenshot or image-based assertion is claimed here.

## Not reproducible without external hardware/platform access

- Physical ZKTeco TCP handshake and real terminal polling.
- A real ADMS terminal posting through the final public Hostinger HTTPS domain.
- Hostinger build/deployment logs and persistence behavior on the user’s specific plan.
- Microphone and screen-capture permission prompts in the user’s browser.

These external checks are separated from the verified software pipeline and documented in the deployment/user guides.
