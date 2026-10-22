"""Preserve local catalog links when refreshing a test copy from an older backup.

This is deliberately separate from normal backup restoration, which must restore
exactly what its source contains. Only the two catalog link fields are merged.
"""

from collections import Counter
from typing import Any

from app.services.filamentdb_field_mapping import normalize_spool_image_file


def _external_ids(row: dict[str, Any]) -> dict[str, int | str]:
    custom = row.get('custom_fields') or {}
    if not isinstance(custom, dict):
        return {}
    identities: dict[str, int | str] = {}
    catalog = custom.get('filamentdb_id')
    external = custom.get('spoolman_external_id')
    if type(catalog) is int and catalog > 0:
        identities['filamandb'] = catalog
    if isinstance(external, str) and external.strip():
        identities['spoolman'] = external.strip()
    return identities


def _identities(row: dict[str, Any], manufacturers: dict[int, str]) -> set[tuple]:
    manufacturer = manufacturers.get(row.get('manufacturer_id'), '').strip().casefold()
    if not manufacturer:
        return set()
    keys = {(source, manufacturer, value) for source, value in _external_ids(row).items()}
    designation, material, diameter = (row.get(key) for key in ('designation', 'material_type', 'diameter_mm'))
    if designation and material and diameter:
        keys.add(('product', manufacturer, designation.strip().casefold(), material.strip().casefold(), diameter))
    return keys


def preserve_spool_profile_links(incoming: dict[str, Any], previous: dict[str, Any]) -> int:
    """Add missing links in-place for unique shared identities; incoming links win."""
    old_manufacturers = {m['id']: m['name'] for m in previous.get('manufacturers', [])}
    new_manufacturers = {m['id']: m['name'] for m in incoming.get('manufacturers', [])}
    old_rows = previous.get('filaments', [])
    new_rows = incoming.get('filaments', [])
    old_keys = [_identities(row, old_manufacturers) for row in old_rows]
    new_keys = [_identities(row, new_manufacturers) for row in new_rows]
    old_counts = Counter(key for keys in old_keys for key in keys)
    new_counts = Counter(key for keys in new_keys for key in keys)
    old_by_key = {key: index for index, keys in enumerate(old_keys) for key in keys}
    matches = [{old_by_key[key] for key in keys if old_counts[key] == new_counts[key] == 1} for keys in new_keys]
    claims = Counter(index for candidates in matches if len(candidates) == 1 for index in candidates)
    restored = 0
    for row, candidates in zip(new_rows, matches, strict=True):
        if len(candidates) != 1:
            continue
        if row.get('filamentdb_spool_profile_id') is not None or row.get('filamentdb_spool_image_file') is not None:
            continue
        index = next(iter(candidates))
        if claims[index] != 1:
            continue
        old = old_rows[index]
        old_external, new_external = _external_ids(old), _external_ids(row)
        if any(old_external[key] != new_external[key] for key in old_external.keys() & new_external.keys()):
            continue
        profile_id = old.get('filamentdb_spool_profile_id')
        try:
            image = normalize_spool_image_file(old.get('filamentdb_spool_image_file'))
        except ValueError:
            continue
        link = {}
        if type(profile_id) is int and profile_id > 0:
            link['filamentdb_spool_profile_id'] = profile_id
        if image is not None:
            link['filamentdb_spool_image_file'] = image
        if link:
            row.update(link)
            restored += 1
    return restored


if __name__ == '__main__':
    import argparse
    import json
    import os
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('previous', type=Path, help='Backup of the existing test copy (legacy JSON)')
    parser.add_argument('incoming', type=Path, help='Fresh source backup (legacy JSON)')
    parser.add_argument('output', type=Path, help='New merged backup; must not exist')
    args = parser.parse_args()
    previous = json.loads(args.previous.read_text())
    incoming = json.loads(args.incoming.read_text())
    count = preserve_spool_profile_links(incoming['data'], previous['data'])
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(incoming, stream, ensure_ascii=False)
    print(f'Preserved {count} spool-type links; source backup files unchanged.')
