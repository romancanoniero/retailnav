# RetailNav — Semantic search, translation and tenant-safe store evidence

**Implementation:** `feature/multilingual-store-search-20261015` (2026-10-15).
This describes the shipped code contract, **not** a verified 2026 inventory of Aventura Mall.

## 1. Locale and user preference

- The browser inspects `navigator.languages` in order, then `navigator.language`. It chooses the first supported locale and falls back to English when unsupported.
- The compact language selector alongside the *single* map search offers **Auto**, EN, ES, ES-AR, PT, PT-BR, 中文, FR.
- An explicitly selected locale is saved on that device as `retailnav:language-preference:v1`. Auto removes the override and resumes device detection.
- UI text specific to search, suggestions, categories, result counts and store-detail labels use the active locale. The rest of RetailNav remains an incrementally translated interface; it is **not yet fully localized**.
- The same browser can search cross-language terms regardless of its display language. No coordinates or personal identifiers are sent to translation providers.

## 2. Source of truth, no translated duplicates

- `data/search-taxonomy.json`: one stable concept ID per category, product or service (e.g. `product.luggage`, `service.device-support`), with regional synonym arrays under `labels`.
- `data/store-concepts/<mallId>.json`: tenant-specific links `(floor, code, expectedMapName) -> conceptIds`, evidence and provenance. The build rejects unknown IDs, duplicate links and mismatched names.
- `scripts/store_catalog.py`: publishes `public/catalog/malls/<mallId>/stores.json` and injects the same rows into `mall.units`. `conceptIds`, `conceptEvidence`, `conceptSource`, `conceptsVerified` do not rename the original photographed unit.
- `src/search-i18n.js`: locale detection, translations, normalized semantic matching, suggestions and explicit/manual preference.
- `src/units.js`: unifies exact shop/code/alias/photographed products lookup with semantic categories and synonyms; only concepts attached to records in the selected mall appear in suggestions.
- `src/poi-layer.js`: maps already recorded amenities to service concept IDs without manufacturing spatial locations.
- `src/viewer.js`: opens the visitor's reference floor plus all matched store/POI/district floors, highlights only associated vectors and shows unmapped results without invented map markers.

The global taxonomy is language-neutral; a translation edit does **not** require duplicating shop relationships or modifying floor polygons.

## 3. Aventura Mall coverage and trust

There are 131 photographed unit/anchor polygon references across LL/UL/L3, **not 131 verified currently operating stores**.

Only 14 anchor references have legible chain/store names suitable for cautious prototype classification, e.g. Apple, JCPenney, Nordstrom, Macy's and Bloomingdale's across their floor references. The remaining 117 vector references are **not mapped to real tenant names** and deliberately receive no product or service tags.

Every Aventura concept record currently carries `brand-category-inference-not-inventory` and `conceptsVerified=false`. This means *typical category / plausible association*, **not** observed stock, certified branch services, location operating status or an official unit number. In particular, `service.device-support` for Apple must not imply an on-premise repair appointment is currently offered. A mall-approved directory and store/vector audit are still required before promoting these entries.

The existing Shanghai photo annotation of luggage shop `5A10` remains `productsVerified=false`, with `polygonId=null` until its exact photo region is identified.

## 4. Search examples

| Input | Meaning | Display |
|---|---|---|
| `Apple` | Store name | Official-looking brand label from the **photographed map**, still subject to mall verification |
| `valijas`, `maletas`, `luggage`, `malas`, `行李箱` | `product.luggage` | Product label changes with the terminal locale; matched store IDs do not change |
| `zapatillas para correr`, `sneakers` | `product.shoes` | Relevant category-associated stores |
| `reparar celular`, `tech support` | `service.device-support` | Only stores explicitly linked to the *provisional* service concept, clearly labeled unverified |
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
