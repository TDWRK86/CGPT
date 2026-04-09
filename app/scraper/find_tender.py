import requests
import urllib3
from datetime import datetime, timezone

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ---------------------------
# DEFAULT FILTER SETTINGS
# (override when calling filter_opportunities)
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
        "cpvs": all_cpvs,                        # list — filter downstream
        "stage": tags,                            # list — filter downstream
        "published_date": release.get("date"),
        "description": description,
        "source": "Find a Tender",
        "selected": False,
        "_raw": release,                          # keep original if needed
    }


# ---------------------------
# FETCH (no filtering)
# ---------------------------
def load_findtender_opps(date: str | None = None):
    """
    Fetch ALL OCDS release packages for the given date (default: today UTC).

    Returns a list of normalised opportunity dicts with NO filtering applied —
    call filter_opportunities() afterwards to narrow the results.

    Args:
        date: ISO date string "YYYY-MM-DD". Defaults to today UTC.

    Returns:
        list[dict]: All normalised opportunities for the day.
    """
    if date is None:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

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


# ---------------------------
# FILTER (call after fetching)
# ---------------------------
def filter_opportunities(
    opportunities,
    *,
    min_value=DEFAULT_MIN_VALUE,
    cpv_prefixes=DEFAULT_CPV_PREFIXES,
    exclude_tags=DEFAULT_EXCLUDE_TAGS,
    include_tags=DEFAULT_INCLUDE_TAGS,
):
    """
    Filter a list of normalised opportunities returned by load_findtender_opps().

    All keyword args are optional — omit to use the defaults defined at the
    top of this file, or pass None to skip that particular filter entirely.

    Args:
        opportunities:  Output of load_findtender_opps().
        min_value:      Minimum contract value (£). Pass None to skip.
        cpv_prefixes:   List of CPV prefix strings to match. Pass None to skip.
        exclude_tags:   Releases with ANY of these tags are dropped.
        include_tags:   Releases must have at least ONE of these tags
                        (or be a tenderUpdate without amendments).

    Returns:
        list[dict]: Filtered opportunities, with `cpvs` narrowed to matching
                    codes only (when cpv_prefixes is active) and `stage`
                    serialised to a comma-separated string for display.
    """
    results = []

    for opp in opportunities:
        tags = opp["stage"]  # still a list at this point

        # --- tag exclusion ---
        if exclude_tags and any(t in exclude_tags for t in tags):
            continue

        # --- tag inclusion ---
        if include_tags:
            include = any(t in include_tags for t in tags)
            if "tenderUpdate" in tags and "amendments" not in opp.get("_raw", {}):
                include = True
            if not include:
                continue

        # --- value filter ---
        if min_value is not None:
            value = opp["value"]
            if value is None or value < min_value:
                continue

        # --- CPV filter ---
        cpvs = opp["cpvs"]
        if cpv_prefixes is not None:
            cpvs = [c for c in cpvs if any(c.startswith(p) for p in cpv_prefixes)]
            if not cpvs:
                continue

        results.append({
            **opp,
            "cpvs": ", ".join(cpvs),
            "stage": ", ".join(tags),
        })

    return results


# ---------------------------
# CONVENIENCE WRAPPER
# (drop-in replacement for the original function)
# ---------------------------
def load_and_filter_findtender_opps(date=None, **filter_kwargs):
    """Fetch today's opps and apply default filters in one call."""
    raw = load_findtender_opps(date=date)
    return filter_opportunities(raw, **filter_kwargs)
