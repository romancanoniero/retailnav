# RetailNav administration workspace

This directory is a new, deliberately isolated administrative backend. It does not alter `backend/server.mjs` visitor identities or existing mall bundles.

## Routes and future domain move

The gateway should map `/retailnav/admin-api/*` to port 3182, stripping that prefix. Future domain `api.retailnav.com` changes only reverse proxy, allowed origins and `RETAILNAV_ADMIN_COOKIE_PATH=/`.

Deploy separate frontends at `/retailnav/control/`, `/retailnav/mall-manager/`, `/retailnav/merchant/`, `/retailnav/map-studio/`. Do not route these paths to the visitor SPA or expose the private admin JSON directory.

## Security/bootstrap

Environment: `RETAILNAV_ADMIN_DATA_DIR` (persistent, private volume), `RETAILNAV_MALLS_DIR` (read-only copy of repository `data/malls`), `RETAILNAV_ADMIN_OWNER_EMAIL`, `RETAILNAV_ADMIN_OWNER_PASSWORD` (14+ characters), `RETAILNAV_ADMIN_OWNER_TOTP` (base32 authenticator seed), `RETAILNAV_ADMIN_ALLOWED_ORIGINS`, `RETAILNAV_ADMIN_COOKIE_PATH`, `RETAILNAV_ADMIN_PORT`. Bootstrap only occurs on an empty state store; never commit credentials, seeds, tokens or state. After login use CSRF returned from `/v1/auth/login` in `X-Retailnav-Csrf` on every write; cookie is HttpOnly Secure SameSite Strict. Owner must assign each imported mall to a tenant before mall-admin roles can access it.

For production use TLS gateway plus volume backups. This initial filesystem store assumes a single writer process and **is not production-ready multi-node**. Migrate transactionally to PostgreSQL before running concurrent replicas. Tenant-specific member invitations, password recovery, billing provider, upload sandboxing, public-bundle materialization and comprehensive e2e/browser checks still require dedicated work. Never call an editorial overlay publication a visitor deployment.

## API basics

- `POST /v1/auth/login` with email/password/totp, `GET /v1/auth/me`, `POST /v1/auth/logout`.
- `GET/POST /v1/tenants`, `GET /v1/malls`, `POST /v1/malls/:id/assign`, `POST /v1/users`, `DELETE /v1/users/:id`.
- `GET /v1/malls/:id/map`: floor metadata with original photo reference.
- `GET /v1/malls/:id/source/:floor`: existing compressed geometry decoded to 2D vertices in source coordinates. Source is read-only.
- `POST/GET /v1/malls/:id/revisions`, `GET/PUT /v1/malls/:id/revisions/:rev`, `POST /v1/malls/:id/revisions/:rev/{validate,submit,approve,reject,publish}`.
- `GET /v1/malls/:id/published`, `POST /v1/malls/:id/rollback`, `GET /v1/malls/:id/audit`.

`PUT` requires exact `If-Match: "<version>"`. Two-person approval prevents author self-publication. Base vectors, source photographs, visitor routes, directory and prior public geometry are never rewritten by administrative overlay writes.

## Map Studio document

```json
{"features":[{"id":"recovered-space-1","floor":"PB","kind":"unit","source":"manual","evidence":"review of original source","vertices":[[100,120],[170,120],[170,180],[100,180]]}],"connectors":[{"id":"lift-a","kind":"lift","verification":"unverified","evidence":"photo review only","landings":[{"floor":"PB","x":120,"y":150},{"floor":"P1","x":131,"y":160}]}],"transforms":[{"floor":"P1","matrix":[1,0,0,0,1,0,0,0,1],"controlPoints":[[100,200],[300,250]]}],"occupancies":[{"spaceId":"recovered-space-1","merchantId":null,"code":null}]}
```

All editorial features must carry evidence and source floor coordinates. Vertical landings are separate per floor. Do not automatically set `navigable=true`; field-reviewed corridors, doors and connectors require an independent validation gate. Missing stores should not be filled by generated rectangles or guessed merchant names.

## Expected source-specific QA

Respect `AGENTS.md`, `docs/IMPORT-MALLS.md` and `docs/STORE-SEARCH-POSITIONING-E2E.md`. In particular, Del Parque currently has 8 unresolved candidates, no approved metro scale, no approved connectors and no official directory. Keep these recorded limitations visible. Implement a dual-reader/build adapter and verify on 2D original overlays and browser 3D before publishing edits to visitor bundles.
