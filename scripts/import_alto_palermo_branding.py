#!/usr/bin/env python3
"""Import Alto Palermo's published store marks and open Inter font evidence.

The official interactive directory publishes one image URL per marker record.
Assets are stored locally with their original bytes and hashes; no logo is
invented, redrawn, enlarged or assigned to a different source record.
"""
import argparse
import csv
import hashlib
import json
import ssl
import struct
import re
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import certifi


SOURCE_ROOT = "https://www.altopalermo.com.ar"
CATALOG_URL = SOURCE_ROOT + "/maps_ap/storesData.json"
MALL_MARK_URL = SOURCE_ROOT + "/maps_ap/img/logo.png"
PUBLIC_ROOT = "branding/malls/alto-palermo"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png_size(data):
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Official brand asset is not a valid PNG")
    return list(struct.unpack(">II", data[16:24]))


def official_image_url(raw):
    if not isinstance(raw, str) or not raw.startswith("/maps_ap/img/"):
        raise ValueError(f"Unexpected Alto Palermo logo path: {raw!r}")
    parsed = urllib.parse.urlparse(raw)
    decoded_path = urllib.parse.unquote(parsed.path)
    official_name = Path(decoded_path).name
    if not official_name or not official_name.lower().endswith(".png"):
        raise ValueError(f"Unsafe Alto Palermo logo filename: {raw!r}")
    stem = unicodedata.normalize("NFKD", official_name[:-4]).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._").lower() or "logo"
    suffix = hashlib.sha256(official_name.encode("utf-8")).hexdigest()[:8]
    local_name = f"{stem}-{suffix}.png"
    encoded_path = urllib.parse.quote(decoded_path, safe="/")
    return SOURCE_ROOT + encoded_path, local_name


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "RetailNav source archiver/1.0"})
    context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(request, timeout=30, context=context) as response:
            if response.status != 200:
                raise ValueError(f"Unable to download {url}: HTTP {response.status}")
            return response.read()
    except Exception as error:
        raise ValueError(f"Unable to download official asset {url}: {error}") from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-json", type=Path, required=True)
    parser.add_argument("--inter-font", type=Path, required=True)
    parser.add_argument("--inter-license", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    current = json.loads(args.catalog_json.read_text(encoding="utf-8"))
    source_path = args.out / "source-records.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    if len(current) != 158 or len(source["stores"]) != 158:
        raise ValueError("Unexpected Alto Palermo directory size")
    by_id = {int(row["id"]): row for row in current}
    if set(by_id) != {int(row["id"]) for row in source["stores"]}:
        raise ValueError("Official directory IDs changed")

    wanted = {}
    for row in current:
        url, filename = official_image_url(row.get("logo"))
        wanted[filename] = url
    wanted["mall-mark.png"] = MALL_MARK_URL

    downloaded = {}
    unavailable = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {filename: pool.submit(download, url) for filename, url in wanted.items()}
        for filename, future in futures.items():
            try:
                downloaded[filename] = future.result()
            except ValueError as error:
                if filename == "mall-mark.png":
                    raise
                unavailable.append({
                    "sourceUrl": wanted[filename], "filename": filename,
                    "status": "published-reference-unavailable", "error": str(error),
                })

    stores_dir = args.out / "branding" / "stores"
    stores_dir.mkdir(parents=True, exist_ok=True)
    assets = []
    metadata = {}
    for filename, data in sorted(downloaded.items()):
        url = wanted[filename]
        try:
            width, height = png_size(data)
        except ValueError as error:
            if filename == "mall-mark.png":
                raise
            unavailable.append({
                "sourceUrl": url, "filename": filename,
                "status": "published-reference-invalid-png", "error": str(error),
                "downloadSha256": digest(data), "downloadBytes": len(data),
            })
            continue
        destination = (args.out / "branding" / filename
                       if filename == "mall-mark.png" else stores_dir / filename)
        destination.write_bytes(data)
        public_url = (f"{PUBLIC_ROOT}/{filename}" if filename == "mall-mark.png"
                      else f"{PUBLIC_ROOT}/stores/{filename}")
        record = {
            "sourceUrl": url,
            "sourceFile": destination.relative_to(args.out).as_posix(),
            "publicUrl": public_url,
            "sha256": digest(data),
            "bytes": len(data),
            "mime": "image/png",
            "width": width,
            "height": height,
            "assetKind": "mall-logomark" if filename == "mall-mark.png" else "store-logo-raster-source",
        }
        assets.append(record)
        metadata[url] = record

    font_data = args.inter_font.read_bytes()
    if font_data[:4] not in (b"\x00\x01\x00\x00", b"true"):
        raise ValueError("Inter source is not a TrueType font")
    license_data = args.inter_license.read_bytes()
    if b"SIL OPEN FONT LICENSE" not in license_data.upper():
        raise ValueError("Inter OFL license text missing")
    fonts_dir = args.out / "branding" / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    (fonts_dir / "Inter-Medium.ttf").write_bytes(font_data)
    (fonts_dir / "Inter-OFL.txt").write_bytes(license_data)
    for filename, data, mime, kind, url in (
        ("Inter-Medium.ttf", font_data, "font/ttf", "mall-ui-and-vector-label-font",
         "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf"),
        ("Inter-OFL.txt", license_data, "text/plain", "font-license",
         "https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt"),
    ):
        assets.append({
            "sourceUrl": url,
            "sourceFile": f"branding/fonts/{filename}",
            "publicUrl": f"{PUBLIC_ROOT}/fonts/{filename}",
            "sha256": digest(data), "bytes": len(data), "mime": mime,
            "assetKind": kind,
        })

    bindings = []
    for original in source["stores"]:
        current_row = by_id[int(original["id"])]
        if (original["name"] != current_row["name"] or
                (original.get("local_number") or "") != (current_row.get("localNumber") or "") or
                original["floor"] != current_row["floor"]):
            raise ValueError(f"Directory record changed while importing branding: {original['id']}")
        logo_source, filename = official_image_url(current_row["logo"])
        item = metadata.get(logo_source)
        original.update({
            "logo": current_row["logo"],
            "logo_source_url": logo_source,
            "logo_local_url": item["publicUrl"] if item else "",
            "logo_sha256": item["sha256"] if item else "",
            "logo_width": item["width"] if item else None,
            "logo_height": item["height"] if item else None,
            "logo_status": "archived" if item else "published-reference-unavailable",
        })
        bindings.append({
            "sourceRecordId": str(original["id"]), "name": original["name"],
            "sourceUrl": logo_source, "publicUrl": item["publicUrl"] if item else "",
            "sha256": item["sha256"] if item else "",
            "width": item["width"] if item else None,
            "height": item["height"] if item else None,
            "status": "archived" if item else "published-reference-unavailable",
        })

    source["branding_source_url"] = CATALOG_URL
    source["branding_source_sha256"] = digest(args.catalog_json.read_bytes())
    source["branding_imported_at"] = "2026-10-17"
    source_path.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for csv_path in args.out.glob("*-unit-codes.csv"):
        with csv_path.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        if not rows:
            continue
        fields = list(rows[0])
        for name in ("logoURL", "logoSourceURL", "logoSha256"):
            if name not in fields:
                fields.append(name)
        for row in rows:
            original = next(item for item in source["stores"]
                            if str(item["id"]) == row["sourceRecordId"])
            row["logoURL"] = original["logo_local_url"]
            row["logoSourceURL"] = original["logo_source_url"]
            row["logoSha256"] = original["logo_sha256"]
        with csv_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
            writer.writeheader(); writer.writerows(rows)

    manifest = {
        "schema": "retailnav.mall.brand-assets.v1", "mallId": "alto-palermo",
        "source": CATALOG_URL, "sourceSha256": source["branding_source_sha256"],
        "assets": assets, "storeBindings": bindings, "unavailableAssets": unavailable,
        "stats": {"directoryRecords": len(bindings),
                  "recordsWithArchivedLogo": sum(bool(row["publicUrl"]) for row in bindings),
                  "recordsWithUnavailablePublishedLogo": sum(not row["publicUrl"] for row in bindings),
                  "uniqueArchivedStoreLogoFiles": sum(
                      asset["assetKind"] == "store-logo-raster-source" for asset in assets),
                  "uniqueUnavailableStoreLogoFiles": len(unavailable)},
    }
    (args.out / "brand-assets.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    referenced_files = {asset["sourceFile"] for asset in assets}
    for old_file in stores_dir.glob("*.png"):
        if old_file.relative_to(args.out).as_posix() not in referenced_files:
            old_file.unlink()
    print(json.dumps(manifest["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
