import requests
import urllib3
from datetime import datetime, timezone

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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


def extract_cpv(release):
    tender = release.get("tender", {})

    top = tender.get("classification", {})
    if top.get("id"):
        return top["id"]

    for item in tender.get("items", []):
        cls = item.get("classification", {})
        if cls.get("id"):
            return cls["id"]

    for item in tender.get("items", []):
        for cls in item.get("additionalClassifications", []):
            if cls.get("scheme", "").upper() == "CPV" and cls.get("id"):
                return cls["id"]

    for cls in tender.get("additionalClassifications", []):
        if cls.get("scheme", "").upper() == "CPV" and cls.get("id"):
            return cls["id"]

    return "N/A"


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

    return ", ".join(cpvs) if cpvs else "N/A"


# ---------------------------
# BUILD DATE WINDOW
# ---------------------------
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
start = f"{today}T00:00:00"
end   = f"{today}T23:59:59"

url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"

# ---------------------------
# PAGINATED FETCH
# Follows links.next cursor until all pages are retrieved
# ---------------------------
releases = []
next_url = url
params = {
    "limit":       100,
    "updatedFrom": start,
    "updatedTo":   end
}

page = 1
while next_url:
    print(f"Fetching page {page}...")
    if page == 1:
        resp = requests.get(next_url, params=params, verify=False)
    else:
        resp = requests.get(next_url, verify=False)
    data = resp.json()
    batch = data.get("releases", [])
    releases.extend(batch)
    next_url = data.get("links", {}).get("next")
    page += 1

print(f"Total releases fetched: {len(releases)}\n")

# ---------------------------
# FILTER
# ---------------------------
filtered = []

for r in releases:
    tags = r.get("tag", [])
    tender = r.get("tender", {})

    if any(t in EXCLUDE_TAGS for t in tags):
        continue

    include = any(t in INCLUDE_TAGS for t in tags)
    if "tenderUpdate" in tags and "amendments" not in r:
        include = True
    if not include:
        continue

    value = tender.get("value", {}).get("amount")
    if value is None or value < MIN_VALUE:
        continue

    all_cpvs = extract_all_cpvs(r)
    cpv_list = [c.strip() for c in all_cpvs.split(",")]
    if not any(c.startswith(prefix) for c in cpv_list for prefix in CPV_PREFIXES):
        continue

    filtered.append(r)

# ---------------------------
# OUTPUT
# ---------------------------
print(f"Found {len(filtered)} qualifying notices today.\n")

for r in filtered:
    tender = r.get("tender", {})
    all_cpvs = [c.strip() for c in extract_all_cpvs(r).split(",")]
    cpv = ", ".join(c for c in all_cpvs if any(c.startswith(p) for p in CPV_PREFIXES))

    description = (
        tender.get("description")
        or r.get("description")
        or "(No description provided in OCDS feed)"
    )

    print("Title:",       tender.get("title", "N/A"))
    print("ID:",          r.get("id"))
    print("Buyer:",       (r.get("parties") or [{}])[0].get("name", "N/A"))
    print("CPV:",         cpv)
    print("Value:",       (tender.get("value") or {}).get("amount"))
    print("Stage:",       r.get("tag"))
    print("Published:",   r.get("date"))
    print("Description:")
    print(description)
    print("-" * 60)


 