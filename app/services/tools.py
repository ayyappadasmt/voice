"""
Agentic tools the voice assistant can call to execute work autonomously.

Each tool has:
  - a Gemini function declaration (schema sent to the Live API), and
  - a Python executor that performs the work and updates the shared store.

The executors here simulate realistic lead sourcing and a LinkedIn outreach
campaign so the platform works end to end. Replace the bodies with real
integrations (data providers, LinkedIn APIs, CRM) without touching the
declarations or the agent bridge.
"""
from __future__ import annotations

import random
from typing import Any, Callable

from app.services.jobs import new_id, now, store

# ── Sample data used to synthesise believable leads ──────────────────────────
_FIRST = [
    "Arjun", "Anjali", "Rahul", "Meera", "Vishnu", "Lakshmi", "Nikhil", "Divya",
    "Sandeep", "Aishwarya", "Rohan", "Keerthi", "Akhil", "Sreelakshmi", "Vivek",
    "Parvathy", "Manu", "Gokul", "Aparna", "Hari",
]
_LAST = [
    "Nair", "Menon", "Pillai", "Kurup", "Varma", "Iyer", "Thomas", "George",
    "Mathew", "Joseph", "Krishnan", "Raj", "Mohan", "Das", "Warrier",
]
_CITIES = [
    "Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kollam",
    "Kannur", "Kottayam", "Palakkad", "Alappuzha", "Malappuram",
]
_TITLES = [
    "Founder & CEO", "Head of Marketing", "VP Sales", "Growth Lead",
    "Product Manager", "Operations Director", "CTO", "Business Development Manager",
    "Marketing Director", "Co-Founder",
]
_INDUSTRIES = [
    "SaaS", "FinTech", "E-commerce", "Logistics", "Healthcare Tech",
    "EdTech", "Tourism", "Manufacturing", "Agritech", "Retail",
]


def _slug(text: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "" for ch in text)


def find_leads(location: str = "Kerala", count: int = 50, industry: str | None = None,
               role: str | None = None) -> dict[str, Any]:
    """Synthesise qualified leads and persist them to the store."""
    count = max(1, min(int(count or 50), 500))
    rng = random.Random(f"{location}|{industry}|{role}|{count}")
    leads: list[dict[str, Any]] = []
    for _ in range(count):
        first = rng.choice(_FIRST)
        last = rng.choice(_LAST)
        company_word = rng.choice(
            ["Labs", "Technologies", "Ventures", "Digital", "Systems", "Analytics", "Works"]
        )
        company = f"{rng.choice(_LAST)} {company_word}"
        title = role or rng.choice(_TITLES)
        ind = industry or rng.choice(_INDUSTRIES)
        city = rng.choice(_CITIES)
        leads.append(
            {
                "id": new_id("lead"),
                "name": f"{first} {last}",
                "title": title,
                "company": company,
                "industry": ind,
                "location": f"{city}, {location}",
                "email": f"{_slug(first)}.{_slug(last)}@{_slug(company.split()[0])}.com",
                "linkedin": f"https://www.linkedin.com/in/{_slug(first)}{_slug(last)}",
                "score": rng.randint(70, 99),
                "created_at": now(),
            }
        )
    store.add_leads(leads)
    leads.sort(key=lambda lead: lead["score"], reverse=True)
    return {
        "status": "ok",
        "count": len(leads),
        "location": location,
        "industry": industry or "mixed",
        "summary": f"Found {len(leads)} qualified leads in {location}.",
        "sample": [
            {"name": leads[i]["name"], "title": leads[i]["title"], "company": leads[i]["company"]}
            for i in range(min(5, len(leads)))
        ],
    }


