"""
SQLite persistence layer.
Replaces CSV + JSON file storage.  DB file: app/scraper/data/procurement.db
"""

import csv
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_APP_DIR = Path(__file__).resolve().parent
_DATA_DIR = _APP_DIR / "scraper" / "data"
_DB_PATH = _DATA_DIR / "procurement.db"

# Maps short source keys to the display names stored in the DB / scrapers
_SOURCE_MAP = {
    "fat": "Find a Tender",
    "cf": "Contracts Finder",
    "pcs": "Public Contracts Scotland",
}

OPP_FIELDS = [
    "id", "source", "batch_id", "title", "buyer", "value", "cpvs", "stage",
    "published_date", "date_modified", "contract_start", "contract_end",
    "contract_months", "framework", "awarded_supplier", "tender_deadline",
    "description", "source_url",
    "ai_score", "ai_recommendation", "ai_reasoning",
    "human_override", "human_override_reason",
]

# Legacy CSV fields (used only during one-time import)
_CSV_FIELDS = [
    "id", "title", "buyer", "value", "cpvs", "stage",
    "published_date", "date_modified", "contract_start", "contract_end",
    "contract_months", "framework", "awarded_supplier",
    "description", "source", "source_url", "batch_id",
]


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema + one-time migration
# ---------------------------------------------------------------------------

def init_db() -> None:
    """Create tables (idempotent), then import existing CSV/JSON data if DB is empty."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS opportunities (
                id                    TEXT PRIMARY KEY,
                source                TEXT NOT NULL,
                batch_id              TEXT,
                title                 TEXT,
                buyer                 TEXT,
                value                 REAL,
                cpvs                  TEXT,
                stage                 TEXT,
                published_date        TEXT,
                date_modified         TEXT,
                contract_start        TEXT,
                contract_end          TEXT,
                contract_months       TEXT,
                framework             TEXT,
                awarded_supplier      TEXT,
                tender_deadline       TEXT,
                description           TEXT,
                source_url            TEXT,
                ai_score              INTEGER,
                ai_recommendation     TEXT,
                ai_reasoning          TEXT,
                human_override        TEXT,
                human_override_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS batches (
                batch_id   TEXT NOT NULL,
                source     TEXT NOT NULL,
                label      TEXT,
                created_at TEXT,
                sealed     INTEGER DEFAULT 0,
                PRIMARY KEY (batch_id, source)
            );

            CREATE TABLE IF NOT EXISTS batch_state (
                source             TEXT PRIMARY KEY,
                active_batch_id    TEXT,
                last_seen_batch_id TEXT
            );

            CREATE TABLE IF NOT EXISTS triage_sessions (
                session_id TEXT PRIMARY KEY,
                label      TEXT,
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS triage_items (
                session_id     TEXT NOT NULL
                               REFERENCES triage_sessions(session_id) ON DELETE CASCADE,
                opp_id         TEXT NOT NULL,
                title          TEXT,
                buyer          TEXT,
                value          REAL,
                cpvs           TEXT,
                stage          TEXT,
                published_date TEXT,
                description    TEXT,
                source_url     TEXT,
                score          INTEGER DEFAULT 0,
                notes          TEXT,
                contract_start TEXT,
                contract_end   TEXT,
                PRIMARY KEY (session_id, opp_id)
            );
        """)
    _import_csv_if_needed()
    _import_triage_if_needed()
    _import_batches_if_needed()


# ---------------------------------------------------------------------------
# Opportunity CRUD
# ---------------------------------------------------------------------------

def upsert_opportunities(rows: list[dict]) -> None:
    if not rows:
        return
    cols = ", ".join(OPP_FIELDS)
    placeholders = ", ".join(["?"] * len(OPP_FIELDS))
    sql = f"INSERT OR REPLACE INTO opportunities ({cols}) VALUES ({placeholders})"
    data = [[_coerce(row.get(f)) for f in OPP_FIELDS] for row in rows]
    with get_db() as conn:
        conn.executemany(sql, data)


def get_opportunity_ids(source: str) -> set[str]:
    source_name = _SOURCE_MAP.get(source, source)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id FROM opportunities WHERE source = ?", (source_name,)
        ).fetchall()
    return {r["id"] for r in rows}


