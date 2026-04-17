import requests
import urllib3
from datetime import datetime, timezone

from app.scraper.find_tender import extract_all_cpvs, extract_contract_months

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://api.publiccontractsscotland.gov.uk/v1/Notices"

# Type 2 returns 500 — skip it
PCS_NOTICE_TYPES = [1, 4, 5]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def normalise_pcs_opportunity(release: dict) -> dict:
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

    # ID format: rls-{release_num}-MAR{notice_id}
    release_id = release.get("id", "")
    try:
        pcs_num    = release_id.split("-MAR")[1]
        source_url = f"https://www.publiccontractsscotland.gov.uk/Search/Show/{pcs_num}"
    except (IndexError, AttributeError):
        source_url = "https://www.publiccontractsscotland.gov.uk"

    techniques = tender.get("techniques") or {}
    fw_parts = []
    if techniques.get("hasFrameworkAgreement"):
        fw_parts.append("FA")
    if techniques.get("hasDynamicPurchasingSystem"):
        fw_parts.append("DPS")

    return {
        "id":              release_id,
        "title":           tender.get("title", "N/A"),
        "buyer":           buyer,
        "value":           tender.get("value", {}).get("amount"),
        "cpvs":            ", ".join(all_cpvs),
        "stage":           ", ".join(tags),
        "published_date":  release.get("date", ""),
        "date_modified":   tender.get("dateModified") or "",
        "contract_start":  (tender.get("contractPeriod") or {}).get("startDate") or "",
        "contract_end":    (tender.get("contractPeriod") or {}).get("endDate")   or "",
        "contract_months": extract_contract_months(release),
        "framework":       ", ".join(fw_parts),
        "description":     description,
        "source":          "Public Contracts Scotland",
        "source_url":      source_url,
        "batch_id":        "",
    }


def fetch_pcs(
    months_back: int = 2,
    notice_types: list[int] | None = None,
) -> list[dict]:
    """
    Fetch and normalise opportunities from Public Contracts Scotland.

    PCS is month-granular only. Fetches the given `notice_types` for each of
    the last `months_back` months. Deduplicates by release ID.
    Defaults to types [1, 4, 5] when not specified.
    """
    if notice_types is None:
        notice_types = PCS_NOTICE_TYPES

    now = datetime.now(timezone.utc)

    months_to_fetch = []
    for i in range(months_back):
        m = now.month - i
        y = now.year
        while m <= 0:
            m += 12
            y -= 1
        months_to_fetch.append(f"{m:02d}-{y}")

    seen_ids: set[str] = set()
    releases: list[dict] = []

    for month in months_to_fetch:
        for ntype in notice_types:
            params = {
                "dateFrom":   month,
                "noticeType": ntype,
                "outputType": 0,
            }
            try:
                resp = requests.get(
                    BASE_URL, params=params, headers=HEADERS, verify=False, timeout=30
                )
                if not resp.ok:
                    continue
                data  = resp.json()
                batch = data.get("releases", [])
                for r in batch:
                    rid = r.get("id", "")
                    if rid and rid not in seen_ids:
                        seen_ids.add(rid)
                        releases.append(r)
            except Exception:
                continue

    return [normalise_pcs_opportunity(r) for r in releases]
