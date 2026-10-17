# Aventura: source geometry and tablet selection

Reviewed 2026-10-16. PR #47 is open and was not merged: its embedded RoveIQ application is excluded. Only the directory source IDs/floor labels are carried forward. No revert is needed on main.

## Evidence and coordinate contract

The official Joe & The Juice page https://aventuramall.com/dining/joe-the-juice/ links to venue 107, location 20680. Its public viewer loads `https://s3.us-east-2.amazonaws.com/settings.roveiq.com/venue-107/map.json` and `locations.json`. The checked-in snapshot `data/official-maps/aventura.json` records the capture date and SHA-256 of both complete source responses, and retains only geometry, identity, circulation and connector fields used here.

Source floor IDs 361/362/363 map explicitly to LL/UL/L3. The snapshot contains 607 structure features, 413 location records, 1,224 circulation segments and 17 floor connectors. This is source evidence, not an independent physical survey.

`scripts/source_map.py` attaches `sourceGeometry` to a directory store only when one official location matches by its recorded ID and normalized name, or a unique exact normalized name where no ID was recorded. The source polygon's `loc_id` AND the location's `suite_ids` must agree. The binding retains mall ID, store ID, source coordinate space, source snapshot hash, floor ID, source floor ID, dataset ID and polygon ID. Conflicts and ambiguous names remain unplaced. The current build joins 295 directory shops, including 12 of 15 Coffee entries. Nordstrom eBar, Sens Coffee and the generic Starbucks entry have no qualified polygon association. No nearest-room or fuzzy name fallback is used.

### Reviewed identity repair: Eataly (2026-10-16)

The current [official Eataly page](https://aventuramall.com/dining/eataly/) declares Third Level and embeds venue 107/location **29877**. The unchanged source map assigns that exact ID to footprint **54386bc1ec932155fd6c2b4a8ad17125**, floor 363/L3, dataset 2703. The current location table no longer contains 29877; it lists Eataly as **65343**, with WordPress integration key 74995 matching the page's post ID. Its suite 6925d782c0eb4983b9782fcb75bd36ee is an unassigned shape of approximately 1.65 m², not the approximately 2,497 m² footprint. It is excluded from the shop highlight. No other source location claims the large footprint.

`aventura-identity-reviews.json` records the page URL/hash, current location extract/hash, exact polygon/floor IDs and source snapshot hash. The explicit `official-directory-location-and-source-polygon-id` binding is restricted to this reviewed store and source version. It requires the directory page, venue, merchant name, embedded ID, documented floor and polygon's location ID to agree, and rejects another tenant's claim. No source geometry is modified and no generic name/proximity fallback is added. The two internal store levels do not establish a fourth mall floor or a second destination polygon. This repair supplies a destination, not a verified walking route.

Search floor visibility, result badges and per-floor markers now use qualified polygon floors. A directory floor remains distinct evidence and is a fallback only when no geometry is associated. This prevents stale LL directory labels for Bath & Body Works and Champs Sports from hiding their source-linked UL polygons, and preserves every linked floor of multi-floor stores. Unplaced results explicitly say that only the directory floor is available.

The audit also retains directory/geometry discrepancies instead of rewriting the directory: Bath & Body Works and Champs Sports publish LL but have UL source polygons; Bloomingdale’s and both Macy’s records publish LL/UL but have LL/L3 polygons. Auntie Anne’s, JCPenney, Louis Vuitton, Nike, Nordstrom, Saint Laurent and Zara publish LL/UL but have only LL bound geometry. These bindings establish which source polygons can be highlighted, not an independent survey or proof that every published floor has been mapped. Joey has source polygons on LL/UL without a complete directory floor list.

The official geometry is compiled into the **existing WebGL/Canvas 3D floor format**, not a second viewer. `import-source-map-3d.mjs` uses pinned Earcut 3.0.2 offline, preserves polygon holes, checks triangulation area, and creates 607 structures plus nine source floor surfaces. The checked-in mesh binds to the snapshot SHA-256. Every ordinary build validates that identity; changing the source requires recompilation. Longitude/latitude projects to local decimeters around (-80.14275, 25.95706), with world scale 0.025. This projection is not a registration to photographic pixels or a surveyed indoor positioning calibration.

The original 235 photo-derived vectors and images remain in the existing **Tu plano** comparison. Historical commercial aliases are archived with `photoReference` and `activeMap:false`; they cannot claim a current store polygon or appear as duplicate search results. Unmatched directory entries have no coordinates. No iframe, SVG map replacement, or runtime vendor map application is used.

## Interaction

Selecting a shop keeps the same canvas, camera, controls and 3D renderer. The canonical mall/store identity and source snapshot resolve all polygons on the requested floor. Camera translation, upright rotation and zoom interpolate together for 860 ms; reduced motion focuses immediately. Footprint bounds determine framing. A different visitor floor remains as a blue floor outline so its surfaces cannot occlude the destination; the floor caption identifies both. Floor heights remain provisional. Unknown stores clear highlighting and show their documented floor without assigning a guessed polygon.

Visitor coordinates, social markers and cooperative QR references carry the coordinate frame. Legacy photo positions are rejected in the source frame, including old open clients; consented manual source-frame positions support negative coordinates. Demo contacts use explicitly fictional positions sampled from the source circulation, never old photo pixels. Native gestures, all-floor selection, 2D/3D, source-photo inspection and export remain available.

## Routing assessment

The source includes real circulation linework and 17 connector records, including escalators. All 1,224 segments lack explicit width and bidirectional values; 16 of 17 connectors lack direction. These omissions do not prove the network is unusable, but this implementation has not verified door-to-network joins, directional continuity, accessibility or current operating status. Most importantly, no calibrated visitor origin in this source coordinate frame is available.

No walking route is certified and AR/directions remain disabled. The later native orientation work can show explicitly provisional cyan dots only on filtered same-floor source linework with a compatible user origin and source entrance; see [WAYFINDING.md](WAYFINDING.md). Floating stair/elevator icons are removed. A verified route still requires a validated graph and directional/accessibility continuity. The old fictional-origin pathfinding action remains disabled.

## Verification and release

`test-source-map.py` verifies source joins, independently projected vertices, triangle area, holes, interior centres, catalog isolation and evidence counts. `test-source-map-browser.mjs` covers actual tablet taps, correct polygons, animated rotation/zoom, viewport framing, two floors, missing locations, rapid choices, reduced motion, portrait layout, original 3D controls, foreign-mall rejection and absence of iframe/unsafe routes. It runs in Chromium and WebKit; screenshots are generated locally in `artifacts/`. `test-source-map-comparison.mjs` verifies exact original photo overlays, export coordinates, and removal of GPU highlighting when changing floors. Positioning E2E exercises both frames against the actual local backend.

The Contabo publish job depends on both existing validation and tablet E2E (Chromium + WebKit). A failed browser check prevents publication. Public release status must be checked separately from test completion.
