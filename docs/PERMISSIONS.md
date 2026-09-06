# Permission matrix

Generated from `src/permissions.js`, which is the single policy every API
handler consults. Hiding a control in the UI is a convenience; this table is
what the server actually enforces. Any capability not granted here is denied,
so a newly added route stays closed until it is deliberately opened.

| Capability | owner | admin | director | manager | lead | employee | client |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `info:read` | Y | Y | Y | Y | Y | Y | Y |
| `company:read` | Y | Y | Y | Y | Y | Y | Y |
| `company:write` | Y | Y | Y | · | · | · | · |
| `company:reset` | Y | · | · | · | · | · | · |
| `people:read` | Y | Y | Y | Y | Y | · | · |
| `people:write` | Y | Y | Y | · | · | · | · |
| `devices:read` | Y | Y | Y | Y | · | · | · |
| `devices:write` | Y | Y | · | · | · | · | · |
| `devices:control` | Y | Y | · | · | · | · | · |
| `punches:read` | Y | Y | Y | Y | Y | · | · |
| `projects:read` | Y | Y | Y | Y | Y | Y | · |
| `projects:write` | Y | Y | Y | Y | Y | · | · |
| `audit:read` | Y | Y | Y | · | · | · | · |
| `audit:write` | Y | Y | · | · | · | · | · |
| `backup:export` | Y | Y | Y | · | · | · | · |
| `backup:restore` | Y | · | · | · | · | · | · |
| `storage:read` | Y | Y | Y | Y | · | · | · |
| `events:read` | Y | Y | Y | Y | Y | Y | · |

## Notes

- `company:reset` and `backup:restore` destroy or overwrite the entire
  workspace, so they stay with the owner even for admins.
- An employee is not granted `people:read` or `punches:read`. Those are other
  people's attendance data. Per-record self-service ("my attendance") needs an
  account-to-employee link that does not exist yet; withholding is safer than
  guessing which employee row belongs to the signed-in account.
- The role is read from the server session on every request, never from
  anything the client sends. A request made outside the UI is judged the same
  way as one made through it.
- Refusals are audited as `auth.forbidden` with the role and the capability
  that was required.
