#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import ZipFile

PROJECT_ROOT = Path(__file__).resolve().parents[3]
LOCALES_ROOT = PROJECT_ROOT / 'apps/mobile/src/i18n/locales'
WORKBOOK_PATH = PROJECT_ROOT / 'docs/localization/mobile-i18n.xlsx'
LOCALES = ('en', 'zh-Hans', 'zh-Hant')
REQUIRED_HEADERS = ('section', 'full_key', 'relative_key', 'en', 'zh-Hans', 'zh-Hant')
XML_NS = {
    'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
    'docRel': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}


def load_locale_sections(locale: str) -> dict[str, Any]:
    locale_dir = LOCALES_ROOT / locale
    if not locale_dir.exists():
        raise SystemExit(f'Missing locale directory: {locale_dir}')

    sections: dict[str, Any] = {}
    for path in sorted(locale_dir.glob('*.json')):
        sections[path.stem] = json.loads(path.read_text(encoding='utf-8'))

    if not sections:
        raise SystemExit(f'No locale sections found in {locale_dir}')

    return sections


def flatten(prefix: str, value: Any) -> list[tuple[str, str]]:
    if isinstance(value, dict):
        rows: list[tuple[str, str]] = []
        for key, child in value.items():
            next_prefix = f'{prefix}.{key}' if prefix else key
            rows.extend(flatten(next_prefix, child))
        return rows

    return [(prefix, '' if value is None else str(value))]


def existing_key_map() -> dict[str, set[str]]:
    baseline_sections = load_locale_sections('en')
    return {
        section: {key for key, _ in flatten('', content)}
        for section, content in baseline_sections.items()
    }


def parse_shared_strings(workbook: ZipFile) -> list[str]:
    if 'xl/sharedStrings.xml' not in workbook.namelist():
        return []

    root = ElementTree.fromstring(workbook.read('xl/sharedStrings.xml'))
    values: list[str] = []
    for item in root.findall('main:si', XML_NS):
        values.append(extract_inline_text(item))
    return values


def extract_inline_text(node: ElementTree.Element) -> str:
    parts: list[str] = []
    for text_node in node.findall('.//main:t', XML_NS):
        parts.append(text_node.text or '')
    return ''.join(parts)


def column_index(cell_ref: str) -> int:
    letters = ''.join(char for char in cell_ref if char.isalpha())
    index = 0
    for char in letters:
        index = index * 26 + (ord(char.upper()) - 64)
    return index


def cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get('t')

    if cell_type == 'inlineStr':
        inline = cell.find('main:is', XML_NS)
        return '' if inline is None else extract_inline_text(inline)

    value_node = cell.find('main:v', XML_NS)
    raw = '' if value_node is None or value_node.text is None else value_node.text

    if cell_type == 's':
        if not raw:
            return ''
        index = int(raw)
        if index >= len(shared_strings):
            raise SystemExit(f'Shared string index out of range: {index}')
        return shared_strings[index]

    if cell_type == 'str':
        return raw

    return raw


def workbook_sheet_path(workbook: ZipFile, sheet_name: str = 'translations') -> str:
    workbook_root = ElementTree.fromstring(workbook.read('xl/workbook.xml'))
    sheet_id: str | None = None
    for sheet in workbook_root.findall('main:sheets/main:sheet', XML_NS):
        if sheet.attrib.get('name') == sheet_name:
            sheet_id = sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            break

    if sheet_id is None:
        first_sheet = workbook_root.find('main:sheets/main:sheet', XML_NS)
        if first_sheet is None:
            raise SystemExit('Workbook does not contain any worksheets')
        sheet_id = first_sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        if sheet_id is None:
            raise SystemExit('Worksheet relationship id is missing')

    rel_root = ElementTree.fromstring(workbook.read('xl/_rels/workbook.xml.rels'))
    target: str | None = None
    for relationship in rel_root.findall('rel:Relationship', XML_NS):
        if relationship.attrib.get('Id') == sheet_id:
            target = relationship.attrib.get('Target')
            break

    if target is None:
        raise SystemExit(f'Worksheet target not found for relationship {sheet_id}')

    return f'xl/{target}'


def parse_sheet_rows(workbook: ZipFile, sheet_path: str, shared_strings: list[str]) -> list[dict[int, str]]:
    sheet_root = ElementTree.fromstring(workbook.read(sheet_path))
    rows: list[dict[int, str]] = []

    for row in sheet_root.findall('main:sheetData/main:row', XML_NS):
        values: dict[int, str] = {}
        for cell in row.findall('main:c', XML_NS):
            cell_ref = cell.attrib.get('r')
            if not cell_ref:
                continue
            values[column_index(cell_ref)] = cell_value(cell, shared_strings)
        rows.append(values)

    return rows


