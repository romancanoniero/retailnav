#!/usr/bin/env python3
"""Attach only source-supported category tags; never infer brand inventory."""
import argparse
import csv
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--taxonomy", type=Path, required=True)
    parser.add_argument("--mall-dir", type=Path, required=True)
    args = parser.parse_args()
    taxonomy = json.loads(args.taxonomy.read_text(encoding="utf-8"))
    source_path = args.mall_dir / "source-records.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    if (taxonomy.get("schema") != "retailnav.mall.category-tags.v1" or
            taxonomy.get("mallId") != "alto-palermo"):
        raise ValueError("Invalid Alto Palermo category taxonomy")
    mapping = taxonomy["categories"]
    source_categories = {row.get("category") or "" for row in source["stores"]}
    if source_categories != set(mapping):
        raise ValueError(f"Category mapping drift: missing={source_categories-set(mapping)} unused={set(mapping)-source_categories}")
    by_id = {}
    for row in source["stores"]:
        category = row["category"]
        annotation = mapping[category]
        row["tags"] = annotation["tags"]
        row["concept_ids"] = annotation.get("conceptIds", [])
        row["tag_evidence"] = taxonomy["evidence"]
        row["tag_source"] = taxonomy["source"]
        by_id[str(row["id"])] = row
    source_path.write_text(json.dumps(source, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

    total = 0
    for csv_path in args.mall_dir.glob("*-unit-codes.csv"):
        with csv_path.open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream); rows = list(reader); fields = list(reader.fieldnames or [])
        for field in ("conceptIds", "conceptEvidence", "conceptSource", "tagEvidence", "tagSource"):
            if field not in fields:
                fields.append(field)
        for row in rows:
            source_row = by_id[row["sourceRecordId"]]
            row["tags"] = ",".join(source_row["tags"])
            row["conceptIds"] = "|".join(source_row["concept_ids"])
            row["conceptEvidence"] = taxonomy["evidence"]
            row["conceptSource"] = taxonomy["source"]
            row["tagEvidence"] = taxonomy["evidence"]
            row["tagSource"] = taxonomy["source"]
            total += 1
        with csv_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
            writer.writeheader(); writer.writerows(rows)
    if total != len(source["stores"]):
        raise ValueError(f"Expected {len(source['stores'])} tagged records, wrote {total}")
    print(json.dumps({"records": total, "categories": len(mapping), "evidence": taxonomy["evidence"]}))


if __name__ == "__main__":
    main()
