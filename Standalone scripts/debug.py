import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"

# Test 1 — baseline, no pagination param (this worked before)
params = {
    "limit": 100,
    "updatedFrom": "2026-03-26T00:00:00",
    "updatedTo":   "2026-03-26T23:59:59"
}
resp = requests.get(url, params=params, verify=False)
data = resp.json()
print("Test 1 (no pagination):", len(data.get("releases", [])), "results")

# Test 2 — with offset=0
params["offset"] = 0
resp = requests.get(url, params=params, verify=False)
data = resp.json()
print("Test 2 (offset=0):", len(data.get("releases", [])), "results")

# Test 3 — check what the API says about total count
print("Test 3 — raw response keys:", data.keys())
print("Full response (trimmed):", str(data)[:500])

# Test 4 — check if cursor is returned in the response
params = {
    "limit": 100,
    "updatedFrom": "2026-03-26T00:00:00",
    "updatedTo":   "2026-03-26T23:59:59"
}
resp = requests.get(url, params=params, verify=False)
data = resp.json()
print("Top level keys:", data.keys())
print("releases count:", len(data.get("releases", [])))
print("cursor value:", data.get("cursor"))
print("links:", data.get("links"))