from copy import deepcopy

from app.services.spool_profile_links import preserve_spool_profile_links


def inventory(filament_id=3, name='Jade White', **extra):
    return {'manufacturers': [{'id': 1, 'name': 'Bambu Lab'}], 'filaments': [{
        'id': filament_id, 'manufacturer_id': 1, 'designation': name,
        'material_type': 'PLA Basic', 'diameter_mm': 1.75,
        'default_spool_weight_g': 250, **extra,
    }]}


def test_refresh_restores_unique_product_link_despite_renumbered_ids_without_changing_measurements():
    previous = inventory(filamentdb_spool_profile_id=732, filamentdb_spool_image_file='732.png')
    incoming = inventory(99, default_spool_weight_g=247)
    expected = deepcopy(incoming)
    assert preserve_spool_profile_links(incoming, previous) == 1
    expected['filaments'][0].update(filamentdb_spool_profile_id=732, filamentdb_spool_image_file='732.png')
    assert incoming == expected
    assert previous == inventory(filamentdb_spool_profile_id=732, filamentdb_spool_image_file='732.png')


def test_refresh_never_uses_database_ids_or_ambiguous_product_names():
    previous = inventory(filamentdb_spool_profile_id=732, filamentdb_spool_image_file='732.png')
    for incoming in [inventory(name='Red'), {'manufacturers': previous['manufacturers'], 'filaments': inventory()['filaments'] * 2}]:
        expected = deepcopy(incoming)
        assert preserve_spool_profile_links(incoming, previous) == 0
        assert incoming == expected
    previous['filaments'] *= 2
    assert preserve_spool_profile_links(inventory(), previous) == 0


def test_refresh_preserves_source_choices_and_only_copies_valid_link_fields():
    previous = inventory(filamentdb_spool_profile_id=732, filamentdb_spool_image_file='732.png')
    incoming = inventory(filamentdb_spool_profile_id=735, filamentdb_spool_image_file='735.png')
    expected = deepcopy(incoming)
    assert preserve_spool_profile_links(incoming, previous) == 0
    assert incoming == expected
    unsafe = inventory(filamentdb_spool_profile_id=-1, filamentdb_spool_image_file='../bad.png')
    assert preserve_spool_profile_links(inventory(), unsafe) == 0


def test_refresh_can_match_a_stable_external_identity_after_product_renaming():
    previous = inventory(custom_fields={'spoolman_external_id': 'bambulab_pla_jadewhite_1000_175_n'}, filamentdb_spool_profile_id=732)
    incoming = inventory(99, name='Jade White renamed', custom_fields=previous['filaments'][0]['custom_fields'])
    assert preserve_spool_profile_links(incoming, previous) == 1


def test_refresh_uses_namespaced_filamandb_identity_after_product_renaming():
    previous = inventory(custom_fields={'filamentdb_id': 47}, filamentdb_spool_profile_id=732)
    incoming = inventory(99, name='Renamed Jade', custom_fields={'filamentdb_id': 47})
    assert preserve_spool_profile_links(incoming, previous) == 1


def test_merge_command_writes_a_private_new_backup_and_never_replaces_existing_files(tmp_path):
    import json
    import stat
    import subprocess
    import sys
    from pathlib import Path

    old = tmp_path / 'old.json'
    incoming = tmp_path / 'incoming.json'
    output = tmp_path / 'merged.json'
    old.write_text(json.dumps({'data': inventory(filamentdb_spool_profile_id=732)}))
    incoming.write_text(json.dumps({'data': inventory()}))
    original = incoming.read_bytes()
    command = [sys.executable, '-m', 'app.services.spool_profile_links', str(old), str(incoming), str(output)]
    result = subprocess.run(command, check=False, cwd=Path(__file__).parents[1], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(output.read_text())['data']['filaments'][0]['filamentdb_spool_profile_id'] == 732
    assert stat.S_IMODE(output.stat().st_mode) == 0o600
    assert incoming.read_bytes() == original
    merged = output.read_bytes()
    assert subprocess.run(command, check=False, cwd=Path(__file__).parents[1], capture_output=True).returncode != 0
    assert output.read_bytes() == merged


def test_refresh_uses_shared_identity_when_local_catalog_enrichment_is_missing_from_source():
    previous = inventory(custom_fields={'filamentdb_id': 47, 'spoolman_external_id': 'bambu_white'}, filamentdb_spool_profile_id=732)
    incoming = inventory(99, name='Renamed white', custom_fields={'spoolman_external_id': 'bambu_white'})
    assert preserve_spool_profile_links(incoming, previous) == 1
    # Same human name cannot override an explicitly conflicting external identity.
    conflict = inventory(custom_fields={'filamentdb_id': 48, 'spoolman_external_id': 'bambu_white'})
    assert preserve_spool_profile_links(conflict, previous) == 0


def test_refresh_does_not_copy_one_old_link_to_two_incoming_records_via_different_keys():
    previous = inventory(custom_fields={'filamentdb_id': 47, 'spoolman_external_id': 'bambu_white'}, filamentdb_spool_profile_id=732)
    incoming = inventory(custom_fields={'filamentdb_id': 47})
    incoming['filaments'] += inventory(99, custom_fields={'spoolman_external_id': 'bambu_white'})['filaments']
    expected = deepcopy(incoming)
    assert preserve_spool_profile_links(incoming, previous) == 0
    assert incoming == expected
