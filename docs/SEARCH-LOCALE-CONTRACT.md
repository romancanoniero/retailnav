# RetailNav — Semantic search, translation and tenant-safe store evidence

**Implementation:** merged PR #42 plus the Aventura directory expansion (2026-10-16).
This describes the code contract and a dated official-directory snapshot, **not** a verified live inventory of Aventura Mall.

## 1. Locale and user preference

- The browser inspects `navigator.languages` in order, then `navigator.language`. It chooses the first supported locale and falls back to English when unsupported.
- The compact language selector alongside the *single* map search offers **Auto**, EN, ES, ES-AR, PT, PT-BR, 中文, FR.
- An explicitly selected locale is saved on that device as `retailnav:language-preference:v1`. Auto removes the override and resumes device detection.
- UI text specific to search, suggestions, categories, result counts and store-detail labels use the active locale. The rest of RetailNav remains an incrementally translated interface; it is **not yet fully localized**.
- The same browser can search cross-language terms regardless of its display language. No coordinates or personal identifiers are sent to translation providers.

## 2. Source of truth, no translated duplicates

- `data/search-taxonomy.json`: one stable concept ID per category, product or service (e.g. `product.luggage`, `service.device-support`), with regional synonym arrays under `labels`.
- `data/store-concepts/<mallId>.json`: tenant-specific links `(floor, code, expectedMapName) -> conceptIds`, evidence and provenance. The build rejects unknown IDs, duplicate links and mismatched names.
- `data/store-directory/aventura.json`: official Shops and Dining merchant rows, descriptions, published location text, stable concept IDs and source URLs. A directory-only row has `polygonId: null`; no row is associated to a vector by proximity. Dining records merge with matching Shops names, and announced Coming Soon entries are excluded from active search.
- `scripts/store_catalog.py`: publishes `public/catalog/malls/<mallId>/stores.json` and injects the same rows into `mall.units`. Directory records may have `floor: null` and a separate `documentedFloors` array when the official listing names multiple levels. `conceptIds`, `conceptEvidence`, `conceptSource`, `conceptsVerified` do not rename the original photographed unit.
- `src/search-i18n.js`: locale detection, translations, normalized semantic matching, suggestions and explicit/manual preference.
- `src/units.js`: unifies exact shop/code/alias/photographed products lookup with semantic categories and synonyms; only concepts attached to records in the selected mall appear in suggestions. Suggestion counts and store lists deduplicate identical named map and directory entries.
- `src/viewer.js`: while typing, renders matching semantic tags and the number of distinct businesses in the active mall first, followed by merchant lists grouped under each tag. Selecting a directory-only merchant opens its information without attaching a map vector.
- `src/poi-layer.js`: maps already recorded amenities to service concept IDs without manufacturing spatial locations.
- `src/viewer.js`: opens the visitor's reference floor plus all matched store/POI/district floors, highlights only associated vectors and shows unmapped results without invented map markers.

The global taxonomy is language-neutral; a translation edit does **not** require duplicating shop relationships or modifying floor polygons.

## 3. Aventura Mall coverage and trust

There are 131 photographed unit/anchor polygon references across LL/UL/L3, **not 131 verified currently operating stores**. The official Shops directory describes 300+ retailers; its captured 272 entries are merged with 68 distinct active Dining entries, for 338 searchable official-directory businesses. Two records appear in both official sections and are kept once. Individual descriptions are retained where captured; Coming Soon listings are excluded. The official Dining page describes more than 50 restaurants and eateries.

Only 14 photographed anchor references have legible chain/store names, and those provisional associations remain in `data/store-concepts/aventura.json`. The remaining 117 vector references are **not mapped to real tenant names** and deliberately receive no product or service tags. `data/store-directory/aventura-map-audit.json` records the source comparison for all 14: official level text corroborates the floor label for 10, but no polygon or storefront boundary is thereby verified.

The existing 14 map-linked concept records continue to carry `brand-category-inference-not-inventory` and `conceptsVerified=false`. Dining concepts carry `official-dining-description`; cuisine and food-type labels are assigned only where the official Dining copy describes them. Eataly is listed as a market and dining destination; its described foods are search terms, not certified current inventory. All directory concepts keep `conceptsVerified=false` and `productsVerified=false`. This is searchable description evidence, **not** observed stock, confirmed branch service availability, lease status or an official unit number. In particular, Apple’s official page says **Outdoor Courtyard**, describes a two-level store and supplies official interactive-map location ID `20946`; that identifier is not a RetailNav vector ID and the page does not identify prototype `LL-002`. The audit preserves that map-named Apple association as provisional and does not join the official directory record to its polygon.

JCPenney’s official page lists **Lower and Upper Level** and explicitly describes apparel, shoes, home furnishings, jewelry, beauty, hair salon, optical and portrait studio services. The directory record keeps `floor: null` plus `documentedFloors: ["LL", "UL"]` and opens both floors in search. Existing LL/UL map associations remain provisional because the directory does not certify their polygons as JCPenney storefront boundaries.

The official Dining page also places Auntie Anne’s at Treats Food Hall on both the Upper Level by H&M and the Lower Level outside JCPenney. RetailNav records `floor: null`, keeps both documented floors, and does not invent a single map position. Food type examples include `sushi`, `pizza`, `steak`, `ice cream`, `coffee`, `pasta`, and `salads`, with translated labels in supported locales. These tags describe published menus and cuisine, not current stock.

The existing Shanghai photo annotation of luggage shop `5A10` remains `productsVerified=false`, with `polygonId=null` until its exact photo region is identified.

## 4. Search examples

| Input | Meaning | Display |
|---|---|---|
| `Apple` | Store name | Official directory row with no geometry, plus the separately retained provisional `LL-002` photo-map association |
| `valijas`, `maletas`, `luggage`, `malas`, `行李箱` | `product.luggage` | Product label changes with the terminal locale; matched store IDs do not change |
| `zapatillas para correr`, `sneakers` | `product.shoes` | Relevant category-associated stores |
| `reparar celular`, `tech support`, `手机维修` | `service.device-support` | Apple official-page description plus the separate provisional map association; not a verified repair counter or appointment |
| `optical`, `óptica`, `视力检查` | `service.optical` | JCPenney official-page description; branch service availability is not certified |
| `baños`, `restrooms`, `洗手间` | `service.restroom` | Map amenities if already present on the active mall's photographed reference |

Suggestions are never generated for concepts that have no linked stores in the active mall. **Search is not inventory proof.**

## 5. QA gates

Run after regenerating the self-contained page:

```bash
python3 scripts/build-web.py
python3 scripts/verify.py public
node --test scripts/test-multilingual-search.mjs
node scripts/test-store-search-browser.mjs
```

The Node suite validates stable IDs, locale fallback, preference override, translations and safe non-inference; the Playwright suite exercises the selector, search, multi-floor highlights, map results and legacy Shanghai photo tags on a touch viewport.

**Release constraints:** Aventura's mapping remains a reference mock, floor geometry has no measured survey precision, route guidance is not authorized, and current merchants/inventory cannot be certified from the scanned photos. Do not report these gaps as completed.
