from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    cache_dir: Path = Field(default=Path("/var/cache/photogrid"))
    max_upload_mb: int = 60
    max_pixels_mp: int = 200
    cache_ttl_hours: float = 24.0
    cache_sweep_minutes: float = 15.0
    vips_threshold_mp: int = 40
    log_level: str = "INFO"
    allowed_origins: str = "*"
    sentry_dsn: str | None = None

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def max_pixels(self) -> int:
        return self.max_pixels_mp * 1_000_000

    @property
    def origins(self) -> list[str]:
        if self.allowed_origins == "*":
            return ["*"]
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
