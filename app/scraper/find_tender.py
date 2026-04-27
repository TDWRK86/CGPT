import csv
import json
import os
import requests
import urllib3
from datetime import datetime, timedelta, timezone
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------
# PATHS
# ---------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CSV_PATH = DATA_DIR / "opportunities.csv"
BATCHES_PATH = DATA_DIR / "batches.json"
TRIAGE_PATH  = DATA_DIR / "triage.json"

CSV_FIELDS = [
    "id", "title", "buyer", "value", "cpvs", "stage",
    "published_date", "date_modified", "contract_start", "contract_end",
    "contract_months", "framework", "awarded_supplier",
    "description", "source", "source_url", "batch_id",
]

# ---------------------------
# DEFAULT FILTER SETTINGS
# ---------------------------
DEFAULT_MIN_VALUE = 100_000
DEFAULT_CPV_PREFIXES = ["30", "48", "72"]
DEFAULT_EXCLUDE_TAGS = [
    "award", "awardUpdate", "contract", "contractUpdate", "tenderAmendment"
]
DEFAULT_INCLUDE_TAGS = [
    "tender", "preQualification", "planning", "planningUpdate"
]


# ---------------------------
# BATCH HELPERS
# ---------------------------
def _load_batches() -> dict:
    """Read batches.json, returning a default structure if missing."""
    if not BATCHES_PATH.exists():
        return {"batches": [], "active_batch_id": None, "last_seen_batch_id": None}
    with open(BATCHES_PATH, encoding="utf-8") as f:
        return json.load(f)


def _save_batches(state: dict) -> None:
    """Write batches.json atomically via a tmp file."""
    _ensure_data_dir()
    tmp = BATCHES_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    tmp.replace(BATCHES_PATH)


def load_triage() -> dict:
    """Read triage.json. Returns {'sessions': []} if missing."""
    if not TRIAGE_PATH.exists():
        return {"sessions": []}
    with open(TRIAGE_PATH, encoding="utf-8") as f:
        return json.load(f)


def update_triage_session_opportunities(session_id: str, opportunities: list[dict]) -> bool:
    """Replace the opportunities list on an existing triage session (for note edits)."""
    _ensure_data_dir()
    state = load_triage()
    for session in state.get("sessions", []):
        if session["session_id"] == session_id:
            session["opportunities"] = opportunities
            tmp = TRIAGE_PATH.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
            tmp.replace(TRIAGE_PATH)
            return True
    return False


def delete_triage_session(session_id: str) -> bool:
    """Remove a triage session by ID. Returns True if found and deleted."""
    _ensure_data_dir()
    state = load_triage()
    sessions = state.get("sessions", [])
    new_sessions = [s for s in sessions if s["session_id"] != session_id]
    if len(new_sessions) == len(sessions):
        return False
    state["sessions"] = new_sessions
    tmp = TRIAGE_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    tmp.replace(TRIAGE_PATH)
    return True


def save_triage_session(opportunities: list[dict]) -> dict:
    """
    Append a new triage session to triage.json and return it.
    Each opportunity dict should include 'score' and 'notes' from the review step.
    """
    _ensure_data_dir()
    state = load_triage()

    now = datetime.now(timezone.utc).astimezone()
    session = {
        "session_id": "triage_" + now.strftime("%Y%m%d_%H%M%S"),
        "label": f"{now.day} {now.strftime('%b %Y')}, {now.strftime('%H:%M')}",
        "created_at": now.isoformat(),
        "opportunities": opportunities,
    }

    state["sessions"].append(session)
    tmp = TRIAGE_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    tmp.replace(TRIAGE_PATH)
    return session


