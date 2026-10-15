"""Build a per-mall JSON store TABLE from source directories and vector geometry.

The source of truth remains mall-specific photographed shop CSVs, and the
provisional polygon links they produced. Never invent shop names or attach a
directory-only record to a random room. Assets are generated under public/
as read-only JSON for the current file-based RetailNav database. A future
mall admin backend may persist the same contract transactionally.
"""
import hashlib
import json
from collections import Counter
from pathlib import Path

SCHEMA = "retailnav.mall.stores.v1"
EVIDENCE = {"photo-store-name-unverified", "mall-reviewed-products"}


def build_table(repo: Path, mall_id: str, mall: dict) -> dict:
    hints_file = repo / "data" / "store-products" / (mall_id + ".json")
    hints = {}
    if hints_file.exists():
        source = json.loads(hints_file.read_text(encoding="utf-8"))
        if source.get("mallId") != mall_id or source.get("schema") != "retailnav.store-products.v1":
            raise ValueError(f"{mall_id}: invalid product annotation namespace")
        for item in source.get("annotations", []):
            key = (item["floor"], item["code"])
            if key in hints or item.get("evidence") not in EVIDENCE:
                raise ValueError(f"{mall_id}: duplicate or unverifiable product annotation {key}")
            tags = item.get("products")
            if not isinstance(tags, list) or not tags or any(
                not isinstance(term, str) or not term.strip() or len(term) > 80 for term in tags
            ):
                raise ValueError(f"{mall_id}: invalid products for {key}")
            hints[key] = item

    floors = {f[0]: {v[0]: v for v in f[3]} for f in mall["floors"]}
    owners = Counter((u.get("floor"), u.get("polygonId")) for u in mall.get("units", [])
                     if u.get("polygonId"))
    records = []
    seen = set()
    for original in mall.get("units", []):
        u = dict(original)
        floor, code = u.get("floor"), u.get("code")
        if not isinstance(floor, str) or floor not in floors or not isinstance(code, str) or not code.strip():
            raise ValueError(f"{mall_id}: unidentifiable shop row")
        key = (floor, code)
        if key in seen:
            raise ValueError(f"{mall_id}: duplicate shop code on same floor: {key}")
        seen.add(key)
        identifier = u.get("polygonId")
        relation = "unplaced-directory"
        # Only an existing polygon on that SAME floor can be referenced. A
        # multi-store merged photo-colour region is not a verified storefront.
        if identifier is not None:
            if identifier not in floors[floor]:
                u["candidatePolygonId"] = identifier
                identifier = None
                relation = "missing-vector-requires-review"
            elif owners[(floor, identifier)] > 1:
                relation = "shared-vector-unverified"
            else:
                relation = "one-photo-region-unverified"
        u["mallId"] = mall_id
        u["storeId"] = f"{mall_id}:{floor}:{code}"
        u["polygonId"] = identifier
        u["vectorRelation"] = relation
        u["vectorVerified"] = False
        if (floor, code) in hints:
            hint = hints[(floor, code)]
            u["productTerms"] = sorted(set(hint["products"]))
            u["productEvidence"] = hint["evidence"]
            u["productSource"] = hint["source"]
            u["productsVerified"] = hint["evidence"] == "mall-reviewed-products"
        else:
            u["productTerms"] = []
            u["productsVerified"] = False
        records.append(u)
    unused = set(hints) - seen
    if unused:
        raise ValueError(f"{mall_id}: orphan product annotations {sorted(unused)}")
    document = {
        "schema": SCHEMA,
        "mallId": mall_id,
        "status": "photo-directory-provisional-not-live-inventory",
        "records": records,
        "stats": {
            "total": len(records),
            "linkedProvisional": sum(bool(r["polygonId"]) for r in records),
            "sharedVectors": sum(r["vectorRelation"] == "shared-vector-unverified" for r in records),
            "withoutVector": sum(not r["polygonId"] for r in records),
            "withProductEvidence": sum(bool(r["productTerms"]) for r in records)
        }
    }
    return document


def publish_table(repo: Path, mall_id: str, mall: dict) -> dict:
    doc = build_table(repo, mall_id, mall)
    raw = (json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf8")
    relative = "catalog/malls/" + mall_id + "/stores.json"
    destination = repo / "public" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
    # Reuse exactly these records in the in-page search. No separate,
    # potentially inconsistent or stale client-side name↔geometry index.
    mall["units"] = doc["records"]
    mall["storeCatalog"] = {
        "url": relative,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "schema": SCHEMA,
        **doc["stats"]
    }
    return doc
