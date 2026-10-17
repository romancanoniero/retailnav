# RetailNav repository instructions

## Mandatory preflight for every mall import or map migration

Before changing, importing, rebuilding, reviewing, or deploying any mall map:

1. Read `docs/RETAILNAV-PLAN-MAESTRO-E2E.md`, especially section 0 and MAP-01 through MAP-17.
2. Read `docs/IMPORT-MALLS.md` completely and follow its source-specific workflow.
3. Read `docs/STORE-SEARCH-POSITIONING-E2E.md` before linking directory records, codes, markers, entrances, or polygons.
4. Inspect every source asset before writing an importer. Prefer native vector geometry over raster extraction. Never replace available source contours with synthetic slabs, bounding boxes, or placeholder rooms.
5. Complete the mandatory 2D source overlay for every floor before building or deploying 3D geometry. The overlay must show the source plan, every extracted contour, and the real printed code or official marker position.
6. Never link a store to a polygon by nearest distance. Link only when the source supplies the polygon identity, or when the reviewed point is contained unambiguously in exactly one source contour. Preserve all unmatched records without inventing geometry.
7. Add mall-specific regression checks that reject placeholder geometry, assert source hashes and meaningful per-floor contour counts, verify code/polygon evidence, and exercise the mall in a real browser.
8. Do not deploy until the map is visually inspected in the same 2D and 3D states a visitor will see. Record the migration, tests, limitations, commit, and deployment in the master document.
9. Inventory the mall mark, every published store logo, official CSS palette and font family before building. Archive original bytes, source URL, MIME, dimensions, SHA-256 and license/status. Never invent a missing logo or redistribute a proprietary font without rights.
10. Import the complete official directory, not only names and positions. For every published store record, inventory and preserve every field the source exposes: store code, floor, name, original category, normalized tags and supported concepts, official logo and its source/status, description, phone, website/social links, hours, services/accessibility, marker/coordinates, polygon-link evidence and source provenance. A source field may be empty only when the official source does not publish it or the asset is demonstrably broken; record that reason explicitly. Never silently discard an available field and never invent a replacement.
11. Produce a mall-specific completeness report before publication. For each official field it must state `published`, `imported`, `missing`, `invalid` and the affected record IDs. Publication must fail when `missing > 0` for data the official source supplies, when any published category yields blank `tags`, when an available logo was not archived, or when a missing/invalid value lacks an explicit reason and source evidence.
12. Build roof labels from true font outlines, triangulated and extruded as vector geometry. Raster masks, pixel blocks, bitmap upscaling and texture-only 3D lettering are forbidden for a mall with an approved vector-font bundle.

These steps are release requirements. A successful file build or catalog count is not proof that a mall map is complete.