def start_linkedin_campaign(name: str | None = None, message: str | None = None,
                            audience: str | None = None, daily_limit: int = 25) -> dict[str, Any]:
    """Create a LinkedIn outreach campaign targeting the leads in the store."""
    targets = store.list_leads()
    campaign = {
        "id": new_id("camp"),
        "name": name or "LinkedIn Outreach",
        "channel": "linkedin",
        "status": "running",
        "audience": audience or "all qualified leads",
        "message": message
        or "Hi {first_name}, loved what you're building — would love to connect.",
        "daily_limit": max(1, min(int(daily_limit or 25), 100)),
        "target_count": len(targets),
        "sent": 0,
        "accepted": 0,
        "replied": 0,
        "created_at": now(),
    }
    store.add_campaign(campaign)
    return {
        "status": "ok",
        "campaign_id": campaign["id"],
        "target_count": campaign["target_count"],
        "summary": (
            f"Launched '{campaign['name']}' to {campaign['target_count']} leads "
            f"at {campaign['daily_limit']}/day."
        ),
    }


def get_campaign_status(campaign_id: str | None = None) -> dict[str, Any]:
    """Report progress for a campaign (advances the simulation on each call)."""
    campaigns = store.list_campaigns()
    if not campaigns:
        return {"status": "empty", "summary": "No campaigns running yet."}

    campaign = store.get_campaign(campaign_id) if campaign_id else campaigns[-1]
    if not campaign:
        return {"status": "not_found", "summary": "Campaign not found."}

    # Advance the simulation a little each time status is checked.
    remaining = campaign["target_count"] - campaign["sent"]
    if remaining > 0:
        step = min(remaining, max(1, campaign["daily_limit"] // 3))
        campaign["sent"] += step
        campaign["accepted"] = int(campaign["sent"] * 0.42)
        campaign["replied"] = int(campaign["accepted"] * 0.35)
        if campaign["sent"] >= campaign["target_count"]:
            campaign["status"] = "completed"
    return {
        "status": "ok",
        "campaign": campaign["name"],
        "state": campaign["status"],
        "sent": campaign["sent"],
        "accepted": campaign["accepted"],
        "replied": campaign["replied"],
        "target_count": campaign["target_count"],
        "summary": (
            f"{campaign['name']}: {campaign['sent']}/{campaign['target_count']} sent, "
            f"{campaign['accepted']} accepted, {campaign['replied']} replies."
        ),
    }


# ── Gemini function declarations (Live API tool schema) ──────────────────────
FUNCTION_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "find_leads",
        "description": (
            "Find and qualify B2B sales leads for a given location/industry/role. "
            "Use when the user asks to find, source, or build a list of leads/prospects."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "Region, e.g. 'Kerala'."},
                "count": {"type": "integer", "description": "How many leads to find."},
                "industry": {"type": "string", "description": "Target industry (optional)."},
                "role": {"type": "string", "description": "Target job title/role (optional)."},
            },
            "required": ["location"],
        },
    },
    {
        "name": "start_linkedin_campaign",
        "description": (
            "Start a LinkedIn outreach campaign to the leads already found. "
            "Use after leads exist, or when the user asks to start/launch a campaign."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Campaign name (optional)."},
                "message": {"type": "string", "description": "Connection/outreach message (optional)."},
                "audience": {"type": "string", "description": "Audience description (optional)."},
                "daily_limit": {"type": "integer", "description": "Max invites per day (optional)."},
            },
        },
    },
    {
        "name": "get_campaign_status",
        "description": "Get progress/metrics for a running campaign. Use when the user asks how a campaign is doing.",
        "parameters": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "Campaign id (optional; defaults to latest)."}
            },
        },
    },
]

EXECUTORS: dict[str, Callable[..., dict[str, Any]]] = {
    "find_leads": find_leads,
    "start_linkedin_campaign": start_linkedin_campaign,
    "get_campaign_status": get_campaign_status,
}


def execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    fn = EXECUTORS.get(name)
    if not fn:
        return {"status": "error", "summary": f"Unknown tool: {name}"}
    try:
        return fn(**(args or {}))
    except TypeError as exc:
        return {"status": "error", "summary": f"Bad arguments for {name}: {exc}"}
    except Exception as exc:  # pragma: no cover - defensive
        return {"status": "error", "summary": f"{name} failed: {exc}"}
