import requests
import urllib3
from datetime import datetime, timezone, timedelta

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------
# FILTER SETTINGS
# ---------------------------
MIN_VALUE    = 100_000
CPV_PREFIXES = ["30", "48", "72"]

EXCLUDE_TAGS = [
    "award", "awardUpdate", "contract", "contractUpdate", "tenderAmendment"
]
INCLUDE_TAGS = [
    "tender", "preQualification", "planning", "planningUpdate"
]

# How many months back to search (1 = current month only)
MONTHS_BACK = 1

# noticeType codes on PCS:
#   1 = Prior Information Notice (planning)
#   2 = Contract Notice (BROKEN — 500 error, skip)
#   4 = Prior Information Notice variant (planning)
#   5 = Contract Notice (tender) ← this is the working tender type
PCS_NOTICE_TYPES = [1, 4, 5]

BASE_URL = "https://api.publiccontractsscotland.gov.uk/v1/Notices"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


# ---------------------------
# CPV HELPERS
# ---------------------------
def extract_all_cpvs(release):
    tender = release.get("tender", {})
    seen, cpvs = set(), []

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
# BUILD MONTH LIST
# PCS is month-granular only — no day-level filtering via API.
# We fetch entire months and let the output show all results.
# ---------------------------
now = datetime.now(timezone.utc)
months_to_fetch = set()
for i in range(MONTHS_BACK):
    m = now.month - i
    y = now.year
    while m <= 0:
        m += 12
        y -= 1
    months_to_fetch.add(f"{m:02d}-{y}")

print(f"Querying PCS for months: {sorted(months_to_fetch)}")
print(f"Minimum value:           £{MIN_VALUE:,}")
print(f"CPV prefixes:            {CPV_PREFIXES}\n")


# ---------------------------
# FETCH
# ---------------------------
releases = []

for month in sorted(months_to_fetch):
    for ntype in PCS_NOTICE_TYPES:
        params = {
            "dateFrom":   month,
            "noticeType": ntype,
            "outputType": 0,
        }
        resp = requests.get(BASE_URL, params=params, headers=HEADERS, verify=False)
        if not resp.ok:
            print(f"  Month {month}, noticeType {ntype}: status {resp.status_code} — skipping")
            continue
        data  = resp.json()
        batch = data.get("releases", [])
        print(f"  Month {month}, noticeType {ntype}: {len(batch)} releases")
        releases.extend(batch)

print(f"\nTotal releases fetched: {len(releases)}")


# ---------------------------
# FILTER
# ---------------------------
filtered = []

for r in releases:
    tags   = r.get("tag", [])
    tender = r.get("tender", {})

    # Tag-based include / exclude
    if any(t in EXCLUDE_TAGS for t in tags):
        continue
    include = any(t in INCLUDE_TAGS for t in tags)
    if "tenderUpdate" in tags and "amendments" not in r:
        include = True
    if not include:
        continue

    # Value floor
    value = (tender.get("value") or {}).get("amount")
    if value is None or value < MIN_VALUE:
        continue

    # CPV prefix match
    all_cpvs = extract_all_cpvs(r)
    cpv_list = [c.strip() for c in all_cpvs.split(",")]
    if not any(c.startswith(prefix) for c in cpv_list for prefix in CPV_PREFIXES):
        continue

    filtered.append(r)


# ---------------------------
# OUTPUT
# ---------------------------
print(f"\nFound {len(filtered)} qualifying notices.\n")

for r in filtered:
    tender   = r.get("tender", {})
    all_cpvs = [c.strip() for c in extract_all_cpvs(r).split(",")]
    cpv      = ", ".join(c for c in all_cpvs if any(c.startswith(p) for p in CPV_PREFIXES))

    value    = (tender.get("value") or {}).get("amount")
    currency = (tender.get("value") or {}).get("currency", "GBP")

    parties = r.get("parties", [])
    buyer   = next(
        (p.get("name") for p in parties if "buyer" in p.get("roles", [])),
        parties[0].get("name", "N/A") if parties else "N/A"
    )

    # ID format: rls-{release_num}-MAR{notice_id}
    # → strip "rls-{n}-MAR" to get the numeric notice ID
    notice_id = r.get("id", "N/A")
    try:
        pcs_num = notice_id.split("-MAR")[1]
        pcs_url = f"https://www.publiccontractsscotland.gov.uk/Search/Show/{pcs_num}"
    except (IndexError, AttributeError):
        pcs_url = "https://www.publiccontractsscotland.gov.uk"

    description = (
        tender.get("description")
        or r.get("description")
        or "(No description provided)"
    )
    deadline = (tender.get("tenderPeriod") or {}).get("endDate", "N/A")

    print(f"Title:       {tender.get('title', 'N/A')}")
    print(f"ID:          {notice_id}")
    print(f"Buyer:       {buyer}")
    print(f"CPV:         {cpv}")
    print(f"Value:       {currency} {value:,.0f}" if value else "Value:       N/A")
    print(f"Stage:       {r.get('tag', 'N/A')}")
    print(f"Published:   {r.get('date', 'N/A')}")
    print(f"Deadline:    {deadline}")
    print(f"URL:         {pcs_url}")
    print("Description:")
    print(description)
    print("-" * 60)


    #MONTHS_BACK — since PCS lags (latest release is Mar 17, not Mar 30), for daily use you may want 
    # to set MONTHS_BACK = 2 to always catch the tail end of the previous month as well, otherwise 
    # you'd miss notices published in late February when running in early March.

 