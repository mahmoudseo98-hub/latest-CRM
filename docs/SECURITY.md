# Production Security Checklist

Before exposing the application publicly:

- Set unique `APP_USERNAME` and `APP_PASSWORD` environment variables.
- Use the Hostinger HTTPS domain; do not send credentials over plain HTTP.
- Keep `.env`, `data/`, backups and employee exports out of Git.
- Set a separate token on each HTTP-push device when the hardware supports it.
- Leave `ENABLE_LAN_DEVICE_ACCESS=false` on remote hosting.
- Restrict access at the Hostinger/account/network layer when possible.
- Rotate the application password and device tokens after staff changes.
- Download and test backups regularly.
- Review `audit.jsonl` through the launcher audit export.

The in-app CEO/director/manager/lead/employee selector controls the supplied prototype interface; it is not a separate login system. The server username/password protects the entire application. If every employee needs an individual account, per-user authentication and server-enforced authorization must be added as a separate project.

Uploaded logos are limited to supported image formats and size. SVG uploads reject script, event-handler, JavaScript URL and `foreignObject` content. Project names and static file paths are sanitized. API writes require a same-origin header, and device push routes use per-device tokens when configured.
