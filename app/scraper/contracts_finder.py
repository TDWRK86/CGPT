import requests
import urllib3
from datetime import datetime, timedelta, timezone

from app.scraper.find_tender import extract_all_cpvs

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"


def normalise_cf_opportunity(release: dict) -> dict:
    tender = release.get("tender", {})
    tags   = release.get("tag", [])
    if isinstance(tags, str):
        tags = [tags]

    all_cpvs = extract_all_cpvs(release)

    parties = release.get("parties", [])
    buyer = next(
        (p.get("name") for p in parties if "buyer" in p.get("roles", [])),
        parties[0].get("name", "N/A") if parties else "N/A",
    )

    description = (
        tender.get("description")
        or release.get("description")
        or "No description provided"
    )

    release_id = release.get("id", "")
    # CF IDs are "{GUID}-{release-number}" — strip the trailing segment to get the notice GUID
    cf_guid    = "-".join(release_id.split("-")[:-1]) if release_id else ""
    source_url = (
        f"https://www.contractsfinder.service.gov.uk/Notice/{cf_guid}"
        if cf_guid else None
    )

    return {
        "id":             release_id,
        "title":          tender.get("title", "N/A"),
        "buyer":          buyer,
        "value":          tender.get("value", {}).get("amount"),
        "cpvs":           ", ".join(all_cpvs),
        "stage":          ", ".join(tags),
        "published_date": release.get("date", ""),
        "date_modified":  tender.get("dateModified") or "",
        "contract_start": (tender.get("contractPeriod") or {}).get("startDate") or "",
        "contract_end":   (tender.get("contractPeriod") or {}).get("endDate")   or "",
        "description":    description,
        "source":         "Contracts Finder",
        "source_url":     source_url,
        "batch_id":       "",
    }


def fetch_contracts_finder(
    days_back: int = 7,
    stages: list[str] | None = None,
) -> list[dict]:
    """
    Fetch and normalise opportunities from Contracts Finder.

    Fetches the given `stages` for the last `days_back` days.
    Paginates via the `links.next` cursor until exhausted.
    Defaults to planning + tender when no stages are specified.
    """
    if stages is None:
        stages = ["planning", "tender"]

    now   = datetime.now(timezone.utc)
    start = (now - timedelta(days=days_back - 1)).strftime("%Y-%m-%dT00:00:00")
    end   = now.strftime("%Y-%m-%dT23:59:59")

    # Build the initial query string manually to avoid comma-encoding of repeated params
    stage_qs = "".join(f"&stages={s}" for s in stages)
    query = f"?publishedFrom={start}&publishedTo={end}{stage_qs}&limit=100"
    next_url: str | None = BASE_URL + query

    releases = []
    first    = True
    while next_url:
        resp = requests.get(next_url, verify=False)
        resp.raise_for_status()
        data     = resp.json()
        releases.extend(data.get("releases", []))
        next_url = data.get("links", {}).get("next")
        first    = False

    return [normalise_cf_opportunity(r) for r in releases]
