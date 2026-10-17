# Deploy

This whole folder is the deployable unit: `app/` is a self-contained copy of the backend source
(no `node_modules`, no generated Prisma client, no `.env` — those get created on the server), and
the three files next to it are what install/run/renew it as a service.

## Files

- **`app/`** — the application: `src/`, `prisma/schema.prisma`, `public/`, `package.json`,
  `package-lock.json`, `prisma7.config.ts`. Copied from `../src`, `../prisma`, etc. — keep it in
  sync by hand if those change (it's a snapshot, not a symlink).
- **`optician-backend.service`** — systemd unit that runs `app/` as a service (auto-restart,
  starts on boot). Has placeholders for the service user, `app/`'s absolute path on the server,
  `DATABASE_URL`, and the SSL cert paths — fill those in before installing it.
- **`restart-backend.sh`** — certbot renewal hook. The backend only reads
  `SSL_KEY_PATH`/`SSL_CERT_PATH` at startup, so a renewed cert on disk does nothing until the
  process restarts; this hook makes that automatic.
- **`migrate.sh`** — runs `prisma migrate deploy` inside `app/` (applies committed migrations,
  never generates new ones or prompts) against `DATABASE_URL`. Run before every deploy that
  includes a schema change.

## Getting it onto the server

```bash
scp -r deploy/ user@server:/opt/optician-backend
```

Anywhere else is fine too — just use that real path (not the placeholder) everywhere below and
in `optician-backend.service`'s `WorkingDirectory`.

## First-time server setup, in order

1. Point DNS at the server, open ports 80/443.
2. `sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))` — lets Node bind
   80/443 without running as root.
3. Get a cert (see `../README.md` for the certbot commands — webroot or standalone).
4. On the server, inside the copied folder:
   ```bash
   cd /opt/optician-backend/app
   npm install
   npx prisma generate
   ```
5. Fill in the placeholders in `optician-backend.service` (service user, `app/`'s real path,
   `DATABASE_URL`, cert paths), then:
   ```bash
   cd /opt/optician-backend
   sudo cp optician-backend.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
6. Install the renewal hook:
   ```bash
   sudo cp restart-backend.sh /etc/letsencrypt/renewal-hooks/deploy/
   sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-backend.sh
   ```
7. `DATABASE_URL=... sh migrate.sh` — creates the tables.
8. Run `app/prisma/permissions.sql` once as the table-owner role (e.g. the Neon SQL editor), after
   putting the role from `DATABASE_URL` on its `set_config` line. It creates the `customers` table
   if missing, adds newer columns to older tables, stops if the shop-management tables (created by
   `migrate.sh`) are missing, grants that role what the backend needs (reads, plus insert/update/delete on the
   tenant-owned tables, limited to the tenant's own rows), and turns on the row-level security
   that isolates tenants.
   `DATABASE_URL` must be a *different*, non-owner role — owners bypass RLS; the backend warns at
   startup if it isn't set up.
9. `sudo systemctl enable --now optician-backend` — starts it, and on every future boot.

## Every later deploy (schema unchanged)

```bash
scp -r deploy/ user@server:/opt/optician-backend
ssh user@server 'cd /opt/optician-backend/app && npm install && npx prisma generate && sudo systemctl restart optician-backend'
```

## Every later deploy (schema changed)

```bash
scp -r deploy/ user@server:/opt/optician-backend
ssh user@server 'cd /opt/optician-backend/app && npm install && npx prisma generate'
ssh user@server 'DATABASE_URL=... sh /opt/optician-backend/migrate.sh'
ssh user@server 'sudo systemctl restart optician-backend'
```
