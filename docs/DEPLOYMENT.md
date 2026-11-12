# Deployment

This guide covers the web and LAN builds. The desktop build is a separate installer that starts the same server on a free port; see [DESKTOP.md](DESKTOP.md).

## Local development

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173
- API: http://127.0.0.1:8000
- The Vite dev server proxies `/api` to the API server.

## Production build

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

`pnpm build` produces:

- `apps/server/dist/index.js` — bundled server (shared schemas are bundled in);
- `apps/web/dist/` — static SPA.

`pnpm start` runs the server, which serves the SPA and API from the same port. Open http://127.0.0.1:8000.

The Claude tokenizer vocabulary lives in `apps/server/assets/tokenizers/claude.json` and is read at startup. If you copy only `apps/server/dist` somewhere else, the file is missing and the server logs a warning; Claude models then fall back to the character-based estimate, and everything else works. Copy `apps/server/assets` along with `dist` to keep exact Claude counts.

## Configuration

| Variable                    | Default       | Purpose                                                       |
| --------------------------- | ------------- | ------------------------------------------------------------- |
| `CATCUP_HOST`               | `127.0.0.1`   | Bind address; use `0.0.0.0` for LAN                           |
| `CATCUP_PORT`               | `8000`        | HTTP port; `0` lets the OS pick a free one                    |
| `CATCUP_DATA_DIR`           | `<repo>/data` | Data root; recommended absolute path in production            |
| `CATCUP_LOG_LEVEL`          | `info`        | Pino log level                                                |
| `CATCUP_ALLOW_REMOTE_SETUP` | `false`       | Allow first-run setup from a non-loopback address; keep false |

Use an absolute `CATCUP_DATA_DIR` for services and containers so the working directory does not change the data location.

When the OS picks the port (`CATCUP_PORT=0`), the server writes `CATCUP_READY <port>` to stdout once it is listening. Supervisors and the desktop shell read that line; the prefix is a contract, not a log message.

## LAN access

1. Start the server on the host machine with `CATCUP_HOST=0.0.0.0`.
2. Open the app once on that machine and set the access password.
3. From another device, open `http://<host-lan-ip>:8000` and log in with the same password.
4. Allow the port only on trusted networks; use a firewall to restrict it.

The first password must be set locally. If you start with `0.0.0.0` before setup, the setup endpoint still rejects non-loopback requests unless `CATCUP_ALLOW_REMOTE_SETUP=true`. Do not enable that flag on an untrusted network.

## Reverse proxy and TLS

There is no built-in TLS. For access beyond a trusted LAN, put the server behind a TLS reverse proxy or VPN and keep the upstream on loopback.

### Nginx example

```nginx
server {
    listen 443 ssl;
    server_name tavern.example.com;

    ssl_certificate     /etc/letsencrypt/live/tavern.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tavern.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE generation
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

### Caddy example

```caddyfile
tavern.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

**Important cookie caveat:** the server currently does not implement `trustProxy`, so it decides whether to set the session cookie's `Secure` flag from the protocol it sees. Behind a TLS-terminating proxy it will see HTTP and will not set `Secure`. Treat this build as suited for a trusted LAN/VPN until trust-proxy/TLS handling is added (tracked in M5). Do not expose it directly to the public internet.

Also make sure the proxy:

- does not expose the `data/` directory;
- does not buffer the SSE endpoints, `/api/generate` and `/api/groups/:groupId/chats/:chatId/generate`;
- allows long-lived responses;
- preserves the `Host` header so the API's origin check continues to work.

## Data directory and permissions

- Default data root: `<repo>/data`.
- Use an absolute `CATCUP_DATA_DIR` in production.
- Run the server under a dedicated OS account with access only to the data directory and the built app.
- `data/secrets.json` contains API keys; `data/auth.json` contains the password hash and session secret. Protect the directory.
- Back up the entire directory before upgrades.

## Service management

### systemd (Linux)

```ini
[Unit]
Description=CatCup Tavern
After=network.target

[Service]
Type=simple
User=catcup
WorkingDirectory=/opt/catcup-tavern
Environment=NODE_ENV=production
Environment=CATCUP_HOST=127.0.0.1
Environment=CATCUP_PORT=8000
Environment=CATCUP_DATA_DIR=/var/lib/catcup-tavern
ExecStart=/usr/bin/node /opt/catcup-tavern/apps/server/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust paths, user and Node location. Keep `CATCUP_HOST=127.0.0.1` when a reverse proxy is in front.

### Windows

Use Task Scheduler or a service wrapper such as NSSM to run:

```powershell
node apps\server\dist\index.js
```

with `CATCUP_DATA_DIR` set to an absolute path. A service wrapper is only needed for the web/LAN shape on a server; on a desktop the installer carries its own Node runtime and writes to the OS app-data directory.

## Health checks

```bash
curl -fsS http://127.0.0.1:8000/api/health
```

Expected:

```json
{ "ok": true, "version": "0.2.1", "needsSetup": false }
```

A `needsSetup: true` response means no `data/auth.json` exists yet.

## Backup and restore

Stop the server before copying to avoid reading a chat mid-write.

Backup:

```bash
tar -czf catcup-backup-$(date +%Y%m%d).tgz data/
```

Restore:

```bash
tar -xzf catcup-backup-YYYYMMDD.tgz
```

The backup contains credentials (`secrets.json`, `auth.json`) and private chats. Store it like a password vault. Do not commit it to Git or attach it to issues.

## Upgrades

1. Back up `data/`.
2. Fetch the target branch and install dependencies.
3. Run quality gates and build.
4. Restart the server.
5. Check `/api/health` and open the UI.

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# restart the service
```

There are no automatic data migrations yet. Unknown fields are preserved, but back up first and read the release notes.

## Ports and firewall

- Default port: `8000`.
- If the port is occupied, set `CATCUP_PORT` or stop the conflicting process.
- In LAN mode, allow the port only from trusted devices.
- For a reverse proxy, expose only the proxy port publicly.

## Desktop

The Windows installer is built by CI when a merge into `main` carries a new version, and it is attached to that release. It needs no administrator and no separate Node installation: the shell starts a bundled server on an OS-chosen port and keeps its data in the OS app-data directory, separate from this guide's `data/`. Signing, an auto-updater and file associations are not there yet, so every upgrade is a manual download of the new installer. See [DESKTOP.md](DESKTOP.md).

## Related docs

- [Security](SECURITY.md)
- [API](API.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Development](DEVELOPMENT.md)
