import csv
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

CSV_FIELDS = [
    "id", "title", "buyer", "value", "cpvs", "stage",
    "published_date", "description", "source",
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
# HELPERS
# ---------------------------
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
    """Convert a raw OCDS release into a flat opportunity dict."""
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

    return {
        "id": release.get("id"),
        "title": tender.get("title", "N/A"),
        "buyer": buyer,
        "value": tender.get("value", {}).get("amount"),
        "cpvs": ", ".join(all_cpvs),
        "stage": ", ".join(tags),
        "published_date": release.get("date", ""),
        "description": description,
        "source": "Find a Tender",
    }


# ---------------------------
# CSV PERSISTENCE
# ---------------------------
def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_csv() -> list[dict]:
    """Read all opportunities from the CSV. Returns [] if file doesn't exist."""
    if not CSV_PATH.exists():
        return []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_to_csv(opportunities: list[dict]) -> int:
    """
    Append new opportunities to the CSV, deduplicating by `id`.

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


def load_findtender_opps() -> tuple[int, int]:
    """
    Fetch today's and yesterday's opportunities, append new ones to the CSV.

    Returns:
        tuple[int, int]: (total_fetched, new_saved)
            total_fetched — number of records returned by the API across both days
            new_saved     — number of records actually written (excluding duplicates)
    """
    today = datetime.now(timezone.utc)
    yesterday = today - timedelta(days=1)

    dates = [
        yesterday.strftime("%Y-%m-%d"),
        today.strftime("%Y-%m-%d"),
    ]

    all_opps = []
    for date in dates:
        all_opps.extend(_fetch_for_date(date))

    new_saved = save_to_csv(all_opps)
    return len(all_opps), new_saved


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

        results.append(opp)

    return results
