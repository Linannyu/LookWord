#!/usr/bin/env python3
"""Convert dual-language Vision OCR JSONL into rich vocabulary JSON files."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


HEADING_RE = re.compile(
    r"^\s*(\d{1,4})\s*[\.．、,，:]\s*([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2})"
)
POS_RE = re.compile(
    r"^\s*((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|aux|modal|interj|phr|phrase)(?:\.|\b))\s*",
    re.I,
)
POS_ANY_RE = re.compile(
    r"\b((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|aux|modal|interj|phr|phrase)(?:\.[a-z])?)\.",
    re.I,
)
ASCII_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")


@dataclass(frozen=True)
class Boundary:
    index: int
    word: str
    page: int
    y: float
    confidence: float


SPECS = {
    "book400": {
        "title": "SAT 400词：例句、同义词与反义词",
        "source_pdf": "400词含例句&同反义词（25.12.15更新）-分享版.pdf",
        "range": (1, 400),
        "min_page": 21,
        "output": "400词含例句同反义词.json",
        "series": "SAT重点词汇400",
    },
    "day01_10": {
        "title": "机考SAT真题词汇2000（Day 1–10）",
        "source_pdf": "机考SAT真题词汇2000（Day1-10）-分享版.pdf",
        "range": (1, 800),
        "min_page": 1,
        "output": "机考SAT真题词汇2000_Day1-10.json",
        "series": "机考SAT真题词汇2000",
    },
    "day11_20": {
        "title": "机考SAT真题词汇2000（Day 11–20）",
        "source_pdf": "机考SAT真题词汇2000（Day11-20）-分享版.pdf",
        "range": (801, 1600),
        "min_page": 1,
        "output": "机考SAT真题词汇2000_Day11-20.json",
        "series": "机考SAT真题词汇2000",
    },
    "day21_26": {
        "title": "机考SAT真题词汇2000（Day 21–26）",
        "source_pdf": "机考SAT真题词汇2000（Day21-26）-分享版.pdf",
        "range": (1601, 2000),
        "min_page": 1,
        "output": "机考SAT真题词汇2000_Day21-26.json",
        "series": "机考SAT真题词汇2000",
    },
}

# A handful of headings are decorated or badly read even though their entry body is clear.
# Keeping the boundary explicit prevents the neighboring entry from swallowing any content.
BOUNDARY_OVERRIDES: dict[str, dict[int, tuple[str, int, float]]] = {
    "book400": {
        72: ("Substantiate", 60, 0.429),
        226: ("Derogate", 128, 0.392),
    },
    "day01_10": {
        215: ("Conceive", 78, 0.243),
        258: ("Vague", 95, 0.295),
    },
    "day11_20": {
        1036: ("Nuance", 79, 0.407),
    },
    "day21_26": {
        1907: ("Beweep", 115, 0.392),
    },
}

ENTRY_FIELD_OVERRIDES: dict[str, dict[int, dict[str, Any]]] = {
    "book400": {
        106: {
            "synonyms": ["Hinder", "Obstruct", "Delay", "Thwart", "Prevent", "Block", "Interfere", "Deter", "Stymie", "Hamper"],
            "synonyms_text": "Hinder; Obstruct; Delay; Thwart; Prevent; Block; Interfere; Deter; Stymie; Hamper",
        },
        111: {
            "antonyms": ["Unfavorably", "Inauspiciously", "Adversely", "Unsuccessfully", "Unfortunately", "Disadvantageously", "Unpromisingly", "Detrimentally", "Ill-fated", "Unpropitiously"],
            "antonyms_text": "Unfavorably; Inauspiciously; Adversely; Unsuccessfully; Unfortunately; Disadvantageously; Unpromisingly; Detrimentally; Ill-fated; Unpropitiously",
        },
        119: {
            "examples": [
                {"type": "字典例句", "english": "His links with the organization turned out to be, at best, tenuous.", "chinese": "他与该组织的关系充其量也只是微不足道的。"},
                {"type": "字典例句", "english": "the tenuous threads of a spider's web", "chinese": "蛛网上纤弱易断的丝线。"},
            ],
            "synonyms": ["Weak", "Fragile", "Flimsy", "Insignificant", "Subtle", "Slender", "Uncertain", "Meager", "Insubstantial", "Thin"],
            "synonyms_text": "Weak; Fragile; Flimsy; Insignificant; Subtle; Slender; Uncertain; Meager; Insubstantial; Thin",
            "antonyms": ["Conclusive"],
            "antonyms_text": "Conclusive",
        },
        140: {
            "examples": [
                {"type": "字典例句", "english": "His theory is based on rather scanty evidence.", "chinese": "他的理论基于相当少的证据。"},
                {"type": "字典例句", "english": "a scanty bikini", "chinese": "比基尼布料少得可怜。"},
            ]
        },
        145: {
            "examples": [
                {"type": "字典例句", "english": "They agglomerated many small pieces of research into a single large study.", "chinese": "他们将许多零散的研究整合成一项大型研究。"}
            ]
        },
        211: {
            "examples": [
                {"type": "字典例句", "english": "outbreaks of disease followed by periods of latency", "chinese": "疾病爆发后伴随潜伏期。"}
            ]
        },
        244: {
            "examples": [
                {"type": "字典例句", "english": "The job entails a lot of hard work.", "chinese": "这份工作需要付出大量辛勤劳动。"}
            ]
        },
        251: {
            "examples": [
                {"type": "字典例句", "english": "The police are planning sterner measures to combat crime.", "chinese": "警方拟采取更严厉的措施打击犯罪。"},
                {"type": "字典例句", "english": "a stern test of nerves", "chinese": "对意志力的严峻考验。"},
            ]
        },
        226: {
            "definitions": [
                {
                    "part_of_speech": "vt",
                    "chinese": "贬损；减少",
                    "english": "(formal) to state that something or somebody is without worth",
                }
            ]
        },
        280: {
            "antonyms": ["Pure", "Clean", "Respectable", "Honorable", "Noble", "Virtuous", "Immaculate", "Pristine", "Decent", "Unblemished"],
            "antonyms_text": "Pure; Clean; Respectable; Honorable; Noble; Virtuous; Immaculate; Pristine; Decent; Unblemished",
        },
        285: {
            "examples": [
                {"type": "字典例句", "english": "The accident was a salutary reminder of the dangers of climbing.", "chinese": "这次事故是一个发人深省的警示，提醒人们登山运动的危险性。"}
            ]
        },
        303: {
            "antonyms": ["Prepared", "Rehearsed", "Planned", "Scripted", "Practiced", "Premeditated", "Deliberate", "Studied", "Formal", "Orchestrated"],
            "antonyms_text": "Prepared; Rehearsed; Planned; Scripted; Practiced; Premeditated; Deliberate; Studied; Formal; Orchestrated",
        },
        363: {
            "synonyms": ["stealthy", "clandestine", "covert", "furtive", "sneaky", "undercover", "secretive", "concealed", "hidden", "underhanded"],
            "synonyms_text": "stealthy; clandestine; covert; furtive; sneaky; undercover; secretive; concealed; hidden; underhanded",
        },
        377: {
            "definitions": [
                {
                    "part_of_speech": "v",
                    "chinese": "偷窃（尤指轻微或秘密地）",
                    "english": "(formal) to obtain something without permission – often used humorously",
                }
            ]
        },
        382: {
            "definitions": [
                {
                    "part_of_speech": "v",
                    "chinese": "使混乱；使迷惑",
                    "english": "To confuse or muddle someone; to make something unclear or disordered.",
                }
            ]
        },
        385: {
            "definitions": [
                {"part_of_speech": "adj", "chinese": "精髓的；最完美的典范", "english": "being a perfect example of a particular type of person or thing"}
            ]
        },
        387: {
            "definitions": [
                {"part_of_speech": "n", "chinese": "偏袒；偏心；偏见", "english": "(disapproving) unfair support for one person, team, idea, etc."}
            ]
        },
    },
    "day01_10": {
        92: {
            "definitions": [
                {
                    "part_of_speech": "vt",
                    "chinese": "指责；训斥",
                    "english": "to express sharp disapproval or criticism of someone because of their behavior or actions",
                }
            ]
        }
    },
    "day11_20": {
        830: {
            "definitions": [
                {
                    "part_of_speech": "vi. & vt",
                    "chinese": "（因摩擦而）擦痛；擦伤；感到烦躁",
                    "english": "to become irritated or impatient; to make sore by rubbing",
                }
            ]
        }
    },
    "day21_26": {
        1862: {
            "definitions": [
                {"part_of_speech": "adj", "chinese": "热情洋溢的；兴高采烈的", "english": "overflowing with enthusiasm, excitement, or energy"}
            ]
        }
    },
}


def page_number(filename: str) -> int:
    found = re.findall(r"(\d+)", filename)
    return int(found[-1]) if found else 0


def load_pages(path: Path) -> list[dict[str, Any]]:
    pages = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    pages.sort(key=lambda page: page_number(page["file"]))
    return pages


def heading_from_text(text: str) -> tuple[int, str] | None:
    text = text.strip().replace("|", "I")
    match = HEADING_RE.match(text)
    if not match:
        return None
    word = re.sub(r"\s+", " ", match.group(2)).strip(" .,:;|-—")
    if not word or len(word) > 42:
        return None
    return int(match.group(1)), word


def find_boundaries(
    pages: list[dict[str, Any]], start: int, end: int, min_page: int
) -> tuple[dict[int, Boundary], dict[int, list[Boundary]]]:
    found: dict[int, list[Boundary]] = {}
    for page in pages:
        pageno = page_number(page["file"])
        if pageno < min_page:
            continue
        for stream_name, preference in (("enLines", 0.03), ("zhLines", 0.0)):
            for line in page.get(stream_name, []):
                candidates = [line.get("text", ""), *line.get("alternatives", [])]
                for rank, text in enumerate(candidates):
                    heading = heading_from_text(text)
                    if not heading:
                        continue
                    index, word = heading
                    if not start <= index <= end:
                        continue
                    confidence = float(line.get("confidence", 0)) + preference - rank * 0.02
                    found.setdefault(index, []).append(
                        Boundary(index, word, pageno, float(line["y"]), confidence)
                    )
                    break

    chosen: dict[int, Boundary] = {}
    for index, options in found.items():
        # Same page/y is the normal zh/en duplicate. Prefer confident English-first OCR.
        options.sort(key=lambda item: item.confidence, reverse=True)
        chosen[index] = options[0]
    return chosen, found


def is_noise(line: dict[str, Any]) -> bool:
    text = line.get("text", "").strip()
    y = float(line.get("y", 0))
    if y > 0.925 or y < 0.065:
        return True
    if not text or re.fullmatch(r"[\d\s口囗□•·.]+", text):
        return True
    folded = text.upper().replace(" ", "")
    return any(
        marker in folded
        for marker in ("AODEFEN", "HOENSAT", "好得分SAT", "更多备考资料获取", "原创备考资料", "原创各考", "1500+")
    )


def lines_for_boundary(
    pages_by_number: dict[int, dict[str, Any]],
    boundary: Boundary,
    following: Boundary | None,
    stream_name: str,
) -> list[dict[str, Any]]:
    last_page = following.page if following else max(pages_by_number)
    result: list[dict[str, Any]] = []
    for pageno in range(boundary.page, last_page + 1):
        page = pages_by_number.get(pageno)
        if not page:
            continue
        for line in page.get(stream_name, []):
            y = float(line["y"])
            if pageno == boundary.page and y >= boundary.y - 0.004:
                continue
            if following and pageno == following.page and y <= following.y + 0.004:
                continue
            if is_noise(line):
                continue
            result.append({**line, "page": pageno})
    return result


def ascii_ratio(text: str) -> float:
    useful = [char for char in text if not char.isspace()]
    if not useful:
        return 0.0
    return sum(char.isascii() and (char.isalpha() or char in "'’-,.;:()[]0123456789") for char in useful) / len(useful)


def nearest_english(zh_line: dict[str, Any], en_lines: list[dict[str, Any]]) -> dict[str, Any] | None:
    same_page = [line for line in en_lines if line["page"] == zh_line["page"]]
    if not same_page:
        return None
    best = min(
        same_page,
        key=lambda line: abs(float(line["y"]) - float(zh_line["y"]))
        + 0.18 * abs(float(line.get("x", 0)) - float(zh_line.get("x", 0))),
    )
    return best if abs(float(best["y"]) - float(zh_line["y"])) < 0.012 else None


def label_kind(text: str) -> str | None:
    compact = re.sub(r"\s+", "", text)
    if re.search(r"(?:真题|字典).{0,3}例[句向]", compact):
        return "dictionary_example" if "字典" in compact else "exam_example"
    if compact.startswith("中文") and re.search(r"例[句向]", compact):
        return "translation"
    if re.search(r"例[句向]", compact):
        return "example"
    if re.search(r"词根.{0,6}(?:记忆法|记忆)", compact):
        return "memory"
    if re.search(r"同源词.{0,8}(?:记忆|辅助)", compact):
        return "cognates"
    if re.search(r"同义[词均]", compact) or "Synonyms" in text:
        return "synonyms"
    if re.search(r"[反原]义词", compact) or "Antonyms" in text:
        return "antonyms"
    if re.search(r"中文.{0,3}[释作]义", compact):
        return "translation"
    return None


def strip_label(text: str) -> str:
    parts = re.split(r"[:：]", text, maxsplit=1)
    return parts[1].strip() if len(parts) == 2 else ""


def english_after_label(text: str) -> str:
    parts = re.split(r"[:：]", text, maxsplit=1)
    if len(parts) == 2 and len(ASCII_WORD_RE.findall(parts[1])) >= 3:
        body = parts[1].strip()
        return re.sub(r"^(The|A|An|In|On|When|While)\s+\1\b", r"\1", body, flags=re.I)
    match = re.search(r"\b(?:The|A|An|In|On|When|While|Although|Because|Since|To|By|Researchers?|Scientists?|Some|Many|This|These|Their|Its|He|She|They|We)\b.*", text)
    body = match.group(0).strip() if match else ""
    return re.sub(r"^(The|A|An|In|On|When|While)\s+\1\b", r"\1", body, flags=re.I)


def replace_parenthetical(zh_text: str, en_text: str) -> str:
    matches = re.findall(r"[（(]([^()（）]*[A-Za-z][^()（）]*)[)）]", en_text)
    if not matches:
        return zh_text
    english = max(matches, key=len).strip()
    if len(ASCII_WORD_RE.findall(english)) < 2:
        return zh_text
    if re.search(r"[（(][^()（）]*[A-Za-z][^()（）]*[)）]", zh_text):
        return re.sub(
            r"[（(][^()（）]*[A-Za-z][^()（）]*[)）]",
            f"({english})",
            zh_text,
            count=1,
        )
    return zh_text


def merged_lines(zh_lines: list[dict[str, Any]], en_lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    matched_english: set[tuple[int, float, float]] = set()
    for line in zh_lines:
        zh_text = line["text"].strip()
        english = nearest_english(line, en_lines)
        en_text = english["text"].strip() if english else ""
        if english:
            matched_english.add((english["page"], float(english["y"]), float(english.get("x", 0))))
        kind = label_kind(zh_text)
        merged = zh_text
        if kind in {"exam_example", "dictionary_example", "example"} and en_text:
            body = english_after_label(en_text)
            if body:
                prefix = "字典例句：" if kind == "dictionary_example" else "真题例句：" if kind == "exam_example" else "例句："
                merged = prefix + body
        elif not re.search(r"[\u3400-\u9fff]", zh_text) and ascii_ratio(zh_text) >= 0.72 and en_text and ascii_ratio(en_text) >= 0.72:
            merged = en_text
        elif en_text:
            merged = replace_parenthetical(zh_text, en_text)
        result.append({**line, "text": merged})
    for line in en_lines:
        identity = (line["page"], float(line["y"]), float(line.get("x", 0)))
        text = line["text"].strip()
        if identity in matched_english or ascii_ratio(text) < 0.72 or len(ASCII_WORD_RE.findall(text)) < 2:
            continue
        if heading_from_text(text) or is_noise(line):
            continue
        result.append({**line, "text": text})
    result.sort(key=lambda line: (line["page"], -float(line["y"]), float(line.get("x", 0))))
    return result


def clean_join(parts: Iterable[str]) -> str:
    text = " ".join(part.strip() for part in parts if part.strip())
    text = re.sub(r"\s+([,.;:!?，。；：！？])", r"\1", text)
    text = re.sub(r"([（(])\s+", r"\1", text)
    text = re.sub(r"\s+([）)])", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def split_definition(text: str) -> dict[str, str]:
    match = POS_RE.match(text)
    pos = match.group(1).rstrip(".").lower() if match else ""
    body = text[match.end():] if match else text
    trailing = re.search(r"[（(]+\s*((?:[（(]*\s*[A-Za-z]).*?)[）)]+\s*$", body)
    if trailing:
        english = re.sub(r"[（）()]", "", trailing.group(1)).strip()
        chinese = body[:trailing.start()]
    else:
        english_parts = re.findall(r"[（(]([^()（）]*[A-Za-z][^()（）]*)[)）]", body)
        english = clean_join(english_parts)
        chinese = re.sub(r"[（(][^()（）]*[A-Za-z][^()（）]*[)）]", "", body)
    if not re.search(r"[\u3400-\u9fff]", chinese) and re.search(r"[\u3400-\u9fff]", body):
        internal_pos = POS_ANY_RE.search(body)
        if internal_pos:
            pos = internal_pos.group(1).lower()
        chinese_chunks = re.findall(r"[\u3400-\u9fff][\u3400-\u9fff，、；：。·…\s]*", body)
        chinese = clean_join(chinese_chunks)
        english = re.sub(r"[\u3400-\u9fff][\u3400-\u9fff，、；：。·…\s]*", " ", body)
        english = POS_ANY_RE.sub(" ", english)
        english = clean_join([english.strip(" （）()")])
    if not english and len(ASCII_WORD_RE.findall(body)) >= 3:
        english_candidate = re.sub(r"[\u3400-\u9fff][\u3400-\u9fff，、；：。·…\s]*", " ", body)
        english_candidate = POS_ANY_RE.sub(" ", english_candidate)
        english = clean_join([english_candidate.strip(" （）()")])
    return {"part_of_speech": pos, "chinese": clean_join([chinese]), "english": english}


def parse_fields(lines: list[dict[str, Any]]) -> dict[str, Any]:
    definitions: list[list[str]] = [[]]
    blocks: list[dict[str, Any]] = []
    current_kind = "definition"
    current_type = ""

    for line in lines:
        text = line["text"].strip()
        kind = label_kind(text)
        if kind:
            orphan_parts: list[str] = []
            if kind in {"exam_example", "dictionary_example", "example"} and current_kind == "definition" and definitions[-1]:
                parts = definitions[-1]
                closing = max((i for i, part in enumerate(parts) if ")" in part or "）" in part), default=-1)
                split_at = closing + 1
                if 0 < split_at < len(parts) and any(ascii_ratio(part) > 0.72 for part in parts[split_at:]):
                    orphan_parts = parts[split_at:]
                    definitions[-1] = parts[:split_at]
            if kind == "translation" and current_kind == "definition" and definitions[-1]:
                parts = definitions[-1]
                closing = max((i for i, part in enumerate(parts) if ")" in part or "）" in part), default=-1)
                split_at = closing + 1
                if 0 < split_at < len(parts) and any(ascii_ratio(part) > 0.72 for part in parts[split_at:]):
                    blocks.append({"kind": "example", "type": "例句", "parts": parts[split_at:]})
                    definitions[-1] = parts[:split_at]
            current_kind = kind
            current_type = "字典例句" if kind == "dictionary_example" else "真题例句" if kind == "exam_example" else "例句" if kind == "example" else ""
            blocks.append({"kind": kind, "type": current_type, "parts": [*orphan_parts, strip_label(text)]})
            continue
        if POS_RE.match(text) and current_kind != "definition":
            current_kind = "definition"
            definitions.append([text])
            continue
        if current_kind == "definition":
            if not definitions[-1] or not POS_RE.match(text) or not POS_RE.match(definitions[-1][0]):
                definitions[-1].append(text)
            else:
                definitions.append([text])
        elif blocks:
            blocks[-1]["parts"].append(text)

    definition_objects = [split_definition(clean_join(parts)) for parts in definitions if clean_join(parts)]
    examples: list[dict[str, str]] = []
    memory: list[str] = []
    cognates_text: list[str] = []
    synonyms_text: list[str] = []
    antonyms_text: list[str] = []
    notes: list[str] = []

    for block in blocks:
        text = clean_join(block["parts"])
        if not text:
            continue
        if block["kind"] in {"exam_example", "dictionary_example", "example"}:
            if re.search(r"\bNot?\s*:", text, re.I) and "sentence" in text.lower():
                notes.append(text)
            else:
                examples.append({"type": block["type"], "english": text, "chinese": ""})
        elif block["kind"] == "translation":
            target = next((item for item in reversed(examples) if not item["chinese"]), None)
            if target:
                target["chinese"] = text
            else:
                notes.append("中文释义：" + text)
        elif block["kind"] == "memory":
            memory.append(text)
        elif block["kind"] == "cognates":
            cognates_text.append(text)
        elif block["kind"] == "synonyms":
            synonyms_text.append(text)
        elif block["kind"] == "antonyms":
            antonyms_text.append(text)

    def split_terms(texts: list[str]) -> list[str]:
        return [item.strip() for item in re.split(r"[,，;；]", clean_join(texts)) if item.strip()]

    return {
        "definitions": definition_objects,
        "examples": examples,
        "memory": memory,
        "cognates": split_terms(cognates_text),
        "cognates_text": clean_join(cognates_text),
        "synonyms": split_terms(synonyms_text),
        "synonyms_text": clean_join(synonyms_text),
        "antonyms": split_terms(antonyms_text),
        "antonyms_text": clean_join(antonyms_text),
        "notes": notes,
    }


def build_book(key: str, input_path: Path, output_dir: Path) -> dict[str, Any]:
    spec = SPECS[key]
    start, end = spec["range"]
    pages = load_pages(input_path)
    pages_by_number = {page_number(page["file"]): page for page in pages}
    chosen, all_candidates = find_boundaries(pages, start, end, spec["min_page"])
    for index, (word, page, y) in BOUNDARY_OVERRIDES.get(key, {}).items():
        chosen[index] = Boundary(index, word, page, y, 2.0)
    missing = [index for index in range(start, end + 1) if index not in chosen]
    duplicates = {index: options for index, options in all_candidates.items() if len({(o.page, round(o.y, 3)) for o in options}) > 1}

    ordered = [chosen[index] for index in sorted(chosen)]
    entries: list[dict[str, Any]] = []
    for position, boundary in enumerate(ordered):
        following = ordered[position + 1] if position + 1 < len(ordered) else None
        zh_lines = lines_for_boundary(pages_by_number, boundary, following, "zhLines")
        en_lines = lines_for_boundary(pages_by_number, boundary, following, "enLines")
        merged = merged_lines(zh_lines, en_lines)
        fields = parse_fields(merged)
        fields.update(ENTRY_FIELD_OVERRIDES.get(key, {}).get(boundary.index, {}))
        if key == "book400" and not fields["antonyms"] and len(fields["synonyms"]) > 10:
            fields["antonyms"] = fields["synonyms"][10:]
            fields["antonyms_text"] = "; ".join(fields["antonyms"])
            fields["synonyms"] = fields["synonyms"][:10]
            fields["synonyms_text"] = "; ".join(fields["synonyms"])
        last_page = following.page if following else max(pages_by_number)
        if following and following.page == boundary.page:
            source_pages = [boundary.page]
        else:
            source_pages = list(range(boundary.page, last_page + 1))

        zh = "；".join(item["chinese"] for item in fields["definitions"] if item["chinese"])
        en = "; ".join(item["english"] for item in fields["definitions"] if item["english"])
        pos = ", ".join(dict.fromkeys(item["part_of_speech"] for item in fields["definitions"] if item["part_of_speech"]))
        entries.append(
            {
                "index": boundary.index,
                "word": boundary.word,
                "phonetic": "",
                "part_of_speech": pos,
                "zh": zh,
                "en": en,
                **fields,
                "source": {"pdf": spec["source_pdf"], "pages": source_pages},
                "raw": {
                    "merged_lines": [line["text"] for line in merged],
                    "zh_ocr_lines": [line["text"] for line in zh_lines],
                    "en_ocr_lines": [line["text"] for line in en_lines],
                },
            }
        )

    output = {
        "schema_version": "2.0",
        "title": spec["title"],
        "series": spec["series"],
        "source_pdf": spec["source_pdf"],
        "expected_range": [start, end],
        "entry_count": len(entries),
        "ocr_notice": "内容由中英文双通道 OCR 转换；raw 字段保留逐行结果，source.pages 保留原 PDF 页码。",
        "words": entries,
    }
    output_path = output_dir / spec["output"]
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report = {
        "key": key,
        "output": str(output_path),
        "entries": len(entries),
        "expected": end - start + 1,
        "missing": missing,
        "duplicate_candidate_indices": sorted(duplicates),
        "first": entries[0]["index"] if entries else None,
        "last": entries[-1]["index"] if entries else None,
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ocr-dir", type=Path, default=Path("tmp/pdfs/ocr"))
    parser.add_argument("--output-dir", type=Path, default=Path("word_list"))
    parser.add_argument("--report", type=Path, default=Path("tmp/pdfs/conversion_report.json"))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    reports = []
    for key in SPECS:
        reports.append(build_book(key, args.ocr_dir / f"{key}.jsonl", args.output_dir))
    args.report.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
