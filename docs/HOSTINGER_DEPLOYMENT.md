# Deploy on Hostinger

This project matches Hostinger’s managed Node.js “Other” application type. Hostinger currently supports GitHub imports and ZIP uploads for Node.js web apps, and supports Node.js 24.x.

Official references:

- [Deploy a Node.js website on Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Migrate a Node.js application using GitHub or ZIP](https://www.hostinger.com/support/how-to-migrate-a-node-js-application-to-hostinger/)
- [Select the Node.js version](https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/)
- [Add or edit environment variables](https://www.hostinger.com/support/how-to-edit-or-add-environment-variables-after-deployment/)

## Option A — GitHub (recommended)

1. Create an empty GitHub repository.
2. Upload **the contents of this folder** so `package.json` and `server.js` are at the repository root.
3. Do not upload `.env`, `node_modules`, or runtime files inside `data/`.
4. In Hostinger hPanel, go to **Websites → Add Website → Deploy Web App**.
5. Select **Import Git Repository**, authorize GitHub, select the repository and branch.
6. Use these deployment settings:

   | Setting | Value |
   |---|---|
   | Framework | `Other` |
   | Node.js | `24.x` |
   | Entry file | `server.js` |
   | Start command | `npm start` |
   | Build command | Leave empty |
   | Output directory | Leave empty |

7. Add the environment variables below.
8. Deploy, then open `/api/health`. A healthy response contains `"status":"ok"`.

## Option B — Upload the ready ZIP

1. Use the provided Hostinger ZIP; `package.json` is already at its archive root.
2. In hPanel, choose **Deploy Web App → Upload your website files**.
3. Upload the ZIP and use the same settings and variables shown above.
4. Deploy and verify `/api/health`.

## Required environment variables

Add these in hPanel’s **Environment Variables** section:

```text
NODE_ENV=production
HOST=0.0.0.0
APP_USERNAME=choose-a-private-admin-name
APP_PASSWORD=use-a-long-random-password
DATA_DIR=./data
ENABLE_LAN_DEVICE_ACCESS=false
```

The application reads Hostinger’s `PORT` automatically and falls back to port 3000. Do not hardcode a different production port unless hPanel requires it.

After changing environment variables, apply the changes and restart/redeploy the Node.js application.

## Data durability

The default store writes to `./data`. Before entering real employee or attendance data:

1. Confirm the directory is writable from **Configuration → launcher → Download Server Backup** and verify the downloaded JSON.
2. Download backups regularly, especially before a redeployment.
3. If your Hostinger plan exposes a persistent path outside the checked-out application, set `DATA_DIR` to that absolute path.
4. For business-critical or multi-instance use, move server records to a managed database rather than relying on repository-local JSON files.

## Real fingerprint terminals on Hostinger

### Recommended: HTTP/ADMS push

1. Add an **HTTP push** device in the Devices Hub.
2. Start it.
3. Copy the exact HTTPS endpoint shown on its card, for example:

   `https://your-domain.example/api/device-push/dev_xxxxxxxxxxxxxxxx`

4. Paste it into the terminal’s ADMS/server URL field.
5. If a token was configured, the terminal must send it as `X-Token`, `Authorization: Bearer …`, or the endpoint query parameter `?token=…`.
6. Scan once and complete the name-enrollment card.

### ZK TCP and LAN scan

Do not enable `ENABLE_LAN_DEVICE_ACCESS` on remote managed hosting expecting it to find the office network. Private addresses such as `192.168.x.x` are only reachable when the Node server itself is on that LAN or connected through a controlled VPN. Use an office server/VPS network design for ZK TCP 4370.

## If deployment fails

- Confirm `package.json` is at the repository/ZIP root.
- Confirm Node.js 24.x is selected.
- Confirm the entry file is `server.js` and the start command is `npm start`.
- Leave build/output blank because this project serves its checked-in browser assets directly.
- Check the Hostinger deployment log for missing or invalid environment variables.
- Do not upload `node_modules`; Hostinger handles npm setup.
