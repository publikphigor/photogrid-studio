from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch: pytest.MonkeyPatch) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)
        monkeypatch.setenv("CACHE_DIR", str(path))
        # Reload settings module-level singleton.
        from photogrid import config

        config.settings = config.Settings()
        os.environ["CACHE_DIR"] = str(path)
        yield path