def _get_or_create_batch() -> str:
    """
    Return the batch_id to stamp on new records for this /load call.

    Rules:
    - No active batch yet → create the first one.
    - Active batch has no rows yet → reuse it (handles spam-click / reload).
    - Active batch has rows → seal it, set last_seen_batch_id, create a new one.
    """
    state = _load_batches()
    now = datetime.now(timezone.utc).astimezone()
    new_batch_id = "batch_" + now.strftime("%Y%m%d_%H%M%S")
    label = f"{now.day} {now.strftime('%b %Y')}, {now.strftime('%H:%M')}"

    if not state["active_batch_id"]:
        new_batch = {
            "batch_id": new_batch_id,
            "label": label,
            "created_at": now.isoformat(),
            "sealed": False,
        }
        state["batches"].append(new_batch)
        state["active_batch_id"] = new_batch_id
        _save_batches(state)
        return new_batch_id

    active_id = state["active_batch_id"]

    # Check if active batch actually has any CSV rows yet
    existing = load_csv()
    batch_has_rows = any(row.get("batch_id") == active_id for row in existing)

    if not batch_has_rows:
        return active_id

    # Seal current batch, open a new one
    for b in state["batches"]:
        if b["batch_id"] == active_id:
            b["sealed"] = True
    state["last_seen_batch_id"] = active_id

    new_batch = {
        "batch_id": new_batch_id,
        "label": label,
        "created_at": now.isoformat(),
        "sealed": False,
    }
    state["batches"].append(new_batch)
    state["active_batch_id"] = new_batch_id
    _save_batches(state)
    return new_batch_id


# ---------------------------
# HELPERS
# ---------------------------
def extract_contract_months(release: dict) -> str:
    """
    Extract contract length in whole months from an OCDS release.
    Checks tender.contractPeriod first, then the longest lot contractPeriod.
    Returns a string integer e.g. "24", or "" if no data found.
    """
    tender = release.get("tender", {})
    days: int | None = None

    def _days_from_cp(cp: dict) -> int | None:
        if cp.get("durationInDays"):
            return int(cp["durationInDays"])
        s, e = cp.get("startDate"), cp.get("endDate")
        if s and e:
            try:
                from datetime import date as _date
                sd = _date.fromisoformat(str(s)[:10])
                ed = _date.fromisoformat(str(e)[:10])
                return (ed - sd).days
            except Exception:
                pass
        return None

    # 1. Tender-level contractPeriod
    cp = tender.get("contractPeriod") or {}
    days = _days_from_cp(cp)

    # 2. Lot-level contractPeriod — take the maximum across lots
    if days is None:
        lot_days = [
            _days_from_cp(lot.get("contractPeriod") or {})
            for lot in tender.get("lots", [])
        ]
        lot_days = [d for d in lot_days if d is not None]
        if lot_days:
            days = max(lot_days)

    if not days:
        return ""
    months = round(days / 30.44)
    return str(months) if months > 0 else ""


def extract_awarded_suppliers(release: dict) -> str:
    """
    Return a comma-separated string of awarded supplier names from a release.
    Pulls from release.awards[].suppliers[].name; falls back to parties with
    role 'supplier' if no awards block is present.
    """
    seen: set[str] = set()
    names: list[str] = []

    for award in release.get("awards", []):
        for sup in award.get("suppliers", []):
            name = (sup.get("name") or "").strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)

    if not names:
        for party in release.get("parties", []):
            if "supplier" in party.get("roles", []):
                name = (party.get("name") or "").strip()
                if name and name not in seen:
                    seen.add(name)
                    names.append(name)

    return ", ".join(names)


def extract_all_cpvs(release):
    """Return every unique CPV code found anywhere in a release."""
    tender = release.get("tender", {})
    seen = set()
    cpvs = []

    def add(code):
        if code and code not in seen:
            seen.add(code)
            cpvs.append(code)

    add(tender.get("classification", {}).get("id"))

    for item in tender.get("items", []):
        add(item.get("classification", {}).get("id"))
        for cls in item.get("additionalClassifications", []):
            if cls.get("scheme", "").upper() == "CPV":
                add(cls.get("id"))

    for cls in tender.get("additionalClassifications", []):
        if cls.get("scheme", "").upper() == "CPV":
            add(cls.get("id"))

    return cpvs


