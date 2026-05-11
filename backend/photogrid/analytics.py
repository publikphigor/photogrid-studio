from __future__ import annotations

from typing import Any

from posthog import Posthog

from .logging_setup import log

posthog_client: Posthog | None = None


def init_posthog(api_key: str | None, host: str) -> None:
    global posthog_client
    if not api_key:
        return
    posthog_client = Posthog(
        project_api_key=api_key,
        host=host,
        enable_exception_autocapture=True,
    )
    log.info("posthog.initialized", host=host)


def shutdown_posthog() -> None:
    if posthog_client is not None:
        posthog_client.flush()


def capture(event: str, distinct_id: str = "photogrid-anon", properties: dict[str, Any] | None = None) -> None:
    """Capture an event. No-ops when PostHog is not configured."""
    if posthog_client is None:
        return
    posthog_client.capture(
        distinct_id=distinct_id,
        event=event,
        properties={**(properties or {}), "$process_person_profile": False},
    )
