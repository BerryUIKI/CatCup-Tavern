# Security

This page describes the security model of the current single-user build, the protections that exist, and the known gaps that matter before exposing the app beyond a trusted LAN.

## Scope and assets

CatCup Tavern is a **single-user, local-first** application. The assets that matter are:

- the access password;
- the session cookie;
- provider API keys in `data/secrets.json`;
- characters, chats and world info in `data/`;
- the machine and network the server runs on.

There is no multi-tenant isolation. Anyone with a valid session has full access to every character, chat, provider and setting.

## Authentication

### Password storage

- Passwords are hashed with Node's `crypto.scrypt`.
- Parameters: `N=16384`, `r=8`, `p=1`, 64-byte key, random 16-byte salt.
- Stored format: `scrypt$N$r$p$salt$hash` (base64url), in `data/auth.json`.
- Verification uses `timingSafeEqual`.
- Minimum password length: 8 characters (server-enforced); UI also requires confirmation.
- The password is never stored or logged in plaintext.

### First-run setup

- `POST /api/auth/setup` is only accepted before `auth.json` exists.
- Requests from non-loopback addresses are rejected unless `CATCUP_ALLOW_REMOTE_SETUP=true`.
- Do not enable remote setup on an untrusted network: the first visitor could claim the instance.
- Setup is rate-limited to 5 attempts per minute.

### Sessions

- Cookie name: `catcup_session`.
- Value: base64url JSON payload `{ v: 1, exp }` plus an HMAC-SHA256 signature using `sessionSecret` from `auth.json`.
- Lifetime: 30 days.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `Secure` is set only when the Node process sees the request as HTTPS. There is no `trustProxy` configuration yet, so a TLS-terminating reverse proxy will not set the flag on the browser cookie.
- No server-side session store. A stolen cookie remains valid until it expires or the session secret changes. Deleting `auth.json` and restarting invalidates all sessions (and requires setting a new password).

### CSRF and origin checks

- Mutating API requests (`POST`, `PATCH`, `DELETE`) are rejected when an `Origin` header is present and its host does not match the request `Host`.
- Requests without an `Origin` header (curl, server-to-server) are allowed.
- There is no dedicated CSRF token. `SameSite=Lax` plus the origin check is the current mitigation. This is acceptable for a single-user LAN app but is on the hardening list.

### Rate limiting

- Login: 10 attempts per minute.
- Setup: 5 attempts per minute.
- Other endpoints are not rate-limited yet.

## API keys

- Stored only in `data/secrets.json` as provider-ID → key. It is written with mode `0600` on POSIX; Windows file ACLs apply instead.
- Never returned by any API response. The public provider shape exposes `hasKey` only.
- Fastify logs redact `authorization`, `cookie` and `x-api-key` headers.
- Provider adapter error messages are returned to the UI; they should not contain keys under normal provider behaviour.
- Keys are stored unencrypted at rest. Protect the OS account and backups.
- Rotate a key at the provider if it may have leaked; remove or replace it in Settings.

## Files and paths

- Character IDs and chat IDs are validated and resolved with `resolveInside()` to block path traversal.
- Display names are sanitized for filesystem use.
- Uploads: 20 MB per file, 50 files per request; `.png` and `.json` only.
- JSON/JSONL parsing does not execute code. `.charx` is not supported yet; do not assume archive contents are safe when support is added.
- Chat and settings writes are atomic and serialized per file.
- The static SPA is public; the API is protected. Do not serve the API without authentication.

## Network exposure

- Default bind: `127.0.0.1:8000`. This is the safest mode.
- LAN mode: `CATCUP_HOST=0.0.0.0`. Use a strong password and a trusted network.
- There is no built-in TLS. For anything beyond a trusted LAN, put the server behind a TLS reverse proxy or a VPN.
- Caveat: because `trustProxy` is not implemented, the session cookie will not receive the `Secure` flag behind a TLS-terminating proxy. Treat this as a known gap; keep the server on a trusted network until trust-proxy/TLS handling is added.
- Do not expose the server directly to the public internet.
- A firewall should allow only the intended LAN devices to reach the port.

## Privacy and data at rest

- No telemetry or analytics are sent anywhere.
- The only outbound requests are to the configured model provider (and, during development, package registries and the reference repositories).
- Chats, characters, provider settings and credentials are stored unencrypted in `data/`.
- `data/`, `.env`, `.ref/` and build output are gitignored. Never commit them or attach them to issues.
- Backups include credentials; store them accordingly.

## Known gaps and hardening backlog

| Gap                                  | Impact                                   | Plan                                 |
| ------------------------------------ | ---------------------------------------- | ------------------------------------ |
| No trust-proxy / TLS cookie handling | `Secure` not set behind a TLS proxy      | Security hardening in M5             |
| No CSRF token                        | SameSite + origin check only             | Evaluate in M5                       |
| API keys unencrypted at rest         | Local disk/backup exposure               | Evaluate OS keychain/encryption      |
| No session revocation per device     | A stolen cookie stays valid until expiry | Add session store/rotation if needed |
| No audit log                         | Harder to investigate incidents          | Optional later                       |
| Rate limits only on auth             | Abuse of generation endpoints            | Add provider/generation limits       |
| Single user                          | No per-user isolation                    | Explicitly out of scope for v1       |
| No CSP configuration                 | XSS impact is not further constrained    | Add headers in M5                    |
| No built-in TLS                      | LAN traffic is plaintext                 | Reverse proxy/VPN                    |

## Operational checklist

- [ ] Set a strong access password on the machine running the server.
- [ ] Keep the default `127.0.0.1` bind unless LAN access is needed.
- [ ] If LAN is needed, restrict the port with a firewall.
- [ ] Do not enable `CATCUP_ALLOW_REMOTE_SETUP` on an untrusted network.
- [ ] Protect `data/secrets.json` and backups.
- [ ] Rotate provider keys if a device or backup is lost.
- [ ] Delete `data/auth.json` and restart to force a new password if the password may be compromised.
- [ ] Keep Node and dependencies updated.
- [ ] Review the server logs after unexpected behaviour.

## Incident response

1. Stop the server (or disconnect it from the network).
2. Rotate the affected provider API key and update it in Settings.
3. If the password may be compromised, delete `data/auth.json` and restart; set a new password.
4. Inspect `data/` and logs for unexpected changes. Restore a known-good backup if needed.
5. Review the Git history and `NOTICE`/`REUSE.md` if code may have been tampered with.
6. Report a vulnerability privately if it is in CatCup Tavern itself.

## Reporting a vulnerability

Use GitHub's **private security advisory** feature for `BerryUIKI/CatCup-Tavern`. Do not open a public issue containing exploit details, credentials or private chat data. Include the affected version, reproduction steps and impact. If private reporting is unavailable, open a minimal public issue asking for a private contact channel without disclosing the vulnerability.

## Related docs

- [API](API.md)
- [Deployment](DEPLOYMENT.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Development](DEVELOPMENT.md)
