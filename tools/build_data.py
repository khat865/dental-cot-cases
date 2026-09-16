"""Package the existing 47 CoT cases and earlier English examples without rewriting.

The public output is a whitelisted projection of source records. Local source
paths are used only while building and are never written into public artifacts.
Requires Pillow for image decoding verification.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import xml.etree.ElementTree as ET

from PIL import Image


VERSION = "dental-cot-47-v2-diagnostic-time"
DEFAULT_ROOT = Path(r"E:\study\dental\case_report_crawler")
PIPELINE = Path("audit_cache/final_pipeline_20260826_0001")
TRAINING = Path("training/qwen3_vl_cot_47_v1")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text("utf-8").splitlines() if line.strip()]


def by_id(rows: list[dict], key: str) -> dict[str, dict]:
    result = {row[key]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError(f"Duplicate {key} in source records")
    return result


def sections(response: str) -> dict[str, str]:
    result = {}
    ends = []
    for tag in ("Caption", "Think", "Answer"):
        matches = list(re.finditer(fr"<{tag}>(.*?)</{tag}>", response, re.S))
        if len(matches) != 1 or not matches[0].group(1).strip():
            raise ValueError(f"Expected one non-empty {tag} section")
        result[tag.lower()] = matches[0].group(1)
        ends.append(matches[0].span())
    if not (ends[0][1] <= ends[1][0] and ends[1][1] <= ends[2][0]):
        raise ValueError("Response sections are out of order")
    return result


def node_text(node: ET.Element | None) -> str:
    return " ".join("".join(node.itertext()).split()) if node is not None else ""


def article_metadata(article_dir: Path, candidate: dict) -> dict:
    metadata = json.loads((article_dir / "metadata.json").read_text("utf-8"))
    root = ET.parse(article_dir / "source.xml").getroot()
    for node in root.iter():
        node.tag = node.tag.rsplit("}", 1)[-1]
    article = root.find(".//article-meta")
    authors = []
    urls = []
    if article is not None:
        for group in article.findall("contrib-group"):
            if group.get("content-type") == "editor":
                continue
            for contributor in group.findall("contrib"):
                if contributor.get("contrib-type", "author") != "author":
                    continue
                if "editor" in node_text(contributor.find("role")).lower():
                    continue
                name = contributor.find("name")
                author = " ".join(filter(None, [node_text(name.find("given-names")), node_text(name.find("surname"))])) if name is not None else node_text(contributor.find("collab"))
                if author and author not in authors:
                    authors.append(author)
        for license_node in article.findall("permissions/license"):
            for node in license_node.iter():
                for attr, value in node.attrib.items():
                    if attr.rsplit("}", 1)[-1] == "href" and value.startswith(("https://", "http://")) and value not in urls:
                        urls.append(value)
    retained_license = metadata.get("license", {})
    for license_item in retained_license.get("jats_licenses", []):
        value = license_item.get("url", "")
        if value and value not in urls:
            urls.append(value)
    title = candidate.get("title") or metadata.get("title", "")
    journal = candidate.get("journal") or metadata.get("journal", "")
    year = str(candidate.get("pub_year") or metadata.get("pub_year", ""))
    doi = candidate.get("doi") or metadata.get("doi", "")
    citation_parts = [", ".join(authors), title, journal, year]
    if doi:
        citation_parts.append(f"doi: {doi}")
    return {
        "authors": authors,
        "journal": journal,
        "year": year,
        "citation": ". ".join(part.rstrip(".") for part in citation_parts if part) + ".",
        "license_url": urls[0] if urls else None,
        "licenseUrls": urls,
        "licenseText": "\n".join(item.get("text", "") for item in retained_license.get("jats_licenses", [])),
        "copyright": retained_license.get("copyright_statements", []),
        "sourceUrl": metadata.get("source_urls", {}).get("pmc", ""),
        "doi": doi,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "docs")
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source_files = {
        "original_samples": source_root / TRAINING / "data_v2/built/full_47_ms_swift.jsonl",
        "image_manifest": source_root / TRAINING / "data_v2/built/dataset_manifest.jsonl",
        "structured_records": source_root / TRAINING / "data_v2/selected_47_diagnostic_time.jsonl",
        "earlier_english_samples": source_root / PIPELINE / "qwen_cot_english_gold_samples_v1/selected_cot_results.jsonl",
    }
    samples = read_jsonl(source_files["original_samples"])
    manifests = by_id(read_jsonl(source_files["image_manifest"]), "id")
    structured = by_id(read_jsonl(source_files["structured_records"]), "pmcid")
    english = by_id(read_jsonl(source_files["earlier_english_samples"]), "pmcid")
    sample_ids = set(by_id(samples, "id"))
    if len(samples) != 47 or sample_ids != set(manifests) or sample_ids != set(structured):
        raise ValueError("The original sources must contain the same 47 unique cases")
    if len(english) != 3 or not set(english).issubset(sample_ids):
        raise ValueError("Expected exactly three earlier English variants within the 47 cases")

    assets = {}

    def copy_image(case_id: str, source: Path, caption: str, types: list[str], expected_hash: str | None) -> dict:
        if not re.fullmatch(r"PMC\d+", case_id) or source.name != Path(source.name).name:
            raise ValueError("Unsafe asset name")
        data = source.read_bytes()
        digest = sha256(data)
        if expected_hash and digest != expected_hash:
            raise ValueError(f"Source image hash mismatch: {case_id}/{source.name}")
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            width, height = image.size
        relative = (Path("assets") / case_id / source.name).as_posix()
        if relative in assets and assets[relative]["sha256"] != digest:
            raise ValueError(f"Conflicting image bytes at {relative}")
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or sha256(destination.read_bytes()) != digest:
            shutil.copyfile(source, destination)
        if sha256(destination.read_bytes()) != digest:
            raise ValueError(f"Copied image hash mismatch at {relative}")
        assets[relative] = {"src": relative, "sha256": digest, "bytes": len(data), "width": width, "height": height}
        return {"src": relative, "name": source.name, "caption": caption, "types": types, "sha256": digest, "width": width, "height": height}

    cases = []
    record_manifest = []
    for sample in samples:
        case_id = sample["id"]
        source_record = structured[case_id]
        candidate = source_record["candidate"]
        image_records = manifests[case_id]["audit"]["images"]
        messages = sample["messages"]
        if len(messages) != 2 or [m["role"] for m in messages] != ["user", "assistant"]:
            raise ValueError(f"Unexpected messages in {case_id}")
        question, response = messages[0]["content"], messages[1]["content"]
        if question.count("<image>") != len(image_records):
            raise ValueError(f"Image marker count mismatch in {case_id}")
        images = [copy_image(case_id, Path(item["local_path"]), item["caption"], item["types"].split("|"), item["sha256"]) for item in image_records]
        article_dir = source_root / PIPELINE / "reasoning_candidate_stage/articles" / case_id
        metadata = article_metadata(article_dir, candidate)
        if not metadata["sourceUrl"]:
            raise ValueError(f"Missing retained article URL for {case_id}")
        case = {
            "id": case_id, "title": sample["metadata"]["source_title"],
            "category": sample["metadata"]["category"], "license": sample["metadata"]["license"],
            **metadata, "question": question, **sections(response), "rawResponse": response,
            "language": "zh", "images": images, "english": None,
        }
        if case_id in english:
            variant = english[case_id]
            english_response = variant["training_response_cn"]
            english_images = [copy_image(case_id, Path(item["source_path"]), item["caption"], item["clinical_types"], item.get("source_sha256")) for item in variant["images_sent"]]
            case["english"] = {
                "question": variant["cot"]["question_cn"], **sections(english_response),
                "rawResponse": english_response, "images": english_images,
                "language": "en", "label": "Earlier English sample",
                "version": "qwen_cot_english_gold_samples_v1",
            }
        cases.append(case)
        record_manifest.append({
            "id": case_id, "question_sha256": sha256(question.encode("utf-8")),
            "response_sha256": sha256(response.encode("utf-8")),
            "images": [item["src"] for item in images],
            "english_images": [item["src"] for item in case["english"]["images"]] if case["english"] else [],
            "article_metadata_sha256": sha256((article_dir / "metadata.json").read_bytes()),
            "article_xml_sha256": sha256((article_dir / "source.xml").read_bytes()),
        })

    image_count = sum(len(case["images"]) for case in cases)
    text_only_ids = [case["id"] for case in cases if not case["images"]]
    if image_count != 95 or set(text_only_ids) != {"PMC6738723", "PMC11297549"}:
        raise ValueError("Unexpected image counts or text-only cases")
    payload = {
        "version": VERSION, "cases": cases, "caseCount": len(cases), "imageCount": image_count,
        "assetCount": len(assets), "englishVariantCount": len(english),
        "englishImageCount": sum(len(case["english"]["images"]) for case in cases if case["english"]),
        "textOnlyCount": len(text_only_ids), "textOnlyIds": text_only_ids,
        "categoryCounts": dict(sorted(Counter(case["category"] for case in cases).items())),
        "licenseCounts": dict(sorted(Counter(case["license"] for case in cases).items())),
        "languageNote": "The 47 original source samples retain their Chinese text. Three separately identified earlier English samples are also available, with their original image sets.",
    }
    data_js = "window.COT_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    if re.search(r"(?<![A-Za-z])[A-Za-z]:[\\/]|/fsx/homes/|@mbzuai|source_path|local_path|server_path", data_js):
        raise ValueError("A private source path or server identifier reached the public data")
    (output / "data.js").write_text(data_js, encoding="utf-8", newline="\n")
    public_manifest = {
        "version": VERSION, "builtAt": datetime.now(timezone.utc).isoformat(),
        "caseCount": len(cases), "primaryImageReferences": image_count,
        "englishVariantCount": len(english), "englishImageReferences": payload["englishImageCount"],
        "uniqueAssetCount": len(assets), "textOnlyIds": text_only_ids,
        "sourceFiles": [{"role": role, "name": path.name, "sha256": sha256(path.read_bytes())} for role, path in source_files.items()],
        "dataFile": {"name": "data.js", "sha256": sha256((output / "data.js").read_bytes())},
        "transformation": "Only whitelisted fields were packaged. Original questions, responses, section contents, and image bytes were preserved; no CoT was generated or translated.",
        "assets": [assets[key] for key in sorted(assets)], "cases": record_manifest,
    }
    (output / "data_manifest.json").write_text(json.dumps(public_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: payload[key] for key in ("version", "caseCount", "imageCount", "assetCount", "englishVariantCount", "englishImageCount", "textOnlyCount")}, indent=2))


if __name__ == "__main__":
    main()
