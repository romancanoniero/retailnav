# RetailNav

**RetailNav** is an indoor spatial-navigation prototype. The current reference case is **Aventura Mall, Miami**.

## Status

The three source images supplied by the project owner have been provisionally vectorized as levels **LL**, **UL** and **L3**. The vectorization, 3D export, and mobile-browser demo are **mock/provisional**: they are not a LiDAR capture and cannot be used for physical wayfinding. Store boundaries, shop identifiers, vertical connections, dimensions and navigation routes require validation.

The original self-contained demo and complete dataset currently exist as a ZIP release artifact in the project conversation. This repository is being provisioned as the **source of truth for subsequent deployments**. Do not assume this repository has a deployable demo until its `public/index.html`, map assets and smoke tests are committed.

## Planned repository layout

- `public/` — static RetailNav browser client, images, floor maps and optimized GLB files
- `src/` — viewer source and vectorization utilities
- `docs/` — QA, provenance and mapping conventions
- `deploy/` — non-destructive installation into the existing improvingyourreality.com host
- `.github/workflows/` — packaging and optional approved deployment

## Deployment target

`https://improvingyourreality.com/retailnav/`

The VPS (Contabo) deployment is **not active**. The server's existing document root / reverse proxy must be inspected before any write. The deployment should update **only** the `retailnav` directory and must never modify unrelated applications.

Use [deploy/README.md](deploy/README.md) to configure a safe path and deployment credentials. **Do not commit passwords, SSH private keys or token values**.

## Project guarantees

1. Geometries on distinct floors are not copies of one another.
2. A visitor can orbit, pan, pinch-zoom and isolate levels.
3. A loading error must show a clear message rather than remain on "initializing".
4. Navigation in a physical shopping mall remains disabled until maps are calibrated and validated.

Copyright and floorplan-source provenance must be reviewed before commercial publication.

Previous project repo: `romancanoniero/MallMasters` (preserved; not automatically migrated).