def query_opportunities(source: str | None = None) -> list[dict]:
    sql = "SELECT * FROM opportunities"
    params: list = []
    if source:
        source_name = _SOURCE_MAP.get(source, source)
        sql += " WHERE source = ?"
        params.append(source_name)
    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def update_opportunity_fields(opp_id: str, **fields) -> bool:
    if not fields:
        return False
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [opp_id]
    with get_db() as conn:
        cur = conn.execute(
            f"UPDATE opportunities SET {sets} WHERE id = ?", vals
        )
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Batch management
# ---------------------------------------------------------------------------

def get_batches_state(source: str) -> dict:
    with get_db() as conn:
        batches = conn.execute(
            "SELECT batch_id, label, created_at, sealed "
            "FROM batches WHERE source = ? ORDER BY batch_id DESC",
            (source,)
        ).fetchall()
        state_row = conn.execute(
            "SELECT active_batch_id, last_seen_batch_id "
            "FROM batch_state WHERE source = ?",
            (source,)
        ).fetchone()
    return {
        "batches": [dict(r) for r in batches],
        "active_batch_id": state_row["active_batch_id"] if state_row else None,
        "last_seen_batch_id": state_row["last_seen_batch_id"] if state_row else None,
    }


def upsert_batch(source: str, batch: dict) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO batches "
            "(batch_id, source, label, created_at, sealed) VALUES (?,?,?,?,?)",
            (
                batch["batch_id"], source,
                batch.get("label"), batch.get("created_at"),
                1 if batch.get("sealed") else 0,
            ),
        )


def set_batch_state(source: str, active_batch_id: str | None,
                    last_seen_batch_id: str | None = None) -> None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT source FROM batch_state WHERE source = ?", (source,)
        ).fetchone()
        if row:
            if last_seen_batch_id is not None:
                conn.execute(
                    "UPDATE batch_state SET active_batch_id=?, last_seen_batch_id=? "
                    "WHERE source=?",
                    (active_batch_id, last_seen_batch_id, source),
                )
            else:
                conn.execute(
                    "UPDATE batch_state SET active_batch_id=? WHERE source=?",
                    (active_batch_id, source),
                )
        else:
            conn.execute(
                "INSERT INTO batch_state (source, active_batch_id, last_seen_batch_id) "
                "VALUES (?,?,?)",
                (source, active_batch_id, last_seen_batch_id),
            )


def seal_batch(source: str, batch_id: str) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE batches SET sealed=1 WHERE source=? AND batch_id=?",
            (source, batch_id),
        )


def batch_has_rows(source: str, batch_id: str) -> bool:
    source_name = _SOURCE_MAP.get(source, source)
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM opportunities "
            "WHERE source=? AND batch_id=?",
            (source_name, batch_id),
        ).fetchone()
    return (row["cnt"] if row else 0) > 0


# ---------------------------------------------------------------------------
# Triage CRUD
# ---------------------------------------------------------------------------

def load_triage() -> dict:
    with get_db() as conn:
        sessions = conn.execute(
            "SELECT session_id, label, created_at FROM triage_sessions "
            "ORDER BY session_id DESC"
        ).fetchall()
        result = []
        for s in sessions:
            items = conn.execute(
                "SELECT * FROM triage_items WHERE session_id = ?",
                (s["session_id"],)
            ).fetchall()
            opps = []
            for item in items:
                d = dict(item)
                d.pop("session_id", None)
                d["id"] = d.pop("opp_id")
                opps.append(d)
            result.append({
                "session_id": s["session_id"],
                "label": s["label"],
                "created_at": s["created_at"],
                "opportunities": opps,
            })
    return {"sessions": result}


def save_triage_session(opportunities: list[dict]) -> dict:
    now = datetime.now(timezone.utc).astimezone()
    session_id = "triage_" + now.strftime("%Y%m%d_%H%M%S")
    label = f"{now.day} {now.strftime('%b %Y')}, {now.strftime('%H:%M')}"
    created_at = now.isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO triage_sessions (session_id, label, created_at) VALUES (?,?,?)",
            (session_id, label, created_at),
        )
        _insert_triage_items(conn, session_id, opportunities)
    return {
        "session_id": session_id,
        "label": label,
        "created_at": created_at,
        "opportunities": opportunities,
    }