def normalise_opportunity(release):
    tender = release.get("tender", {})
    tags = release.get("tag", [])
    all_cpvs = extract_all_cpvs(release)

    parties = release.get("parties", [])
    buyer = parties[0].get("name", "N/A") if parties else "N/A"

    description = (
        tender.get("description")
        or release.get("description")
        or "No description provided"
    )

    release_id = release.get("id")

    source_url = (
        f"https://www.find-tender.service.gov.uk/Notice/{release_id}"
        if release_id
        else None
    )

    # Framework / DPS detection via OCDS techniques extension
    techniques = tender.get("techniques") or {}
    fw_parts = []
    if techniques.get("hasFrameworkAgreement"):
        fw_parts.append("FA")
    if techniques.get("hasDynamicPurchasingSystem"):
        fw_parts.append("DPS")
    framework = ", ".join(fw_parts)

    return {
        "id": release_id,
        "title": tender.get("title", "N/A"),
        "buyer": buyer,
        "value": tender.get("value", {}).get("amount"),
        "cpvs": ", ".join(all_cpvs),
        "stage": ", ".join(tags),
        "published_date": release.get("date", ""),
        "date_modified": tender.get("dateModified") or "",
        "contract_start": (tender.get("contractPeriod") or {}).get("startDate") or "",
        "contract_end":   (tender.get("contractPeriod") or {}).get("endDate")   or "",
        "contract_months": extract_contract_months(release),
        "framework": framework,
        "awarded_supplier": extract_awarded_suppliers(release),
        "description": description,
        "source": "Find a Tender",
        "source_url": source_url,
    }


