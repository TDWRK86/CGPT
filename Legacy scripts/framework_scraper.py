import requests
import urllib3
from datetime import datetime, timezone

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------------------
# KEYWORD SETTINGS
# ---------------------------
KEYWORD = "framework"  # case-insensitive match
# ---------------------------


def get_buyer_names(release):
    names = []
    for p in release.get("parties", []) or []:
        n = p.get("name")
        if n:
            names.append(n)
    return " | ".join(names) if names else "N/A"


def build_search_blob(release):
    """
    Build a single string containing the fields we want to keyword-scan.
    Kept simple and resilient to missing fields.
    """
    tender = release.get("tender", {}) or {}

    fields = [
        tender.get("title", ""),
        tender.get("description", ""),
        release.get("title", ""),
        release.get("description", ""),
        get_buyer_names(release),
    ]

    # Ensure everything is string, join, and lower for case-insensitive search
    return " ".join(str(f) for f in fields if f).lower()


# ---------------------------
# BUILD DATE WINDOW (UTC "today")
# ---------------------------
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
start = f"{today}T00:00:00"
end   = f"{today}T23:59:59"

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

page = 1
while next_url:
    print(f"Fetching page {page}...")
    if page == 1:
        resp = requests.get(next_url, params=params, verify=False, timeout=60)
    else:
        resp = requests.get(next_url, verify=False, timeout=60)

    resp.raise_for_status()
    data = resp.json()

    batch = data.get("releases", []) or []
    releases.extend(batch)

    next_url = (data.get("links") or {}).get("next")
    page += 1

print(f"Total releases fetched: {len(releases)}\n")



# ---------------------------
# FILTER: keyword contains "framework"
# ---------------------------
matches = []
kw = KEYWORD.lower()

EXCLUDE_TAGS = {"award", "awardUpdate"}  # you can add "contract", "contractUpdate" etc if needed

for r in releases:
    tags = r.get("tag", []) or []
    if any(t in EXCLUDE_TAGS for t in tags):
        continue

    blob = build_search_blob(r)
    if kw in blob:
        matches.append(r)


# ---------------------------
# OUTPUT
# ---------------------------
print(f"Found {len(matches)} notices containing '{KEYWORD}' today.\n")

for r in matches:
    tender = r.get("tender", {}) or {}

    description = (
        tender.get("description")
        or r.get("description")
        or "(No description provided in OCDS feed)"
    )

    print("Title:",       tender.get("title") or r.get("title") or "N/A")
    print("ID:",          r.get("id", "N/A"))
    print("Buyer(s):",    get_buyer_names(r))
    print("Stage/Tags:",  r.get("tag", "N/A"))
    print("Published:",   r.get("date", "N/A"))
    print("Description:")
    print(description)
    print("-" * 60)

 