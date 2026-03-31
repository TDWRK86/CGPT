import requests
import urllib3
from datetime import datetime, timezone, timedelta

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------
# FILTER SETTINGS
# ---------------------------
MIN_VALUE = 100_000

# How many days back to search (1 = today only, 7 = last week, etc.)
# Set to 7 temporarily to confirm the API is returning data at all,
# then drop back to 1 for daily use
DAYS_BACK = 1

# ---------------------------
# BUILD DATE WINDOW
# ---------------------------
now   = datetime.now(timezone.utc)
start = (now - timedelta(days=DAYS_BACK - 1)).strftime("%Y-%m-%dT00:00:00")
end   = now.strftime("%Y-%m-%dT23:59:59")

BASE_URL = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"

print(f"Searching from {start} to {end}")
print(f"Minimum value: £{MIN_VALUE:,}\n")

# ---------------------------
# PAGINATED FETCH
# Pass stages as a pre-built query string to avoid %2C comma encoding,
# which some CF API versions don't decode correctly
# ---------------------------
releases = []
page = 1

query_string = (
    f"?publishedFrom={start}"
    f"&publishedTo={end}"
    f"&stages=planning"
    f"&stages=tender"
    f"&limit=100"
)
first_url = BASE_URL + query_string

resp = requests.get(first_url, verify=False)
print(f"Request URL: {resp.url}\n")
resp.raise_for_status()
data = resp.json()

batch = data.get("releases", [])
releases.extend(batch)
print(f"Page {page}: {len(batch)} releases")

next_url = data.get("links", {}).get("next")
page += 1

while next_url:
    resp = requests.get(next_url, verify=False)
    resp.raise_for_status()
    data = resp.json()
    batch = data.get("releases", [])
    releases.extend(batch)
    print(f"Page {page}: {len(batch)} releases")
    next_url = data.get("links", {}).get("next")
    page += 1

print(f"\nTotal releases fetched: {len(releases)}")

# ---------------------------
# FILTER
# ---------------------------
filtered = []

for r in releases:
    tender = r.get("tender", {})
    value  = (tender.get("value") or {}).get("amount")

    if value is None or value < MIN_VALUE:
        continue

    filtered.append(r)

# ---------------------------
# OUTPUT
# ---------------------------
print(f"Found {len(filtered)} qualifying notices (>=£{MIN_VALUE:,}).\n")

for r in filtered:
    tender   = r.get("tender", {})
    value    = (tender.get("value") or {}).get("amount")
    currency = (tender.get("value") or {}).get("currency", "GBP")

    parties = r.get("parties", [])
    buyer   = next(
        (p.get("name") for p in parties if "buyer" in p.get("roles", [])),
        parties[0].get("name", "N/A") if parties else "N/A"
    )

    notice_id = r.get("id", "N/A")
    parts     = notice_id.split("-")
    # The ID format is: {GUID}-{release-number}, so just strip the last segment
    cf_guid = "-".join(notice_id.split("-")[:-1])
    cf_url = f"https://www.contractsfinder.service.gov.uk/Notice/{cf_guid}"

    description = (
        tender.get("description")
        or r.get("description")
        or "(No description provided)"
    )

    deadline = (tender.get("tenderPeriod") or {}).get("endDate", "N/A")

    print(f"Title:       {tender.get('title', 'N/A')}")
    print(f"ID:          {notice_id}")
    print(f"Buyer:       {buyer}")
    print(f"Value:       {currency} {value:,.0f}" if value else "Value:       N/A")
    print(f"Stage:       {r.get('tag', 'N/A')}")
    print(f"Published:   {r.get('date', 'N/A')}")
    print(f"Deadline:    {deadline}")
    print(f"URL:         {cf_url}")
    print("Description:")
    print(description)
    print("-" * 60)

 