# ---------------------------
# CSV PERSISTENCE
# ---------------------------
def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _migrate_csv_if_needed() -> None:
    """
    One-time migration: if the CSV exists but has no batch_id column,
    rewrite it with the updated header and batch_id='' for all old rows.
    Idempotent — safe to call on every startup.
    """
    if not CSV_PATH.exists():
        return
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        required = {"batch_id", "date_modified", "contract_start", "contract_end", "framework", "contract_months", "awarded_supplier"}
        if required.issubset(set(fields)):
            return  # already fully migrated
        rows = list(reader)

    tmp = CSV_PATH.with_suffix(".migration.tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            row.setdefault("batch_id", "")
            row.setdefault("date_modified", "")
            row.setdefault("contract_start", "")
            row.setdefault("contract_end", "")
            row.setdefault("contract_months", "")
            row.setdefault("framework", "")
            row.setdefault("awarded_supplier", "")
            writer.writerow(row)
    tmp.replace(CSV_PATH)


def load_csv() -> list[dict]:
    """Read all opportunities from the CSV. Returns [] if file doesn't exist."""
    _migrate_csv_if_needed()
    if not CSV_PATH.exists():
        return []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_to_csv(opportunities: list[dict], batch_id: str) -> int:
    """
    Append new opportunities to the CSV, deduplicating by `id`.
    Stamps each new record with the given batch_id.

    Returns:
        int: Number of new records actually written.
    """
    _ensure_data_dir()

    existing_ids: set[str] = set()
    if CSV_PATH.exists():
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing_ids.add(row["id"])

    new_records = [o for o in opportunities if str(o["id"]) not in existing_ids]

    if not new_records:
        return 0

    for rec in new_records:
        rec["batch_id"] = batch_id

    write_header = not CSV_PATH.exists() or os.path.getsize(CSV_PATH) == 0

    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        writer.writerows(new_records)

    return len(new_records)


# ---------------------------
# FETCH
# ---------------------------
def _fetch_for_date(date: str) -> list[dict]:
    """Fetch and normalise all OCDS releases for a single YYYY-MM-DD date."""
    start = f"{date}T00:00:00"
    end = f"{date}T23:59:59"
    url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
    params = {"limit": 100, "updatedFrom": start, "updatedTo": end}

    releases = []
    next_url = url

    while next_url:
        resp = requests.get(
            next_url,
            params=params if next_url == url else None,
            verify=False,
        )
        resp.raise_for_status()
        data = resp.json()
        releases.extend(data.get("releases", []))
        next_url = data.get("links", {}).get("next")

    return [normalise_opportunity(r) for r in releases]


def load_findtender_opps() -> tuple[int, int, str]:
    """
    Fetch today's and yesterday's opportunities, append new ones to the CSV.

    Returns:
        tuple[int, int, str]: (total_fetched, new_saved, batch_id)
    """
    batch_id = _get_or_create_batch()

    today = datetime.now(timezone.utc)
    yesterday = today - timedelta(days=1)

    dates = [
        yesterday.strftime("%Y-%m-%d"),
        today.strftime("%Y-%m-%d"),
    ]

    all_opps = []
    for date in dates:
        all_opps.extend(_fetch_for_date(date))

    new_saved = save_to_csv(all_opps, batch_id)
    return len(all_opps), new_saved, batch_id


def backfill_awarded_suppliers() -> int:
    """
    For any FaT CSV row with an empty awarded_supplier where the stage is an
    award/contract notice, re-fetch the OCDS release and extract the supplier name.
    Rewrites the CSV if any rows were updated. Returns the number of rows updated.
    """
    rows = load_csv()
    award_stages = {"award", "awardUpdate", "contract", "contractUpdate"}
    missing = [
        r for r in rows
        if not (r.get("awarded_supplier") or "").strip()
        and r.get("source") == "Find a Tender"
        and r.get("id")
        and any(s.strip() in award_stages for s in (r.get("stage") or "").split(","))
    ]
    if not missing:
        return 0

    fat_url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
    updated = 0
    for row in missing:
        nid = row["id"]
        try:
            resp = requests.get(f"{fat_url}/{nid}", verify=False, timeout=15)
            if not resp.ok:
                continue
            data = resp.json()
            releases = data.get("releases", [])
            if not releases:
                continue
            supplier = extract_awarded_suppliers(releases[0])
            if supplier:
                row["awarded_supplier"] = supplier
                updated += 1
        except Exception:
            continue

    if updated:
        tmp = CSV_PATH.with_suffix(".tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        tmp.replace(CSV_PATH)

    return updated


def backfill_contract_months() -> int:
    """
    For any FaT CSV row with an empty contract_months, re-fetch the OCDS release
    from the API and compute the value. Rewrites the CSV if any rows were updated.
    Returns the number of rows updated.
    """
    rows = load_csv()
    missing = [r for r in rows if not (r.get("contract_months") or "").strip()
               and r.get("source") == "Find a Tender"
               and r.get("id")]
    if not missing:
        return 0

    fat_url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
    updated = 0
    for row in missing:
        nid = row["id"]
        try:
            resp = requests.get(f"{fat_url}/{nid}", verify=False, timeout=15)
            if not resp.ok:
                continue
            data = resp.json()
            releases = data.get("releases", [])
            if not releases:
                continue
            months = extract_contract_months(releases[0])
            if months:
                row["contract_months"] = months
                updated += 1
        except Exception:
            continue

    if updated:
        tmp = CSV_PATH.with_suffix(".tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        tmp.replace(CSV_PATH)

    return updated


# ---------------------------
# FILTER (operates on CSV rows)
# ---------------------------
def filter_opportunities(
    opportunities: list[dict],
    *,
    cpv_prefixes: list[str] | None = None,
    min_value: float | None = None,
    max_value: float | None = None,
    stages: list[str] | None = None,
    buyer: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    keyword: str | None = None,
    framework_only: bool = False,
) -> list[dict]:
    """
    Filter a list of opportunity dicts (as returned by load_csv()).

    All params are optional — omit to skip that filter.

    Args:
        cpv_prefixes:  List of CPV prefix strings (e.g. ["72", "48"]).
        min_value:     Minimum contract value (£).
        max_value:     Maximum contract value (£).
        stages:        List of stage/tag strings to match (ANY match passes).
        buyer:         Case-insensitive substring match on buyer name.
        date_from:     ISO date string "YYYY-MM-DD" — include on/after this date.
        date_to:       ISO date string "YYYY-MM-DD" — include on/before this date.

    Returns:
        list[dict]: Filtered opportunities.
    """
    results = []

    for opp in opportunities:
        # --- value filter ---
        raw_value = opp.get("value")
        try:
            value = float(raw_value) if raw_value not in (None, "", "None") else None
        except (ValueError, TypeError):
            value = None

        if min_value is not None:
            if value is None or value < min_value:
                continue
        if max_value is not None:
            if value is None or value > max_value:
                continue

        # --- CPV filter ---
        if cpv_prefixes:
            cpv_str = opp.get("cpvs", "")
            cpv_list = [c.strip() for c in cpv_str.split(",") if c.strip()]
            matched = [c for c in cpv_list if any(c.startswith(p) for p in cpv_prefixes)]
            if not matched:
                continue

        # --- stage/tag filter ---
        if stages:
            stage_str = opp.get("stage", "")
            stage_list = [s.strip() for s in stage_str.split(",") if s.strip()]
            if not any(s in stages for s in stage_list):
                continue

        # --- buyer filter ---
        if buyer:
            if buyer.lower() not in (opp.get("buyer") or "").lower():
                continue

        # --- date filter ---
        pub_date = (opp.get("published_date") or "")[:10]  # "YYYY-MM-DD"
        if date_from and pub_date and pub_date < date_from:
            continue
        if date_to and pub_date and pub_date > date_to:
            continue

        # --- keyword filter ---
        if keyword:
            needle = keyword.lower()
            haystack = " ".join([
                opp.get("title") or "",
                opp.get("description") or "",
                opp.get("buyer") or "",
            ]).lower()
            if needle not in haystack:
                continue

        # --- framework filter ---
        if framework_only and not (opp.get("framework") or "").strip():
            continue

        results.append(opp)

    return results


# ---------------------------
# MULTI-SOURCE CSV / BATCH PERSISTENCE
# Parameterised by source key: "cf" or "pcs"
# ---------------------------

def _source_csv_path(source: str) -> Path:
    return DATA_DIR / f"opportunities_{source}.csv"


def _source_batches_path(source: str) -> Path:
    return DATA_DIR / f"batches_{source}.json"


def load_source_csv(source: str) -> list[dict]:
    """Read all opportunities from the source-specific CSV. Returns [] if missing."""
    path = _source_csv_path(source)
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_to_source_csv(source: str, opportunities: list[dict], batch_id: str) -> int:
    """
    Append new opportunities to the source CSV, deduplicating by `id`.
    Stamps each new record with the given batch_id.
    Returns the number of new records written.
    """
    _ensure_data_dir()
    path = _source_csv_path(source)

    existing_ids: set[str] = set()
    if path.exists():
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing_ids.add(row["id"])

    new_records = [o for o in opportunities if str(o.get("id", "")) not in existing_ids]
    if not new_records:
        return 0

    for rec in new_records:
        rec["batch_id"] = batch_id

    write_header = not path.exists() or os.path.getsize(path) == 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        writer.writerows(new_records)

    return len(new_records)


def _load_source_batches(source: str) -> dict:
    path = _source_batches_path(source)
    if not path.exists():
        return {"batches": [], "active_batch_id": None, "last_seen_batch_id": None}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_source_batches(source: str, state: dict) -> None:
    _ensure_data_dir()
    path = _source_batches_path(source)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    tmp.replace(path)


def _get_or_create_source_batch(source: str) -> str:
    """
    Return the batch_id to stamp on new records for this load call.
    Same sealing rules as _get_or_create_batch() but for an arbitrary source.
    """
    state = _load_source_batches(source)
    now = datetime.now(timezone.utc).astimezone()
    new_batch_id = "batch_" + now.strftime("%Y%m%d_%H%M%S")
    label = f"{now.day} {now.strftime('%b %Y')}, {now.strftime('%H:%M')}"

    if not state["active_batch_id"]:
        new_batch = {
            "batch_id": new_batch_id,
            "label": label,
            "created_at": now.isoformat(),
            "sealed": False,
        }
        state["batches"].append(new_batch)
        state["active_batch_id"] = new_batch_id
        _save_source_batches(source, state)
        return new_batch_id

    active_id = state["active_batch_id"]
    existing = load_source_csv(source)
    batch_has_rows = any(row.get("batch_id") == active_id for row in existing)

    if not batch_has_rows:
        return active_id

    # Seal current batch, open a new one
    for b in state["batches"]:
        if b["batch_id"] == active_id:
            b["sealed"] = True
    state["last_seen_batch_id"] = active_id

    new_batch = {
        "batch_id": new_batch_id,
        "label": label,
        "created_at": now.isoformat(),
        "sealed": False,
    }
    state["batches"].append(new_batch)
    state["active_batch_id"] = new_batch_id
    _save_source_batches(source, state)
    return new_batch_id
