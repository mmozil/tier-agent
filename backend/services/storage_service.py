"""Storage service — Cloudflare R2 (S3-compatible) com fallback filesystem local."""

import logging
import os
import uuid as _uuid
from pathlib import Path

import boto3
from botocore.client import Config as BotoConfig

from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class StorageService:
    def __init__(self):
        self._client = None
        self._fallback_dir = Path("/tmp/tier-agent-uploads")
        self._fallback_dir.mkdir(parents=True, exist_ok=True)

    @property
    def client(self):
        if self._client is None and settings.r2_access_key_id and settings.r2_endpoint:
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.r2_endpoint,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                config=BotoConfig(signature_version="s3v4"),
                region_name="auto",
            )
        return self._client

    def upload(self, content: bytes, *, folder: str, filename: str | None = None, content_type: str = "application/octet-stream") -> dict:
        """Upload pra R2. Retorna { key, url }. Cai pra filesystem se R2 não configurado."""
        ext = ""
        if filename and "." in filename:
            ext = "." + filename.rsplit(".", 1)[1]
        key = f"{folder}/{_uuid.uuid4().hex}{ext}"

        if self.client and settings.r2_bucket_name:
            try:
                self.client.put_object(
                    Bucket=settings.r2_bucket_name,
                    Key=key,
                    Body=content,
                    ContentType=content_type,
                )
                url = f"{settings.r2_public_url.rstrip('/')}/{key}" if settings.r2_public_url else f"r2://{settings.r2_bucket_name}/{key}"
                return {"key": key, "url": url, "storage": "r2"}
            except Exception as e:
                logger.warning("R2 upload falhou, usando fallback local: %s", e)

        # Fallback filesystem
        path = self._fallback_dir / key.replace("/", "_")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {"key": key, "url": f"file://{path}", "storage": "filesystem"}

    def download(self, key: str) -> bytes:
        if self.client and settings.r2_bucket_name:
            try:
                obj = self.client.get_object(Bucket=settings.r2_bucket_name, Key=key)
                return obj["Body"].read()
            except Exception as e:
                logger.warning("R2 download falhou: %s", e)
        # Fallback
        path = self._fallback_dir / key.replace("/", "_")
        return path.read_bytes() if path.exists() else b""


storage = StorageService()