def update_triage_session_opportunities(session_id: str,
                                        opportunities: list[dict]) -> bool:
    with get_db() as conn:
        row = conn.execute(
            "SELECT session_id FROM triage_sessions WHERE session_id=?",
            (session_id,)
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM triage_items WHERE session_id=?", (session_id,))
        _insert_triage_items(conn, session_id, opportunities)
    return True


def delete_triage_session(session_id: str) -> bool:
    with get_db() as conn:
        row = conn.execute(
            "SELECT session_id FROM triage_sessions WHERE session_id=?",
            (session_id,)
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM triage_items WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM triage_sessions WHERE session_id=?", (session_id,))
    return True


def _insert_triage_items(conn: sqlite3.Connection, session_id: str,
                          opportunities: list[dict]) -> None:
    sql = """INSERT OR REPLACE INTO triage_items
             (session_id, opp_id, title, buyer, value, cpvs, stage,
              published_date, description, source_url, score, notes,
              contract_start, contract_end)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""
    for opp in opportunities:
        conn.execute(sql, (
            session_id,
            opp.get("id", ""),
            opp.get("title", ""),
            opp.get("buyer", ""),
            _coerce_float(opp.get("value")),
            opp.get("cpvs", ""),
            opp.get("stage", ""),
            opp.get("published_date", ""),
            opp.get("description", ""),
            opp.get("source_url"),
            int(opp.get("score") or 0),
            opp.get("notes", ""),
            opp.get("contract_start", ""),
            opp.get("contract_end", ""),
        ))


# ---------------------------------------------------------------------------
# One-time CSV / JSON import
# ---------------------------------------------------------------------------

def _import_csv_if_needed() -> None:
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM opportunities"
        ).fetchone()["cnt"]
    if count > 0:
        return

    source_map = {
        _DATA_DIR / "opportunities.csv": "Find a Tender",
        _DATA_DIR / "opportunities_cf.csv": "Contracts Finder",
        _DATA_DIR / "opportunities_pcs.csv": "Public Contracts Scotland",
    }
    all_rows: list[dict] = []
    for csv_path, source_name in source_map.items():
        if not csv_path.exists():
            continue
        with open(csv_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row.setdefault("source", source_name)
                for field in OPP_FIELDS:
                    row.setdefault(field, None)
                all_rows.append(row)
    if all_rows:
        upsert_opportunities(all_rows)


def _import_triage_if_needed() -> None:
    triage_path = _DATA_DIR / "triage.json"
    if not triage_path.exists():
        return
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM triage_sessions"
        ).fetchone()["cnt"]
    if count > 0:
        return
    with open(triage_path, encoding="utf-8") as f:
        data = json.load(f)
    with get_db() as conn:
        for session in data.get("sessions", []):
            conn.execute(
                "INSERT OR IGNORE INTO triage_sessions "
                "(session_id, label, created_at) VALUES (?,?,?)",
                (session["session_id"], session.get("label", ""),
                 session.get("created_at", "")),
            )
            _insert_triage_items(conn, session["session_id"],
                                  session.get("opportunities", []))


def _import_batches_if_needed() -> None:
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM batches"
        ).fetchone()["cnt"]
    if count > 0:
        return

    source_to_file = {
        "fat": _DATA_DIR / "batches.json",
        "cf":  _DATA_DIR / "batches_cf.json",
        "pcs": _DATA_DIR / "batches_pcs.json",
    }
    with get_db() as conn:
        for source, path in source_to_file.items():
            if not path.exists():
                continue
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            for b in data.get("batches", []):
                conn.execute(
                    "INSERT OR IGNORE INTO batches "
                    "(batch_id, source, label, created_at, sealed) VALUES (?,?,?,?,?)",
                    (b["batch_id"], source, b.get("label"),
                     b.get("created_at"), 1 if b.get("sealed") else 0),
                )
            conn.execute(
                "INSERT OR REPLACE INTO batch_state "
                "(source, active_batch_id, last_seen_batch_id) VALUES (?,?,?)",
                (source, data.get("active_batch_id"),
                 data.get("last_seen_batch_id")),
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce(val: Any) -> Any:
    if val == "" or val == "None":
        return None
    return val


def _coerce_float(val: Any) -> float | None:
    if val is None or val == "" or val == "None":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    if d.get("value") is not None:
        try:
            d["value"] = float(d["value"])
        except (ValueError, TypeError):
            d["value"] = None
    return d
