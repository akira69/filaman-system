"""Fetch the maintainer catalog and verify release archives."""

from hashlib import sha256
from typing import Annotated, Self

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.services.plugin_service import MAX_ZIP_SIZE, PluginInstallError

CATALOG_URL = "https://raw.githubusercontent.com/Fire-Devils/filaman-system/main/plugin-catalog/catalog-v1.json"
PLUGIN_DOWNLOAD_ROOT = "https://www.filaman.app/plugins/"
MAX_CATALOG_SIZE = 256 * 1024

PluginKey = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{2,49}$")]
ReleaseVersion = Annotated[str, Field(pattern=r"^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$")]
ReleaseDigest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class CatalogRelease(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plugin_key: PluginKey
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=500)
    publisher: str = Field(min_length=1, max_length=100)
    repository_url: str = Field(pattern=r"^https://github\.com/[\w.-]+/[\w.-]+$", max_length=250)
    version: ReleaseVersion
    min_filaman_version: ReleaseVersion
    zip_path: str = Field(max_length=100)
    sha256: ReleaseDigest

    @model_validator(mode="after")
    def validate_zip_path(self) -> Self:
        filename = f"{self.plugin_key}-{self.version}.zip"
        if self.zip_path not in (filename, f"catalog/{filename}"):
            raise ValueError("ZIP path must match the plugin key and version")
        return self

    @property
    def release_id(self) -> str:
        return sha256(self.model_dump_json().encode()).hexdigest()

    @property
    def download_url(self) -> str:
        return PLUGIN_DOWNLOAD_ROOT + self.zip_path


class CatalogSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plugin_key: PluginKey
    version: ReleaseVersion
    release_id: ReleaseDigest


_CATALOG = TypeAdapter(list[CatalogRelease])


def parse_catalog(data: bytes) -> dict[str, CatalogRelease]:
    if len(data) > MAX_CATALOG_SIZE:
        raise ValueError("Catalog exceeds size limit")
    entries = _CATALOG.validate_json(data)
    releases = {entry.plugin_key: entry for entry in entries}
    if len(releases) != len(entries):
        raise ValueError("Duplicate plugin key")
    return releases


async def _download(url: str, limit: int) -> bytes:
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                if len(data) + len(chunk) > limit:
                    raise ValueError("Download exceeds size limit")
                data.extend(chunk)
    return bytes(data)


async def fetch_catalog() -> dict[str, CatalogRelease]:
    return parse_catalog(await _download(CATALOG_URL, MAX_CATALOG_SIZE))


async def fetch_verified_zip(release: CatalogRelease) -> bytes:
    try:
        data = await _download(release.download_url, MAX_ZIP_SIZE)
    except (httpx.HTTPError, ValueError) as exc:
        raise PluginInstallError("Could not download the plugin ZIP.", "download_failed") from exc
    if sha256(data).hexdigest() != release.sha256:
        raise PluginInstallError("Plugin ZIP checksum does not match the catalog.", "checksum_mismatch")
    return data
