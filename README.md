# RetailNav

**RetailNav** is an indoor 3D wayfinding and mall-mapping prototype.

## Current demo: Aventura Mall

- Three distinct, **provisionally traced** levels: **LL**, **UL** and **L3**
- Interactive 3D viewer: rotate, tilt, pan, pinch-zoom and inspect floors together or individually
- Source-image comparison, search and selection of traced features
- Pure browser app with WebGL and Canvas fallback, no runtime CDN dependency
- Image-derived floor vectors, plus reproducible GLB export for native clients

**The maps are a mock.** They are traced from three user-supplied raster plans, not captured by LiDAR. Dimensions, shop assignments, building entrances and vertical/navigation links have not been physically verified. Do **not** use them to guide visitors around the real mall.

## Open the source

- [3D browser app](public/index.html) — self-contained browser HTML
- [Floor manifest](public/maps/manifest.json) — LL, UL and L3 URLs
- [Vector floor files](public/maps/) — geometric features and navigable-grid samples
- [Editable viewer](src/viewer.js) and [HTML template](src/page.template.html)
- [Build scripts](scripts/) — regenerate the HTML and produce GLB models
- [Safe Contabo deployment instructions](deploy/README.md)

To serve locally:

```bash
python3 -m http.server 8080 --directory public
# Open http://localhost:8080 in a browser
```

To rebuild/edit:

```bash
python3 scripts/build-web.py
python3 scripts/verify.py public
python3 scripts/build-glb.py public
python3 scripts/verify.py public
```

No pip packages, npm install or CDN are required for these commands.

## Release packaging

[GitHub Actions → Verify and package RetailNav](../../actions) assembles the standalone viewer and four GLB files (three individual models and one combined), checks the geometry, and publishes a downloadable **RetailNav-Aventura-static-site** workflow artifact.

GLB assets are generated from the compact vector files rather than manually attached to the repository. Individual models remain floor-addressable, and the combined model preserves floor groups.


## Live browser preview (one-time GitHub Pages activation)

The repository has a `Preview RetailNav (GitHub Pages)` workflow. To obtain a public Safari URL, the repository owner must open **Settings → Pages**, choose **Build and deployment: GitHub Actions**, and save. The workflow cannot enable Pages itself with the default GitHub Actions token. After enabling, rerun the Pages workflow from **Actions**. The expected preview URL, *only after a successful deployment*, is `https://romancanoniero.github.io/retailnav/`.

## Intended Contabo installation

`https://improvingyourreality.com/retailnav/`

**Not deployed or verified on Contabo yet.** The user’s production server may use a container reverse proxy rather than a standard document root. Confirm how the site is served before installing anything. The installer must only write the `retailnav/` subtree and leave all other applications untouched.

After the site’s actual static document root is identified, see [deploy/README.md](deploy/README.md).

## Validation required before production

Real-world scale calibration, geometric alignment, tenant/door metadata, connectivity across floors, accessibility, fire exits, map provenance/rights, physical on-site QA and iPhone Safari testing are still needed.

Former exploratory repo `romancanoniero/MallMasters` remains unchanged.
