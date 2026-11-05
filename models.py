"""
models.py - Database schema reference and reusable data-access helpers.

The actual schema is created in app.init_db() to keep the project runnable
from a single entry point. This module documents the data model and provides
typed helper functions that app.py uses.
"""

# ---------------------------------------------------------------------------
# Schema overview
# ---------------------------------------------------------------------------
SCHEMA = {
    "users": {
        "id": "INTEGER PK",
        "name": "TEXT",
        "email": "TEXT UNIQUE",
        "password_hash": "TEXT",
        "role": "TEXT CHECK admin|learner",
        "active": "INTEGER 0|1",
        "created_at": "TEXT ISO-8601",
    },
    "activities": {
        "id": "INTEGER PK",
        "title": "TEXT",
        "description": "TEXT",
        "type": "TEXT (simulation)",
        "difficulty": "TEXT",
        "created_at": "TEXT",
        "active": "INTEGER",
    },
    "assignments": {
        "id": "INTEGER PK",
        "activity_id": "FK activities.id",
        "learner_id": "FK users.id",
        "assigned_at": "TEXT",
        "status": "TEXT assigned|completed",
        "UNIQUE": "(activity_id, learner_id)",
    },
    "results": {
        "id": "INTEGER PK",
        "assignment_id": "FK assignments.id",
        "learner_id": "FK users.id",
        "activity_id": "FK activities.id",
        "score": "INTEGER",
        "max_score": "INTEGER",
        "decisions": "TEXT JSON",
        "completed_at": "TEXT",
    },
    "audit_log": {
        "id": "INTEGER PK",
        "actor_id": "FK users.id (nullable)",
        "action": "TEXT",
        "details": "TEXT",
        "created_at": "TEXT",
    },
}


def row_to_dict(row):
    """Convert sqlite3.Row to plain dict."""
    return dict(row) if row else None


def rows_to_dicts(rows):
    """Convert a list of sqlite3.Row to a list of dicts."""
    return [dict(r) for r in rows]


def completion_rate(assigned: int, completed: int) -> float:
    """Return completion percentage rounded to one decimal place."""
    if assigned <= 0:
        return 0.0
    return round(completed / assigned * 100, 1)


def score_percentage(score: int, max_score: int) -> float:
    """Return a percentage score for a simulation result."""
    if not max_score:
        return 0.0
    return round(score / max_score * 100, 1)