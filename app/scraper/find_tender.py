import requests
import urllib3
from datetime import datetime, timezone

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def load_findtender_opps():
    # ---------------------------
    # FILTER SETTINGS
    # ---------------------------
    MIN_VALUE = 100000
    CPV_PREFIXES = ["30", "48", "72"]

    EXCLUDE_TAGS = [
        "award", "awardUpdate", "contract", "contractUpdate", "tenderAmendment"
    ]

    INCLUDE_TAGS = [
        "tender", "preQualification", "planning", "planningUpdate"
    ]

    # ---------------------------
    # HELPERS
    # ---------------------------
    def extract_all_cpvs(release):
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

    # ---------------------------
    # BUILD DATE WINDOW
    # ---------------------------
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start = f"{today}T00:00:00"
    end = f"{today}T23:59:59"

    url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"

    # ---------------------------
    # PAGINATED FETCH
    # ---------------------------
    releases = []
    next_url = url
    params = {
        "limit": 100,
        "updatedFrom": start,
        "updatedTo": end
    }

    while next_url:
        if next_url == url:
            resp = requests.get(next_url, params=params, verify=False)
        else:
            resp = requests.get(next_url, verify=False)

        data = resp.json()
        releases.extend(data.get("releases", []))
        next_url = data.get("links", {}).get("next")

    # ---------------------------
    # FILTER + NORMALISE
    # ---------------------------
    opportunities = []

    for r in releases:
        tags = r.get("tag", [])
        tender = r.get("tender", {})

        # Exclude unwanted notice types
        if any(t in EXCLUDE_TAGS for t in tags):
            continue

        # Include target notice types
        include = any(t in INCLUDE_TAGS for t in tags)
        if "tenderUpdate" in tags and "amendments" not in r:
            include = True
        if not include:
            continue

        # Value filter
        value = tender.get("value", {}).get("amount")
        if value is None or value < MIN_VALUE:
            continue

        # CPV filter
        all_cpvs = extract_all_cpvs(r)
        matching_cpvs = [
            c for c in all_cpvs
            if any(c.startswith(p) for p in CPV_PREFIXES)
        ]
        if not matching_cpvs:
            continue

        # Description handling
        description = (
            tender.get("description")
            or r.get("description")
            or "No description provided"
        )

        # Buyer handling
        buyer = "N/A"
        parties = r.get("parties", [])
        if parties:
            buyer = parties[0].get("name", "N/A")

        opportunities.append({
            "id": r.get("id"),
            "title": tender.get("title", "N/A"),
            "buyer": buyer,
            "value": value,
            "cpvs": ", ".join(matching_cpvs),
            "stage": ", ".join(tags),
            "published_date": r.get("date"),
            "description": description,
            "source": "Find a Tender",
            "selected": False
        })

    return opportunities