def parse_workbook() -> list[dict[str, str]]:
    with ZipFile(WORKBOOK_PATH) as workbook:
        shared_strings = parse_shared_strings(workbook)
        sheet_path = workbook_sheet_path(workbook)
        raw_rows = parse_sheet_rows(workbook, sheet_path, shared_strings)

    if not raw_rows:
        raise SystemExit(f'Workbook is empty: {WORKBOOK_PATH}')

    header_row = raw_rows[0]
    headers = {index: value.strip() for index, value in header_row.items() if value.strip()}

    missing_headers = [header for header in REQUIRED_HEADERS if header not in headers.values()]
    if missing_headers:
        raise SystemExit(f'Missing required headers: {", ".join(missing_headers)}')

    column_by_header = {header: index for index, header in headers.items()}
    parsed_rows: list[dict[str, str]] = []

    for row_number, raw_row in enumerate(raw_rows[1:], start=2):
        row = {
            header: raw_row.get(column_by_header[header], '').strip()
            for header in REQUIRED_HEADERS
        }
        if not any(row.values()):
            continue

        if not row['section'] or not row['relative_key']:
            raise SystemExit(f'Row {row_number} is missing section or relative_key')

        parsed_rows.append(row)

    if not parsed_rows:
        raise SystemExit(f'No translation rows found in {WORKBOOK_PATH}')

    return parsed_rows


def collect_import_values(rows: list[dict[str, str]]) -> dict[str, dict[str, dict[str, str]]]:
    expected_keys = existing_key_map()
    collected = {
        locale: {section: {} for section in expected_keys}
        for locale in LOCALES
    }

    for row in rows:
        section = row['section']
        relative_key = row['relative_key']
        expected_full_key = f'{section}.{relative_key}'

        if section not in expected_keys:
            raise SystemExit(f'Unknown section in workbook: {section}')

        if relative_key not in expected_keys[section]:
            raise SystemExit(f'Unknown key in workbook: {section}.{relative_key}')

        if row['full_key'] and row['full_key'] != expected_full_key:
            raise SystemExit(
                f'Workbook full_key mismatch: expected {expected_full_key}, got {row["full_key"]}'
            )

        for locale in LOCALES:
            existing = collected[locale][section]
            if relative_key in existing:
                raise SystemExit(f'Duplicate workbook row for {section}.{relative_key}')
            existing[relative_key] = row[locale]

    for section, expected in expected_keys.items():
        for locale in LOCALES:
            actual = set(collected[locale][section].keys())
            if actual != expected:
                missing = sorted(expected - actual)
                extra = sorted(actual - expected)
                details: list[str] = []
                if missing:
                    details.append(f'missing={missing[:5]}')
                if extra:
                    details.append(f'extra={extra[:5]}')
                raise SystemExit(
                    f'Workbook key mismatch for {locale}/{section}.json'
                    + (f' ({", ".join(details)})' if details else '')
                )

    return collected


def rewrite_structure(template: Any, values: dict[str, str], prefix: str = '') -> Any:
    if isinstance(template, dict):
        return {
            key: rewrite_structure(
                child,
                values,
                f'{prefix}.{key}' if prefix else key,
            )
            for key, child in template.items()
        }

    return values[prefix]


def write_locale_files(import_values: dict[str, dict[str, dict[str, str]]]) -> int:
    row_count = 0
    for locale in LOCALES:
        locale_sections = load_locale_sections(locale)
        locale_dir = LOCALES_ROOT / locale
        for section, template in locale_sections.items():
            hydrated = rewrite_structure(template, import_values[locale][section])
            output_path = locale_dir / f'{section}.json'
            output_path.write_text(
                json.dumps(hydrated, ensure_ascii=False, indent=2) + '\n',
                encoding='utf-8',
            )
            row_count += len(import_values[locale][section])
    return row_count


def main() -> None:
    if not WORKBOOK_PATH.exists():
        raise SystemExit(f'Workbook not found: {WORKBOOK_PATH}')

    rows = parse_workbook()
    import_values = collect_import_values(rows)
    write_locale_files(import_values)

    print(
        f'Imported {len(rows)} translation rows from '
        f'{WORKBOOK_PATH.relative_to(PROJECT_ROOT)} into {len(LOCALES)} locales'
    )


if __name__ == '__main__':
    main()
