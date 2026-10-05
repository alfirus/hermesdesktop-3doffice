"""
Office 3D — live agent office for the Hermes Desktop.

Unified plugin package backend (mounted at /api/plugins/office3d/ when the
plugin is in `plugins.enabled`). Read-only over the fleet's real state:

  * profiles/<name>/state.db  — session recency, recent tool calls, tokens
  * <hermes-root>/kanban.db   — what each agent is working on / blocked by

Nothing here mutates any ledger. Numbers are observations, not promises.
"""

import base64
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter

router = APIRouter()

_TZ_OFFSET = 8 * 3600  # MYT (UTC+8)

# Org roster. Frontend owns the desk layout; this owns the truth about status.
AGENTS: Tuple[str, ...] = (
    "sofia", "syafiqah", "naura", "rina", "maisarah", "nafisah",
    "hana", "lina", "alya", "kira", "balqis", "elizabeth", "lisa",
    "aisyah", "nadia", "nurul", "farah", "shiela", "ain", "zara",
)

ROLES: Dict[str, str] = {
    "sofia": "CEO",
    "syafiqah": "Sales Manager",
    "naura": "CMO",
    "rina": "Project Manager",
    "maisarah": "Engineering Manager",
    "nafisah": "Finance & Accounts",
    "hana": "Visual Content Designer",
    "lina": "Tech Lead",
    "alya": "Security Engineer",
    "kira": "UI/UX Designer",
    "balqis": "QA Engineer",
    "elizabeth": "Full Stack Developer",
    "lisa": "Backend Developer",
    "aisyah": "DevOps Engineer",
    "nadia": "AI/ML Ops Engineer",
    "nurul": "Frontend Developer",
    "farah": "ML Engineer",
    "shiela": "GitHub Agent",
    "ain": "Tech Writer",
    "zara": "Workflow Operation Engineer",
}

# Human phrasing for the activity bubble, keyed by ledger tool_name prefix.
_TOOL_VERBS: Tuple[Tuple[str, str], ...] = (
    ("mcp__vectorizer", "searching memory"),
    ("session_search", "recalling history"),
    ("skill_view", "checking the playbook"),
    ("skill_manage", "updating a skill"),
    ("read_file", "reading files"),
    ("search_files", "searching files"),
    ("write_file", "writing files"),
    ("patch", "editing code"),
    ("execute_code", "running scripts"),
    ("terminal", "running commands"),
    ("web_search", "searching the web"),
    ("web_extract", "reading the web"),
    ("kanban_", "managing the board"),
    ("delegate_task", "delegating work"),
    ("browser_", "browsing"),
    ("vision_analyze", "looking at images"),
    ("memory", "updating memory"),
    ("text_to_speech", "making voice"),
    ("clarify", "asking the owner"),
)


def _hermes_root() -> Path:
    try:
        import hermes_constants  # type: ignore
        return Path(hermes_constants.get_default_hermes_root())
    except Exception:
        return Path(__file__).resolve().parents[4]


def _kanban_db() -> Optional[Path]:
    import os
    p = os.environ.get("HERMES_KANBAN_DB")
    if p and Path(p).is_file():
        return Path(p)
    root = _hermes_root() / "kanban.db"
    return root if root.is_file() else None


