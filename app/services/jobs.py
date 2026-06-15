"""
In-memory stores for autonomously executed work (leads + campaigns).

This is intentionally simple so the platform demonstrates real end-to-end
execution without external paid APIs. Swap these for a database and real
integrations (LinkedIn / CRM) without changing the tool interface.
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.leads: dict[str, dict[str, Any]] = {}
        self.campaigns: dict[str, dict[str, Any]] = {}

    # --- leads ---
    def add_leads(self, leads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lock:
            for lead in leads:
                self.leads[lead["id"]] = lead
        return leads

    def list_leads(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.leads.values())

    # --- campaigns ---
    def add_campaign(self, campaign: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.campaigns[campaign["id"]] = campaign
        return campaign

    def get_campaign(self, campaign_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self.campaigns.get(campaign_id)

    def list_campaigns(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.campaigns.values())


# Single process-wide store (per-worker). Fine for a demo / single instance.
store = Store()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def now() -> str:
    return _now()
