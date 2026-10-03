# Hostinger Production Deployment (phase 9)

Deploying the Docker stack on a Hostinger VPS and moving DNS/HTTPS to it. The stack itself
and its per-step commands are in `docs/PRODUCTION-DEPLOYMENT.md`; this document adds the
Hostinger layer, the DNS cutover and the gate that must pass **before** the domain is moved.

> **Status: the stack is validated, the server deployment is not.**
>
> The whole runtime gate (section 7, checks 1–16) was executed on **2026-10-03 on a local
> Docker host** and passed: image build, migrations, the schema on real PostgreSQL 18.6, the
> 12 integration tests including truly parallel bookings, routing through Caddy, upload and
> database persistence, the backup job with retention, and the **restore rehearsal**. This
> resolves the blocker from phase 8.
>
> Still **NOT RUN**, because they need the server and the domain: everything on the
> Hostinger VPS itself (sections 1–4), the DNS cutover (section 8), the public Let's Encrypt
> certificate (section 9, validated locally with Caddy's internal CA) and the Auth0 browser
> login (section 11). **No DNS record has been changed.**

## 0. What this phase needs that the repository cannot provide

| Needed                              | Why                                                  | Who           |
| ----------------------------------- | ---------------------------------------------------- | ------------- |
| A Hostinger **VPS** with SSH access | Docker only runs on a VPS, not on shared/web hosting | account owner |
| hPanel access to the VPS firewall   | Close everything except 22/80/443                    | account owner |
| hPanel/DNS access for the domain    | A/CNAME records for the cutover                      | account owner |
| Auth0 Dashboard access              | Add the production callback/logout/origin URLs       | tenant admin  |

Until those exist, deployment cannot start. The sections below are the runbook to execute
once they do.

## 1. Required environment

Hostinger's **Docker VPS template** is the match: Ubuntu 24.04 with `docker-ce` and
`docker-compose` pre-installed, SSH as `root` on port 22
([Hostinger: Docker VPS template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/)).
A plain Ubuntu 24.04 LTS VPS works too; then install Docker as in
`docs/PRODUCTION-DEPLOYMENT.md` step 2.

**Shared / web hosting cannot run this stack.** Docker is a VPS-only feature at Hostinger,
and shared hosting gives no root, no systemd and no control over ports 80/443. If the only
available plan is shared hosting (its SSH runs on port **65002**, a recognisable sign), the
deployment stops here and a VPS is required.

Minimum sizing (from `docs/PRODUCTION-DEPLOYMENT.md` step 1): 2 vCPU, 2 GB RAM, 20 GB disk.
The web image is built on the server, which is the most memory-hungry step; on a 1 GB plan,
build the images elsewhere or add swap.

### Inventory to record before changing anything

Fill this in from hPanel and from the server; keep it with the deployment notes.

| Item                        | Value                       | How to check                                 |
| --------------------------- | --------------------------- | -------------------------------------------- |
| Plan / VPS type             |                             | hPanel → VPS                                 |
| OS                          |                             | `cat /etc/os-release`                        |
| Public IPv4                 |                             | hPanel → VPS, or `curl -4 -s ifconfig.me`    |
| IPv6 (if any)               |                             | `ip -6 addr`, `curl -6 -s ifconfig.me`       |
| SSH access                  | user, port, key or password | `ssh -p <port> <user>@<ip>`                  |
| root/sudo                   |                             | `id`, `sudo -v`                              |
| Disk free                   |                             | `df -h /`                                    |
| RAM / CPU                   |                             | `free -h`, `nproc`                           |
| Docker                      | version or absent           | `docker --version`, `docker compose version` |
| Already listening on 80/443 |                             | `sudo ss -tulpn \| grep -E ':(80\|443)\b'`   |
| Firewall                    | hPanel rules + `ufw status` | hPanel → VPS → Security → Firewall           |

If something else already serves 80/443 (an existing site, nginx, Apache, Portainer,
another Compose stack), decide **before** starting whether it is stopped or moved. Caddy
needs both ports; two services cannot share them.

## 2. Server hardening

Do this before the stack is reachable. Keep the SSH session open while changing SSH, so a
mistake does not lock you out, and test a second session before closing the first.

```sh
# 1. Current security updates
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades

# 2. A non-root user with sudo and Docker access
sudo adduser deploy
sudo usermod -aG sudo,docker deploy

# 3. SSH key instead of a password (run on YOUR machine)
ssh-keygen -t ed25519 -C "autowascenter-deploy"
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@<SERVER_IP>
ssh deploy@<SERVER_IP> 'echo key-login-works'   # must succeed before the next step
```

Only after key login works, in `/etc/ssh/sshd_config.d/99-hardening.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```sh
sudo sshd -t && sudo systemctl reload ssh     # -t validates before reloading
```

Hostinger's panel may offer a browser console as a fallback if SSH ever locks up; check
that it works before disabling password login.

## 3. Firewall: only 22, 80 and 443

Two layers; configure both, because either one alone can leave a port open.

**hPanel** (VPS dashboard → Security → Firewall): create a configuration, add rules for
22/tcp, 80/tcp and 443/tcp (and 443/udp for HTTP/3), then **Activate** it
([Hostinger: VPS firewall](https://www.hostinger.com/support/5726606-how-to-use-the-vps-dashboard-in-hostinger/)).

**On the server** (defence in depth):

```sh
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

**Important with Docker:** published container ports bypass `ufw` because Docker writes its
own iptables rules. That is exactly why `deploy/docker-compose.yml` publishes **only**
Caddy's 80/443 and gives PostgreSQL, the API and the web app no host port at all. Never add
a `ports:` entry "for debugging"; use `docker compose exec` instead.

Verify from **outside** the server (another machine, not the VPS):

```sh
for p in 22 80 443 3000 3001 5432; do
  nc -z -w3 <SERVER_IP> $p && echo "$p OPEN" || echo "$p closed"
done
```

Expected: 22, 80, 443 open; **3000, 3001 and 5432 closed**. If 5432 answers, stop and fix
the firewall before continuing.

## 4. Repository and secrets

`docs/PRODUCTION-DEPLOYMENT.md` steps 3–4, with `/opt/autowascenter` as the location:

```sh
sudo mkdir -p /opt && sudo chown deploy /opt
cd /opt && git clone <repository-url> autowascenter
cd autowascenter && git checkout migration/self-hosted
git log -1 --oneline            # expect the phase-8 commit or newer
cd deploy && cp .env.example .env && chmod 600 .env
openssl rand -base64 32         # POSTGRES_PASSWORD
$EDITOR .env
```

Checks that the secrets stay where they belong:

```sh
git check-ignore -v deploy/.env            # must be ignored
ls -l deploy/.env                          # -rw------- , owned by deploy
grep -rn "POSTGRES_PASSWORD\|DATABASE_URL" deploy/docker/*.Dockerfile   # expect nothing
docker compose --env-file .env config | grep -A12 "^  web:" | grep -iE "password|database_url"
# expect nothing: the web service gets only VITE_* build args
```

## 5. Domain consistency

The canonical domain is the bare domain (`www` redirects to it). One value drives
everything: `DOMAIN` in `deploy/.env`.

| Setting                      | Value                                            | Where                           |
| ---------------------------- | ------------------------------------------------ | ------------------------------- |
| `DOMAIN`                     | `autowascenter.be`                               | `deploy/.env`                   |
| `CORS_ORIGIN`                | empty → `https://$DOMAIN`                        | derived in `docker-compose.yml` |
| `PUBLIC_UPLOAD_URL`          | empty → `https://$DOMAIN/uploads`                | derived in `docker-compose.yml` |
| Caddy site address           | `{$DOMAIN}` + `www.{$DOMAIN}`                    | `deploy/Caddyfile`              |
| `VITE_API_BASE_URL`          | **empty** (same origin)                          | `deploy/.env`                   |
| Auth0 callback/logout/origin | `https://$DOMAIN/admin-login`, `https://$DOMAIN` | Auth0 Dashboard                 |

One pre-existing place in the source carries the domain: `src/lib/site.ts` (`SITE.domain`,
used for the address/phone block and for the absolute `og:image` URL). It already says
`autowascenter.be`. **Check that `SITE.domain` matches `DOMAIN`**, otherwise the social
preview image points at a host that does not serve it:

```sh
grep -n "domain:" src/lib/site.ts
grep -n "^DOMAIN=" deploy/.env
```

`PUBLIC_UPLOAD_URL` is stored _inside_ `gallery_items.image_url` for every new upload.
Changing the domain later means those rows keep the old URL, so set it correctly before
uploading production images.

## 6. DNS: record the current state first

Open hPanel → Domains → DNS / Nameservers for the domain and **write down every existing
record** before touching anything:

| Type                     | Name    | Current value | Keep / change / remove                          |
| ------------------------ | ------- | ------------- | ----------------------------------------------- |
| A                        | @       |               | change to the VPS IPv4                          |
| A                        | www     |               | replace with a CNAME, or point at the same IPv4 |
| AAAA                     | @ / www |               | see the IPv6 note below                         |
| CNAME                    | …       |               | check for conflicts with @ and www              |
| MX, TXT (SPF/DKIM/DMARC) |         |               | **keep**: these are e-mail, not the website     |
| CAA                      |         |               | keep; if present it must allow Let's Encrypt    |

Do not remove records blindly. In particular:

- **MX/TXT records stay.** Moving the website must not break e-mail.
- **A CNAME on `@` is not allowed** next to other records; the apex needs an `A` record.
- **CAA**: if a `CAA` record exists, it must include `letsencrypt.org`, otherwise Caddy
  cannot issue a certificate.
- **An existing CDN/proxy** (Cloudflare orange cloud or a Hostinger redirect/parking page)
  intercepts traffic and breaks the ACME challenge. Disable it for the cutover.

### Target records

```
@      A      <SERVER_IPV4>
www    CNAME  autowascenter.be.
```

(`www` as a CNAME to the apex keeps one source of truth; an `A` record with the same IPv4
is equally valid if the DNS editor prefers it.)

**IPv6:** only add an `AAAA` record if the VPS really answers on IPv6 **and** the stack is
reachable over it. A stale `AAAA` sends dual-stack visitors to an unreachable address and
can break the ACME challenge. Check first:

```sh
curl -6 -s https://ifconfig.co && echo "IPv6 works"    # on the server
```

If in doubt: no `AAAA` record. IPv4-only is a working configuration.

Set the TTL low (300 s) a day before the cutover so a rollback propagates quickly.

## 7. Validation **before** the DNS cutover

This is the gate. Every line must be a real, observed pass — not a static check.

| #   | Check                                          | How it was validated                                                                                            | Status  |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Image build                                    | `docker compose build` (all three images)                                                                       | PASS    |
| 2   | No secret in the web image                     | no `.env`, no sources; the database password occurs 0× in the whole `.output`                                   | PASS    |
| 3   | PostgreSQL healthy                             | `pg_isready` healthcheck green in ~6 s; `PGDATA` proven to be in the volume                                     | PASS    |
| 4   | Migrations                                     | `docker compose run --rm api node src/scripts/migrate.ts`                                                       | PASS    |
| 5   | Schema objects                                 | 10 tables, `btree_gist`, the enum, 8 triggers, 25 indexes, exclusion constraint                                 | PASS    |
| 6   | Real-PostgreSQL integration tests              | 12/12 on PostgreSQL 18.6 (migration path, schema, FK actions)                                                   | PASS    |
| 7   | Concurrency                                    | 2 parallel → 1×201 + 1×409; 10 parallel → 1 booking + 9×409; 3 slots → 3×201                                    | PASS    |
| 8   | Rollback / transactions                        | 5 forced mid-transaction failures, nothing partial                                                              | PASS    |
| 9   | Whole stack healthy                            | postgres/api/web/caddy healthy, backup running, no restart loops                                                | PASS    |
| 10  | API readiness                                  | `/health/db` → 200                                                                                              | PASS    |
| 11  | Routing through Caddy                          | 7 public pages 200, 5 API endpoints 200, admin → 401, HTTP→HTTPS 308, www → 301                                 | PASS    |
| 12  | Upload persistence                             | file served through Caddy with its headers; survived `--force-recreate` and `down`/`up`                         | PASS    |
| 13  | Database persistence                           | `docker compose down` (no `-v`) → `up`: all rows still present                                                  | PASS    |
| 14  | Backup job                                     | UTC-stamped `.sql.gz`, no `.part` leftovers, retention removed a 20-day-old dump                                | PASS    |
| 15  | **Restore rehearsal**                          | restored into a temporary database: row counts identical, schema complete, exclusion constraint still enforcing | PASS    |
| 16  | Server-authoritative pricing                   | a client-supplied `total_price` → 400; the server computed 225,00 / 300 min / pickup 15:00                      | PASS    |
| 17  | Hostinger VPS, hardening, firewall             | needs the server                                                                                                | NOT RUN |
| 18  | DNS cutover + public Let's Encrypt certificate | needs DNS; validated locally with Caddy's internal CA                                                           | NOT RUN |
| 19  | Auth0 browser login + admin UI smoke test      | needs the real domain and tenant access                                                                         | NOT RUN |
| 20  | Authenticated gallery upload through the UI    | needs an Auth0 token; the endpoint itself answers 401 without one                                               | NOT RUN |

Checks 1–16 were executed on 2026-10-03 on a local Docker host (Docker 29.8.1, Compose
v5.5.1, `DOMAIN=localhost`, Caddy's internal CA) against the **unchanged** stack from
`deploy/`. Repeat them on the Hostinger VPS: the same commands, and they are the acceptance
test there.

Two real defects surfaced and were fixed:

1. **The API image did not start** (`ERR_MODULE_NOT_FOUND: Cannot find package 'zod'
imported from /repo/packages/shared/src/booking.ts`). `@autowascenter/shared` is a
   `file:` dependency, so Node resolves its imports from the link's real path, which never
   reaches `apps/api/node_modules`. `deploy/docker/api.Dockerfile` now installs
   `packages/shared`'s own dependencies. The same gap existed in the **development**
   instructions (it only worked because `packages/shared/node_modules` happened to exist
   locally), so `apps/api/README.md` and `docs/SELF-HOSTED-ARCHITECTURE.md` now mention it.
2. Two commands in `docs/BACKUP-RESTORE.md` could not work as written: `$POSTGRES_USER`
   is not in the shell (Compose only uses `deploy/.env` for its own interpolation), and
   PostgreSQL 18 writes a `\unrestrict` line after the dump's end marker, so the
   documented `tail -3` check missed it. Both are corrected.

**Testing before DNS exists.** The real domain cannot get a certificate yet (ACME HTTP-01
needs public DNS pointing at the server), so validate with `DOMAIN=localhost` in
`deploy/.env` and reach it through an SSH tunnel from your own machine:

```sh
ssh -L 8443:127.0.0.1:443 deploy@<SERVER_IP>
# then locally, Caddy's internal CA serves "localhost":
curl -k https://localhost:8443/
curl -k https://localhost:8443/api/services
curl -k -o /dev/null -w "%{http_code}\n" https://localhost:8443/api/admin/bookings   # expect 401
```

The browser-based Auth0 flow is the one part that needs the real domain (the callback URL
must match), so it is verified **after** the cutover, in section 10. Configure Auth0 before
the cutover so it works immediately.

After validating with `DOMAIN=localhost`, set `DOMAIN` to the real domain, then
`docker compose build web` (the `VITE_*` values are compiled in) and `docker compose up -d`.

## 8. DNS cutover

Only when section 7 is fully passed.

1. In hPanel, set `@` to the VPS IPv4 and `www` to the CNAME (section 6).
2. Verify resolution from **outside**, not on the server:

```sh
dig +short autowascenter.be A
dig +short www.autowascenter.be
dig +short @1.1.1.1 autowascenter.be A        # a second resolver
```

3. Wait until the authoritative answer is the new IP everywhere you check. Do not rely on a
   propagation website alone; test with at least two resolvers.
4. Watch Caddy obtain the certificate:

```sh
docker compose logs -f caddy | grep -iE "certificate|obtain|error"
```

Expected: `certificate obtained successfully`. On failure, the usual causes are port 80
blocked, DNS not yet pointing at the server, a CAA record, or a proxy in front.

## 9. HTTPS verification

```sh
curl -sSI http://autowascenter.be | head -3                 # 301/308 → https
curl -sSI https://autowascenter.be | head -3                # 200
curl -sSI https://www.autowascenter.be | head -5            # 301 → https://autowascenter.be
echo | openssl s_client -connect autowascenter.be:443 -servername autowascenter.be 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
curl -sSI --http2 https://autowascenter.be | head -1        # HTTP/2
curl -sSI --http3 https://autowascenter.be | head -1        # HTTP/3, if curl supports it
```

Expected: HTTP redirects to HTTPS, a valid Let's Encrypt certificate for the bare domain,
`www` redirecting to the bare domain. HTTP/3 is nice to have, not a blocker.

Routing:

```sh
for p in / /diensten /galerij /reservatie /contact /over-ons /admin-login; do
  printf "%-14s %s\n" "$p" "$(curl -sS -o /dev/null -w '%{http_code}' https://autowascenter.be$p)"
done
for p in /api/services /api/gallery /api/reviews /api/vehicle-types /api/site-settings; do
  printf "%-22s %s\n" "$p" "$(curl -sS -o /dev/null -w '%{http_code}' https://autowascenter.be$p)"
done
curl -sS -o /dev/null -w "%{http_code}\n" https://autowascenter.be/api/admin/bookings   # 401
```

## 10. HSTS — only afterwards

`deploy/Caddyfile` has the `Strict-Transport-Security` header commented out. Enable it only
when, over at least a few days:

- HTTPS is stable on the bare domain,
- the HTTP→HTTPS redirect works,
- `www` → bare domain works,
- `caddy_data` persists (a `docker compose down`/`up` does **not** request a new
  certificate), proving renewals will keep working.

HSTS tells browsers to refuse plain HTTP for `max-age`, which cannot be undone quickly for
visitors who already received the header. Enable it, then `docker compose restart caddy`.

## 11. Production smoke test

**Public:** home, diensten, galerij, reviews on the home page, reservatie (complete a real
booking), contact. In the browser's network tab: every API request goes to
`https://autowascenter.be/api/...`; there is no request to `localhost`, to a port, to the
server IP or to `supabase.co`.

**Admin:** `/admin` → Auth0 login → dashboard, agenda, reservaties (the booking just made is
visible), diensten, voertuigen, blokkades, instellingen, galerij (upload and delete an
image), logout. After logout, `/admin` asks for login again.

**Security:**

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://autowascenter.be/api/admin/bookings      # 401
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer invalid" \
  https://autowascenter.be/api/admin/bookings                                              # 401
nc -z -w3 <SERVER_IP> 5432 && echo "PROBLEM: database public" || echo "database not public"
nc -z -w3 <SERVER_IP> 3001 && echo "PROBLEM: api public" || echo "api not public"
curl -sS https://autowascenter.be/assets/*.js 2>/dev/null | grep -ciE "postgres|password|client_secret"
# expect 0
curl -sS https://autowascenter.be/api/admin/bookings | head -c 200   # an error body, no stack trace
```

An account without the `admin:access` permission must get 403 on the admin API (test with a
second Auth0 user).

## 12. Operations quick reference

Run from `/opt/autowascenter/deploy`.

```sh
docker compose ps                      # state + health of every container
docker compose logs -f api             # follow one service
docker compose logs --since 1h         # recent, all services
docker compose restart api             # restart one service
docker compose up -d                   # apply changed config/images
docker compose stop                    # stop, keep data

df -h /                                # disk on the host
docker system df                       # space used by images/volumes/build cache
docker compose exec backup ls -lh /backups          # the dumps
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"
```

| Question                   | Answer                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| Where are the backups?     | `backup_data` volume, `/backups` inside the backup container, `*.sql.gz` |
| How do I see logs?         | `docker compose logs` (stdout/stderr, rotated at 10 MB × 5)              |
| How do I check disk?       | `df -h /` and `docker system df`                                         |
| How do I check health?     | `docker compose ps` (health column), `/health/db` for the API            |
| How do I roll back?        | section 13 and `docs/PRODUCTION-DEPLOYMENT.md` 17                        |
| How do I restore a backup? | `docs/BACKUP-RESTORE.md`                                                 |

Routine intervals are in `docs/PRODUCTION-DEPLOYMENT.md` (_Routine checks_).

## 13. Rollback

```
current version → deploy new commit → health check → failure
                                                        ↓
                                   stop the new version, restore the previous commit/image
```

```sh
cd /opt/autowascenter
git log --oneline -5
git checkout <previous-commit>
cd deploy && docker compose build && docker compose up -d
docker compose ps                      # healthy again?
```

Never `docker compose down -v`: that deletes the database and the uploads. A rollback stops
and recreates containers, it never removes volumes.

**With a database schema change**, a code rollback alone is not enough:

- Drizzle migrations have no down migrations.
- Backwards-compatible changes (new nullable column, new table): the old code ignores them,
  so a code rollback is sufficient.
- Breaking changes (dropped/renamed column, new NOT NULL): restore the backup taken
  immediately before the migration (`docs/BACKUP-RESTORE.md` step 5) and accept the loss of
  everything written after it. So: **always back up right before a breaking migration** and
  keep the window short.
- Uploaded files are not versioned; restoring the uploads volume replaces all of it.

## 14. One-time versus per deployment

| Step                                                  | One-time                 | Every deployment                |
| ----------------------------------------------------- | ------------------------ | ------------------------------- |
| VPS, OS, hardening, SSH keys, firewall (sections 1–3) | ✔                        |                                 |
| Install Docker                                        | ✔                        |                                 |
| Clone the repository                                  | ✔                        |                                 |
| `deploy/.env` with the secrets                        | ✔                        | only when a value changes       |
| Auth0 production URLs                                 | ✔                        |                                 |
| DNS records + first certificate (sections 6, 8, 9)    | ✔                        |                                 |
| Enable HSTS (section 10)                              | ✔ (once HTTPS is proven) |                                 |
| Restore rehearsal                                     | ✔ (and periodically)     |                                 |
| `git pull`                                            |                          | ✔                               |
| `docker compose build`                                |                          | ✔                               |
| Review migrations, back up, `migrate.ts`              |                          | ✔ when there are new migrations |
| `docker compose up -d`                                |                          | ✔                               |
| `docker compose ps` + smoke test                      |                          | ✔                               |

`docker compose build web` is also needed whenever a `VITE_*` value changes: those are
compiled into the browser bundle.

## Sources

- [Hostinger: how to use the Docker VPS template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/)
- [Hostinger: how to use the VPS dashboard (firewall)](https://www.hostinger.com/support/5726606-how-to-use-the-vps-dashboard-in-hostinger/)
- [Hostinger: configure the Ubuntu firewall with UFW](https://www.hostinger.com/tutorials/how-to-configure-firewall-on-ubuntu-using-ufw/)
