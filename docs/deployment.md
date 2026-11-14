# boltbook — Deployment

One container, one volume, one port. The client and the API are served from the same process, so
there is nothing to co-ordinate.

Hostnames and ports in this document are **examples** (`boltbook.example.com`, `8080`). Put your
own in a local override that is not committed.

## Requirements

- Docker with Compose v2, on any host that can run a container (amd64 or arm64).
- A reverse proxy that terminates TLS, and somewhere to keep one directory of data.
- Nothing else. No database server, no cache, no message queue.

## Quick start

```sh
git clone https://github.com/therebelrobot/boltbook.git
cd boltbook
cp compose.yaml compose.override.yaml     # your hostnames and port go here
echo 'BOLTBOOK_SETUP_TOKEN=pick-something' >> .env
docker compose up -d
docker compose logs boltbook              # prints the setup token on first start
```

Open the URL, claim the instance with the setup token and a passphrase (12+ characters), then
**remove `BOLTBOOK_SETUP_TOKEN`** and `docker compose up -d` again. The token is only honoured
while no account exists; leaving it set is harmless but pointless, and removing it keeps a secret
out of your environment.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `BOLTBOOK_DATA_DIR` | `./data` | Where `boltbook.db` lives. In the image this is `/data`. |
| `BOLTBOOK_DB` | `<data dir>/boltbook.db` | The database file itself, if you want it elsewhere. |
| `BOLTBOOK_PORT` | `8080` | Listen port. |
| `BOLTBOOK_HOST` | `127.0.0.1` | Listen address. The image sets `0.0.0.0` so the port can be published. |
| `BOLTBOOK_COOKIE_SECURE` | `true` | Session cookie `Secure` flag. Keep `true` behind TLS; `false` is for local HTTP only. |
| `BOLTBOOK_TRUST_PROXY` | `false` | Take the client IP from `X-Forwarded-For` (set `true` behind a proxy). |
| `BOLTBOOK_PUBLIC_ORIGIN` | unset | The public URL. **Set it behind a proxy**: state-changing requests check `Origin` against it. |
| `BOLTBOOK_SESSION_IDLE_MINUTES` | `30` | Sign out after this much inactivity. |
| `BOLTBOOK_SESSION_MAX_HOURS` | `12` | Absolute session lifetime. |
| `BOLTBOOK_SETUP_TOKEN` | generated | Claims the instance once. Generated and logged if unset. |
| `BOLTBOOK_SCRYPT_N` | `131072` | Passphrase hashing cost. Only affects a *new* account. |

## Behind a proxy

The proxy terminates TLS and forwards to `127.0.0.1:8080`. Two things matter:

- `BOLTBOOK_PUBLIC_ORIGIN` must match the public URL **exactly** (scheme and host, no trailing
  slash). Every state-changing request is refused unless its `Origin` matches, which is what stops
  a cross-site form from writing to your stash.
- `BOLTBOOK_TRUST_PROXY=true`, so rate limiting sees the real client IP rather than the proxy's.

An access layer in front (an SSO gateway, an edge access layer, a client certificate) is worth
having even though boltbook has its own single-user sign-in: it keeps the login form itself off
the public internet. Two caveats when you add one:

- **The ACME/HTTP challenge must not be behind the access layer**, or certificate renewal fails —
  give the challenge path its own bypass application.
- A monitoring check needs either a bypass or a **service token**, or your uptime dashboard starts
  reporting the login page as up.

## Backing up

The database is the whole application state, and it is **plaintext** by design
([ADR 0001](adr/0001-no-encryption-at-rest.md)) — so a backup is a copy, not an export, and there
is no key to keep alongside it.

```sh
# From a checkout:
npm run backup -- ./backups

# From the container's volume:
docker compose exec boltbook node -e "process.exit(0)"   # (the image ships no scripts; use the volume)
```

The simplest durable answer is to copy the `${BOLTBOOK_DATA_DIR}` directory on a schedule, with
the container stopped or right after a `wal_checkpoint`. Keep the copy wherever you keep the
records themselves, and note that anyone with the file reads the whole stash.

There is also a portable export — **Settings → Export** or `GET /api/export` — which is a zip of
`boltbook.json` plus the photo files, with credentials excluded. Restoring it
(**Settings → Restore**, or `POST /api/import?mode=replace`) **replaces every record** on the
instance; it does not merge, and it never touches the account or this instance's own audit log. If
you want to be careful, take an export of the current state first — it is one click.

## Upgrading

```sh
docker compose pull
docker compose up -d
```

Migrations run on start, inside a transaction. They only ever add; a downgrade is not supported, so
take a backup before a jump across major versions.

## Without Docker

```sh
npm ci
npm run build
BOLTBOOK_SETUP_TOKEN=pick-something npm start
```

Node 26 LTS or newer (`.nvmrc` pins the exact patch). This is how the client is developed:
`npm run dev:server` and `npm run dev:client` in two terminals, with the Vite dev server
proxying `/api` to the running server.
