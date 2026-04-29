import requests
import urllib3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.db import (
    query_opportunities,
    get_opportunity_ids,
    upsert_opportunities,
    update_opportunity_fields,
    get_batches_state,
    upsert_batch,
    set_batch_state,
    seal_batch,
    batch_has_rows,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# EXTRACT HELPERS  (pure functions, no I/O)
# ---------------------------------------------------------------------------

def extract_contract_months(release: dict) -> str:
    """
    Extract contract length in whole months from an OCDS release.
    Checks tender.contractPeriod first, then the longest lot contractPeriod.
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

    cp = tender.get("contractPeriod") or {}
    days = _days_from_cp(cp)

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
    """Return comma-separated awarded supplier names from an OCDS release."""
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


def extract_all_cpvs(release: dict) -> list[str]:
    """Return every unique CPV code found anywhere in a release."""
    tender = release.get("tender", {})
    seen: set[str] = set()
    cpvs: list[str] = []

    def add(code: str | None) -> None:
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


def normalise_opportunity(release: dict) -> dict:
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
        if release_id else None
    )

    techniques = tender.get("techniques") or {}
    fw_parts = []
    if techniques.get("hasFrameworkAgreement"):
        fw_parts.append("FA")
    if techniques.get("hasDynamicPurchasingSystem"):
        fw_parts.append("DPS")

    return {
        "id":               release_id,
        "title":            tender.get("title", "N/A"),
        "buyer":            buyer,
        "value":            tender.get("value", {}).get("amount"),
        "cpvs":             ", ".join(all_cpvs),
        "stage":            ", ".join(tags),
        "published_date":   release.get("date", ""),
        "date_modified":    tender.get("dateModified") or "",
        "contract_start":   (tender.get("contractPeriod") or {}).get("startDate") or "",
        "contract_end":     (tender.get("contractPeriod") or {}).get("endDate")   or "",
        "contract_months":  extract_contract_months(release),
        "framework":        ", ".join(fw_parts),
        "awarded_supplier": extract_awarded_suppliers(release),
        "tender_deadline":  (tender.get("tenderPeriod") or {}).get("endDate") or "",
        "description":      description,
        "source":           "Find a Tender",
        "source_url":       source_url,
    }


# ---------------------------------------------------------------------------
# FILTER  (pure function, operates on list[dict])
# ---------------------------------------------------------------------------

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
    results = []
    for opp in opportunities:
        raw_value = opp.get("value")
        try:
            value = float(raw_value) if raw_value not in (None, "", "None") else None
        except (ValueError, TypeError):
            value = None

        if min_value is not None and (value is None or value < min_value):
            continue
        if max_value is not None and (value is None or value > max_value):
            continue

        if cpv_prefixes:
            cpv_list = [c.strip() for c in (opp.get("cpvs") or "").split(",") if c.strip()]
            if not any(c.startswith(p) for c in cpv_list for p in cpv_prefixes):
                continue

        if stages:
            stage_list = [s.strip() for s in (opp.get("stage") or "").split(",") if s.strip()]
            if not any(s in stages for s in stage_list):
                continue

        if buyer and buyer.lower() not in (opp.get("buyer") or "").lower():
            continue

        pub_date = (opp.get("published_date") or "")[:10]
        if date_from and pub_date and pub_date < date_from:
            continue
        if date_to and pub_date and pub_date > date_to:
            continue

        if keyword:
            haystack = " ".join([
                opp.get("title") or "",
                opp.get("description") or "",
                opp.get("buyer") or "",
            ]).lower()
            if keyword.lower() not in haystack:
                continue

        if framework_only and not (opp.get("framework") or "").strip():
            continue

        results.append(opp)
    return results


# ---------------------------------------------------------------------------
# BATCH MANAGEMENT
# ---------------------------------------------------------------------------

def _get_or_create_source_batch(source: str) -> str:
    """
    Return the batch_id to stamp on new records for this load call.
    Creates a new batch or reuses the active one if it has no rows yet.
    Seals the previous batch when a new one is opened.
    """
    state = get_batches_state(source)
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
        upsert_batch(source, new_batch)
        set_batch_state(source, new_batch_id)
        return new_batch_id

    active_id = state["active_batch_id"]

    if not batch_has_rows(source, active_id):
        return active_id

    # Seal current batch, open a new one
    seal_batch(source, active_id)
    new_batch = {
        "batch_id": new_batch_id,
        "label": label,
        "created_at": now.isoformat(),
        "sealed": False,
    }
    upsert_batch(source, new_batch)
    set_batch_state(source, new_batch_id, last_seen_batch_id=active_id)
    return new_batch_id


def _load_batches() -> dict:
    """Return FaT batch state (for /batches endpoint)."""
    return get_batches_state("fat")


def _load_source_batches(source: str) -> dict:
    """Return batch state for a given source (for /batches/{source} endpoints)."""
    return get_batches_state(source)


# ---------------------------------------------------------------------------
# CSV-COMPATIBILITY WRAPPERS  (same names, now read from DB)
# ---------------------------------------------------------------------------

def load_csv() -> list[dict]:
    """Return all FaT opportunities from the DB."""
    return query_opportunities("fat")


def load_source_csv(source: str) -> list[dict]:
    """Return all opportunities for the given source from the DB."""
    return query_opportunities(source)


def save_to_source_csv(source: str, opportunities: list[dict],
                        batch_id: str) -> int:
    """
    Upsert new opportunities for the given source, stamped with batch_id.
    Returns the number of new records written (existing IDs are skipped).
    """
    existing_ids = get_opportunity_ids(source)
    new_records = [o for o in opportunities if str(o.get("id", "")) not in existing_ids]
    if not new_records:
        return 0
    for rec in new_records:
        rec["batch_id"] = batch_id
    upsert_opportunities(new_records)
    return len(new_records)


# ---------------------------------------------------------------------------
# FETCH + LOAD
# ---------------------------------------------------------------------------

def _fetch_for_date(date: str) -> list[dict]:
    """Fetch and normalise all OCDS releases for a single YYYY-MM-DD date."""
    url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
    params = {"limit": 100, "updatedFrom": f"{date}T00:00:00",
              "updatedTo": f"{date}T23:59:59"}
    releases = []
    next_url: str | None = url
    while next_url:
        resp = requests.get(
            next_url,
            params=params if next_url == url else None,
            verify=False,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        releases.extend(data.get("releases", []))
        next_url = data.get("links", {}).get("next")
    return [normalise_opportunity(r) for r in releases]


def load_findtender_opps(days_back: int = 2) -> tuple[int, int, str]:
    """
    Fetch the last `days_back` days of FaT opportunities, save new ones to DB.
    Returns (total_fetched, new_saved, batch_id).
    """
    batch_id = _get_or_create_source_batch("fat")
    today = datetime.now(timezone.utc)
    all_opps: list[dict] = []
    for i in range(days_back):
        date = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            all_opps.extend(_fetch_for_date(date))
        except Exception:
            pass  # skip unreachable dates, don't abort the whole load
    new_saved = save_to_source_csv("fat", all_opps, batch_id)
    return len(all_opps), new_saved, batch_id


# ---------------------------------------------------------------------------
# BACKFILL  (re-fetch missing fields from FaT API)
# ---------------------------------------------------------------------------

def backfill_awarded_suppliers() -> int:
    """
    Re-fetch awarded supplier names for FaT award/contract rows where the field is empty.
    Returns the number of rows updated.
    """
    rows = query_opportunities("fat")
    award_stages = {"award", "awardUpdate", "contract", "contractUpdate"}
    missing = [
        r for r in rows
        if not (r.get("awarded_supplier") or "").strip()
        and r.get("id")
        and any(s.strip() in award_stages
                for s in (r.get("stage") or "").split(","))
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
                update_opportunity_fields(nid, awarded_supplier=supplier)
                updated += 1
        except Exception:
            continue
    return updated


def backfill_contract_months() -> int:
    """
    Re-fetch contract months for FaT rows where the field is empty.
    Returns the number of rows updated.
    """
    rows = query_opportunities("fat")
    missing = [
        r for r in rows
        if not (r.get("contract_months") or "").strip()
        and r.get("id")
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
            months = extract_contract_months(releases[0])
            if months:
                update_opportunity_fields(nid, contract_months=months)
                updated += 1
        except Exception:
            continue
    return updated
