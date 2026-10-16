# Aventura: source geometry and tablet selection

Reviewed 2026-10-16. PR #47 is open and was not merged: its embedded RoveIQ application is excluded. Only the directory source IDs/floor labels are carried forward. No revert is needed on main.

## Evidence and coordinate contract

The official Joe & The Juice page https://aventuramall.com/dining/joe-the-juice/ links to venue 107, location 20680. Its public viewer loads `https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/map.json` and `locations.json`. The checked-in snapshot `data/official-maps/aventura.json` records the capture date and SHA-256 of both complete source responses, and retains only geometry, identity, circulation and connector fields used here.

Source floor IDs 361/362/363 map explicitly to LL/UL/L3. The snapshot contains 607 structure features, 413 location records, 1,224 circulation segments and 17 floor connectors. This is source evidence, not an independent physical survey.

`scripts/source_map.py` attaches `sourceGeometry` to a directory store only when one official location matches by its recorded ID and normalized name, or a unique exact normalized name where no ID was recorded. The source polygon's `loc_id` AND the location's `suite_ids` must agree. The binding retains mall ID, store ID, source coordinate space, source snapshot hash, floor ID, source floor ID, dataset ID and polygon ID. Conflicts and ambiguous names remain unplaced. A current snapshot joins 294 directory shops, including 11 of 15 Coffee entries. Eataly, Nordstrom eBar, Sens Coffee and the generic Starbucks entry have no qualified polygon association. No nearest-room or fuzzy name fallback is used.

The photographic catalog's `x/y/polygonId` remains unchanged and separate. Official longitude/latitude is projected consistently to a local display plane in the native renderer; it is never projected into uncalibrated photo pixels. No iframe or runtime third-party map application is used. Source data is packaged with the app, so a selection does not fetch vendor maps.

## Interaction

Selecting a directory shop opens RetailNav's native SVG vector view with source polygons. Same-floor camera state persists across choices, with an 860 ms rotation/zoom transition derived from the selected polygon's longest edge and bounds. Reduced-motion users receive immediate focus. Pan, pinch, zoom and whole-floor controls are local. The photographic 3D model remains available through its explicit return control.

The destination and a different visitor reference floor appear in separate labeled panes, preventing an upper opaque slab from hiding the destination. A fallback floor is explicitly provisional. User-indicated floor changes update the panes. Existing visitor x/y positions, demo friends and arbitrary entry coordinates are not plotted in the new coordinate frame. Unknown stores clear prior highlighting and show a provisional floor overview. Multiple source floors can be selected with destination tabs.

Photo-map focus also resolves the canonical catalog record rather than trusting caller coordinates, clears stale selection/routes and rejects highlighting shared photo regions. Rapid taps on different store cards no longer count as a double-tap on a single store.

## Routing assessment

The source includes real circulation linework and 17 connector records, including escalators. All 1,224 segments lack explicit width and bidirectional values; 16 of 17 connectors lack direction. These omissions do not prove the network is unusable, but this implementation has not verified door-to-network joins, directional continuity, accessibility or current operating status. Most importantly, no calibrated visitor origin in this source coordinate frame is available.

Accordingly, no destination walking route is computed, no dark-cyan route dots are fabricated, and AR/directions remain disabled. Gray dashed lines are explicitly labeled source circulation, neutral connector circles are source references, and the notice states that they are not walking directions. A real route requires a validated graph, destination entrances and a compatible user origin. The existing photo-model demonstration remains isolated and labeled as fictional-origin, non-guidance.

## Verification and release

`test-source-map.py` verifies source joins, catalog isolation and evidence counts. `test-source-map-browser.mjs` covers actual tablet taps, correct polygons, animated rotation/zoom, viewport framing, two floors, missing locations, rapid choices, reduced motion, portrait layout, return control, foreign-mall rejection and absence of iframe/unsafe routes. It runs in Chromium and WebKit; screenshots are generated locally in `artifacts/`.

The Contabo publish job depends on both existing validation and tablet E2E (Chromium + WebKit). A failed browser check prevents publication. Public release status must be checked separately from test completion.
