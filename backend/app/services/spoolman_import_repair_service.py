"""Preview and repair legacy values created by the Spoolman importer."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas_system_extra_field import validate_field_type_config
from app.core.cache import response_cache
from app.models.filament import Filament
from app.models.spool import Spool
from app.models.system_extra_field import SystemExtraField
from app.services.spoolman_extra_field_mapping import (
    SpoolmanFieldError,
    convert_spoolman_value,
    definitions_compatible,
    fingerprint,
    infer_definition,
    map_spoolman_definition,
)


class SpoolmanRepairError(ValueError):
    """The requested repair cannot be executed safely."""

    def __init__(self, message: str, code: str = "repair_error"):
        super().__init__(message)
        self.code = code


class SpoolmanImportRepairService:
    """Safely promote nested legacy Spoolman values into native fields."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def preview(
        self,
        mode: str,
        source_definitions: dict[str, list[dict[str, Any]]] | None = None,
    ) -> dict[str, Any]:
        if mode not in {"server", "offline"}:
            raise SpoolmanRepairError(
                "mode must be 'server' or 'offline'", "invalid_mode"
            )

        rows = await self._legacy_rows()
        grouped: dict[tuple[str, str], list[Any]] = defaultdict(list)
        for row in rows:
            for key, value in row["nested"].items():
                grouped[(row["target_type"], key)].append(value)

        mappings = (
            self._source_mappings(source_definitions or {})
            if mode == "server"
            else [
                infer_definition(target, key, values)
                for (target, key), values in sorted(grouped.items())
            ]
        )
        mappings = [
            item for item in mappings if (item["target_type"], item["key"]) in grouped
        ]
        mappings_by_key = {
            (item["target_type"], item["key"]): item for item in mappings
        }
        existing = await self._existing_definitions()

        for item in mappings:
            local = existing.get((item["target_type"], item["key"]))
            item["existing"] = local is not None
            item["status"] = (
                "conflict"
                if local is not None and not definitions_compatible(item, local)
                else "ready"
            )
            item.setdefault(
                "confidence", "authoritative" if mode == "server" else "low"
            )
            samples = item.get(
                "samples",
                grouped.get((item["target_type"], item["key"]), [])[:5],
            )
            item["samples"] = [self._preview_sample(value) for value in samples[:5]]
            item["occurrences"] = len(
                grouped.get((item["target_type"], item["key"]), [])
            )

        counts = defaultdict(int)
        examples: list[dict[str, Any]] = []
        for row in rows:
            for key, raw in row["nested"].items():
                mapping = mappings_by_key.get((row["target_type"], key))
                reason = self._classify(row["custom_fields"], key, raw, mapping)
                counts[reason] += 1
                if reason != "promotable" and len(examples) < 50:
                    examples.append(
                        {
                            "target_type": row["target_type"],
                            "entity_id": row["entity_id"],
                            "spoolman_id": row["custom_fields"].get("spoolman_id"),
                            "key": key,
                            "reason": reason,
                        }
                    )

        snapshot = {
            "rows": [
                {
                    "target_type": row["target_type"],
                    "entity_id": row["entity_id"],
                    "spoolman_id": row["custom_fields"].get("spoolman_id"),
                    "nested": row["nested"],
                }
                for row in rows
            ],
            "source_definitions": source_definitions or {},
        }
        return {
            "mode": mode,
            "preview_fingerprint": fingerprint(snapshot),
            "summary": {
                "records_scanned": len(rows),
                "fields_found": len(grouped),
                "promotable": counts["promotable"],
                "collisions": counts["collision"],
                "invalid": counts["invalid"],
                "unresolved": counts["unresolved"] + counts["conflict"],
            },
            "mappings": mappings,
            "examples": examples,
        }

    async def execute(
        self,
        mode: str,
        expected_fingerprint: str,
        approved_mappings: list[dict[str, Any]],
        source_definitions: dict[str, list[dict[str, Any]]] | None = None,
    ) -> dict[str, Any]:
        current = await self.preview(mode, source_definitions)
        if current["preview_fingerprint"] != expected_fingerprint:
            raise SpoolmanRepairError(
                "Stored values or source definitions changed; load a new preview.",
                "preview_changed",
            )

        selected = [self._validate_approved(item) for item in approved_mappings]

        current_keys = {
            (item["target_type"], item["key"]): item
            for item in current["mappings"]
            if item["status"] == "ready"
        }
        mappings: dict[tuple[str, str], dict[str, Any]] = {}
        for item in selected:
            identity = (item["target_type"], item["key"])
            if identity not in current_keys:
                raise SpoolmanRepairError(
                    f"Field {identity[0]}.{identity[1]} is not repairable.",
                    "invalid_mapping",
                )
            mappings[identity] = item

        definitions_created = await self._create_definitions(mappings.values())
        values_promoted = 0
        records_updated = 0
        values_preserved = 0
        report: list[dict[str, Any]] = []

        for row in await self._legacy_rows(include_model=True):
            custom = dict(row["custom_fields"])
            nested = dict(row["nested"])
            changed = False
            for key, raw in list(nested.items()):
                mapping = mappings.get((row["target_type"], key))
                if mapping is None or key in custom:
                    values_preserved += 1
                    continue
                try:
                    custom[key] = self._convert_approved(raw, mapping)
                except SpoolmanFieldError:
                    values_preserved += 1
                    continue
                del nested[key]
                changed = True
                values_promoted += 1
            if not changed:
                continue
            if nested:
                custom["spoolman_extra"] = nested
            else:
                custom.pop("spoolman_extra", None)
            row["model"].custom_fields = custom
            records_updated += 1
            if len(report) < 100:
                report.append(
                    {
                        "target_type": row["target_type"],
                        "entity_id": row["entity_id"],
                        "spoolman_id": custom.get("spoolman_id"),
                    }
                )

        await self.db.commit()
        for target in {item["target_type"] for item in mappings.values()}:
            response_cache.delete(f"extra_fields:{target}:all")
        if mappings:
            response_cache.delete("extra_fields:all:all")

        return {
            "definitions_created": definitions_created,
            "records_updated": records_updated,
            "values_promoted": values_promoted,
            "values_preserved": values_preserved,
            "report": report,
        }

    async def _legacy_rows(self, include_model: bool = False) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for target_type, model in (("filament", Filament), ("spool", Spool)):
            result = await self.db.execute(select(model))
            for entity in result.scalars():
                custom = entity.custom_fields
                if not isinstance(custom, dict) or custom.get("spoolman_id") is None:
                    continue
                nested = custom.get("spoolman_extra")
                if not isinstance(nested, dict) or not nested:
                    continue
                row = {
                    "target_type": target_type,
                    "entity_id": entity.id,
                    "custom_fields": custom,
                    "nested": nested,
                }
                if include_model:
                    row["model"] = entity
                rows.append(row)
        return rows

    async def _existing_definitions(self) -> dict[tuple[str, str], SystemExtraField]:
        result = await self.db.execute(select(SystemExtraField))
        return {(item.target_type, item.key): item for item in result.scalars()}

    @staticmethod
    def _preview_sample(value: Any) -> Any:
        """Bound user-facing samples without changing the repair fingerprint."""
        if isinstance(value, str) and len(value) > 200:
            return f"{value[:197]}..."
        if isinstance(value, (dict, list)):
            encoded = json.dumps(value, separators=(",", ":"), default=str)
            if len(encoded) > 200:
                return f"{encoded[:197]}..."
        return value

    def _source_mappings(
        self, definitions: dict[str, list[dict[str, Any]]]
    ) -> list[dict[str, Any]]:
        mappings: list[dict[str, Any]] = []
        for target_type in ("filament", "spool"):
            for definition in definitions.get(target_type, []):
                try:
                    mappings.append(map_spoolman_definition(definition, target_type))
                except SpoolmanFieldError:
                    continue
        return sorted(
            mappings, key=lambda item: (item["target_type"], item["order"], item["key"])
        )

    @staticmethod
    def _classify(
        custom: dict[str, Any],
        key: str,
        raw: Any,
        mapping: dict[str, Any] | None,
    ) -> str:
        if key in custom:
            return "collision"
        if mapping is None or mapping.get("confidence") == "unresolved":
            return "unresolved"
        if mapping.get("status") == "conflict":
            return "conflict"
        try:
            SpoolmanImportRepairService._convert_approved(raw, mapping)
        except SpoolmanFieldError:
            return "invalid"
        return "promotable"

    @staticmethod
    def _validate_approved(item: dict[str, Any]) -> dict[str, Any]:
        target = item.get("target_type")
        key = item.get("key")
        label = item.get("label")
        field_type = item.get("field_type")
        if (
            target not in {"filament", "spool"}
            or not isinstance(key, str)
            or not re.fullmatch(r"[A-Za-z0-9_]{1,100}", key)
            or not isinstance(label, str)
            or not label.strip()
            or len(label.strip()) > 200
        ):
            raise SpoolmanRepairError(
                "Approved mapping has an invalid identity.", "invalid_mapping"
            )
        if field_type not in {
            "text",
            "number",
            "range",
            "dropdown",
            "checkbox",
            "date",
            "datetime",
            "url",
            "multiselect",
            "textarea",
        }:
            raise SpoolmanRepairError(
                "Approved mapping has an invalid type.", "invalid_mapping"
            )
        options = item.get("options")
        config = item.get("config")
        default_value = item.get("default_value")
        if options is not None and (
            not isinstance(options, list)
            or not all(isinstance(option, str) for option in options)
        ):
            raise SpoolmanRepairError(
                "Approved mapping has invalid options.", "invalid_mapping"
            )
        if config is not None and not isinstance(config, dict):
            raise SpoolmanRepairError(
                "Approved mapping has invalid config.", "invalid_mapping"
            )
        if default_value is not None and not isinstance(default_value, str):
            raise SpoolmanRepairError(
                "Approved mapping has an invalid default.", "invalid_mapping"
            )
        try:
            validate_field_type_config(field_type, options, config)
        except ValueError as exc:
            raise SpoolmanRepairError(str(exc), "invalid_mapping") from exc
        return {
            "target_type": target,
            "key": key,
            "label": label.strip() or key,
            "field_type": field_type,
            "options": options,
            "config": config,
            "default_value": default_value,
            "source_field_type": item.get("source_field_type"),
        }

    async def _create_definitions(self, mappings: Any) -> int:
        existing = await self._existing_definitions()
        created = 0
        for item in mappings:
            identity = (item["target_type"], item["key"])
            if identity in existing:
                if not definitions_compatible(item, existing[identity]):
                    raise SpoolmanRepairError(
                        f"Field {identity[0]}.{identity[1]} now conflicts.",
                        "field_conflict",
                    )
                continue
            definition = SystemExtraField(
                target_type=item["target_type"],
                key=item["key"],
                label=item["label"],
                field_type=item["field_type"],
                options=item.get("options"),
                config=item.get("config"),
                default_value=item.get("default_value"),
                source=None,
            )
            self.db.add(definition)
            existing[identity] = definition
            created += 1
        await self.db.flush()
        return created

    @staticmethod
    def _convert_approved(raw: Any, mapping: dict[str, Any]) -> Any:
        source_type = mapping.get("source_field_type")
        native_type = mapping["field_type"]
        if native_type in {"text", "textarea", "url", "date"}:
            source_type = "text"
        elif native_type == "datetime":
            source_type = "datetime"
        elif native_type == "number" and source_type not in {"integer", "float"}:
            source_type = (
                "integer"
                if (mapping.get("config") or {}).get("decimal_places") == 0
                else "float"
            )
        elif native_type == "range" and source_type not in {
            "integer_range",
            "float_range",
        }:
            source_type = (
                "integer_range"
                if (mapping.get("config") or {}).get("decimal_places") == 0
                else "float_range"
            )
        elif native_type == "checkbox":
            source_type = "boolean"
        elif native_type in {"dropdown", "multiselect"}:
            source_type = "choice"
        return convert_spoolman_value(
            raw,
            source_type,
            mapping.get("options"),
            native_type == "multiselect" if source_type == "choice" else None,
        )