def _ts(v: Any) -> Optional[float]:
    """Ledger timestamps appear as unix floats or ISO-ish strings."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if f > 1e8 else None
    s = str(v)
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
                "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return time.mktime(time.strptime(s[:26], fmt)) - _TZ_OFFSET
        except ValueError:
            continue
    try:
        return float(s)
    except ValueError:
        return None


def _verb(tool_name: str) -> str:
    for prefix, phrase in _TOOL_VERBS:
        if tool_name.startswith(prefix):
            return phrase
    return "working"


def _agent_state(name: str, now: float, running: Dict[str, Any],
                 blocked: List[Dict[str, Any]], queue: int) -> Dict[str, Any]:
    """Derive one agent's live state from their session ledger."""
    db = _hermes_root() / "profiles" / name / "state.db"
    last_active: Optional[float] = None
    recent_tools: List[str] = []
    tokens_24h = 0
    activity_5m = 0
    profile_found = db.is_file()

    if profile_found:
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            row = con.execute(
                "SELECT MAX(last_activity_at) FROM sessions").fetchone()
            last_active = _ts(row[0]) if row else None
            # Recent tool activity (newest first) for the live bubble.
            rows = con.execute(
                "SELECT timestamp, tool_name FROM messages "
                "ORDER BY rowid DESC LIMIT 300").fetchall()
            # 24h token flow: messages rows carry no token_count in these
            # ledgers — the flow lives on sessions (input/output_tokens).
            row = con.execute(
                "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) "
                "FROM sessions WHERE last_activity_at >= ?",
                (now - 86400,)).fetchone()
            tokens_24h = int(row[0] or 0) if row else 0
            con.close()
            for ts_raw, tool in rows:
                t = _ts(ts_raw)
                if t is None:
                    continue
                if last_active is None or t > last_active:
                    last_active = t
                if (now - t) <= 300:
                    activity_5m += 1
                    if tool and len(recent_tools) < 6:
                        recent_tools.append(str(tool))
        except sqlite3.Error:
            pass

    state: Dict[str, Any] = {
        "name": name,
        "role": ROLES.get(name, "Agent"),
        "profile_found": profile_found,
        "current_task": running,
        "blocked_tasks": blocked[:2],
        "queue": queue,
        "tokens_24h": tokens_24h,
        "activity_5m": activity_5m,
        "last_active": time.strftime(
            "%Y-%m-%d %H:%M:%S", time.gmtime((last_active or now) + _TZ_OFFSET)),
        "recent_tools": recent_tools,
    }

    if running:
        state["status"] = "working"
        state["detail"] = "task: " + (running.get("title") or "")[:48]
    elif activity_5m > 0:
        state["status"] = "working"
        state["detail"] = _verb(recent_tools[0]) if recent_tools else "working"
    elif blocked:
        state["status"] = "blocked"
        state["detail"] = "blocked: " + (blocked[0].get("title") or "")[:48]
    elif last_active and (now - last_active) < 7200:
        state["status"] = "idle"
        state["detail"] = "on a break"
    else:
        state["status"] = "off"
        state["detail"] = "offline"
    return state


def _build_office() -> Dict[str, Any]:
    now = time.time()
    running: Dict[str, Any] = {}
    blocked: Dict[str, List[Dict[str, Any]]] = {n: [] for n in AGENTS}
    queue: Dict[str, int] = {n: 0 for n in AGENTS}

    kb = _kanban_db()
    if kb:
        try:
            con = sqlite3.connect(f"file:{kb}?mode=ro", uri=True)
            for tid, title, status, assignee in con.execute(
                    "SELECT id, title, status, assignee FROM tasks "
                    "WHERE assignee IS NOT NULL AND status IN "
                    "('running','blocked','ready','todo')"):
                if assignee not in queue:
                    continue
                item = {"id": tid, "title": title}
                if status == "running":
                    if assignee not in running:
                        running[assignee] = item
                elif status == "blocked":
                    blocked[assignee].append(item)
                else:
                    queue[assignee] += 1
            con.close()
        except sqlite3.Error:
            pass

    agents = [_agent_state(n, now, running.get(n), blocked[n], queue[n])
              for n in AGENTS]
    counts = {"working": 0, "idle": 0, "blocked": 0, "off": 0}
    for a in agents:
        counts[a["status"]] = counts.get(a["status"], 0) + 1

    return {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S",
                                      time.gmtime(now + _TZ_OFFSET)),
        "timezone": "MYT (UTC+8)",
        "agents": agents,
        "counts": counts,
        "notes": [
            "Status is derived from real signals only: session activity in the "
            "profile ledgers (state.db) and task state in the kanban DB.",
            "'working' = running kanban task or tool activity within 5 minutes; "
            "'blocked' = a blocked task assigned; 'idle' = active within 2 hours; "
            "otherwise 'off'.",
            "Avatar photos are the profiles' canonical persona photos "
            "(profiles/<name>/assets/avatar.png).",
        ],
    }


@router.get("/office")
def office() -> Dict[str, Any]:
    return _build_office()


@router.get("/avatars")
def avatars() -> Dict[str, str]:
    """Persona photos as data URLs (fetched once by the page)."""
    out: Dict[str, str] = {}
    for name in AGENTS:
        p = _hermes_root() / "profiles" / name / "assets" / "avatar.png"
        if p.is_file():
            try:
                out[name] = ("data:image/png;base64,"
                             + base64.b64encode(p.read_bytes()).decode("ascii"))
            except OSError:
                continue
    return out
