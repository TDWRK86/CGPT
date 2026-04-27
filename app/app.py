from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path
from typing import Optional
from pydantic import BaseModel

from app.scraper.contracts_finder import fetch_contracts_finder
from app.scraper.pcs import fetch_pcs
from app.scraper.find_tender import (
    load_findtender_opps,
    load_csv,
    filter_opportunities,
    _load_batches,
    load_triage,
    save_triage_session,
    delete_triage_session,
    update_triage_session_opportunities,
    load_source_csv,
    save_to_source_csv,
    _load_source_batches,
    _get_or_create_source_batch,
    backfill_contract_months,
    backfill_awarded_suppliers,
)

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI()

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# ---- Triage request model ----
class TriageOpportunity(BaseModel):
    id: str
    title: str = ""
    buyer: str = ""
    value: float | None = None
    cpvs: str = ""
    stage: str = ""
    published_date: str = ""
    description: str = ""
    source_url: str | None = None
    score: int = 0
    notes: str = ""
    contract_start: str = ""
    contract_end: str = ""

class TriageSessionRequest(BaseModel):
    opportunities: list[TriageOpportunity]

class TriagePatchRequest(BaseModel):
    opportunities: list[TriageOpportunity]


# -----------------------------------------------------------------------
# HOME
# -----------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={})


# -----------------------------------------------------------------------
# FIND A TENDER
# -----------------------------------------------------------------------

@app.post("/backfill/contract-months")
def backfill_months():
    """Re-fetch contract months for FaT rows where the field is empty."""
    updated = backfill_contract_months()
    return JSONResponse({"updated": updated})


@app.post("/backfill/awarded-suppliers")
def backfill_suppliers():
    """Re-fetch awarded supplier names for FaT award/contract rows where the field is empty."""
    updated = backfill_awarded_suppliers()
    return JSONResponse({"updated": updated})


@app.post("/load")
def load_opportunities():
    """Fetch today's + yesterday's FaT opportunities, append new records to CSV."""
    total_fetched, new_saved, batch_id = load_findtender_opps()
    state = _load_batches()
    return JSONResponse({
        "total_fetched": total_fetched,
        "new_saved": new_saved,
        "batch_id": batch_id,
        "last_seen_batch_id": state.get("last_seen_batch_id"),
    })


@app.get("/batches")
def get_batches():
    """Return FaT batch metadata in reverse-chronological order."""
    state = _load_batches()
    return JSONResponse({
        "batches": sorted(state.get("batches", []), key=lambda b: b["batch_id"], reverse=True),
        "active_batch_id": state.get("active_batch_id"),
        "last_seen_batch_id": state.get("last_seen_batch_id"),
    })


@app.get("/opportunities")
def get_opportunities(
    cpv_prefixes: Optional[str] = Query(None),
    min_value: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
    stages: Optional[str] = Query(None),
    buyer: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    framework_only: Optional[bool] = Query(None),
):
    all_opps  = load_csv()
    cpv_list  = [p.strip() for p in cpv_prefixes.split(",") if p.strip()] if cpv_prefixes else None
    stage_list = [s.strip() for s in stages.split(",") if s.strip()] if stages else None
    filtered  = filter_opportunities(
        all_opps,
        cpv_prefixes=cpv_list,
        min_value=min_value,
        max_value=max_value,
        stages=stage_list,
        buyer=buyer,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
        framework_only=bool(framework_only),
    )
    return JSONResponse(sorted(filtered, key=lambda o: o.get("published_date") or "", reverse=True))


# -----------------------------------------------------------------------
# CONTRACTS FINDER
# -----------------------------------------------------------------------

@app.post("/load/contracts-finder")
def load_cf():
    """Fetch the last 7 days from Contracts Finder, append new records to CF CSV."""
    opps = fetch_contracts_finder(days_back=7)
    batch_id = _get_or_create_source_batch("cf")
    new_saved = save_to_source_csv("cf", opps, batch_id)
    state = _load_source_batches("cf")
    return JSONResponse({
        "total_fetched": len(opps),
        "new_saved": new_saved,
        "batch_id": batch_id,
        "last_seen_batch_id": state.get("last_seen_batch_id"),
    })


@app.get("/batches/contracts-finder")
def get_cf_batches():
    """Return CF batch metadata in reverse-chronological order."""
    state = _load_source_batches("cf")
    return JSONResponse({
        "batches": sorted(state.get("batches", []), key=lambda b: b["batch_id"], reverse=True),
        "active_batch_id": state.get("active_batch_id"),
        "last_seen_batch_id": state.get("last_seen_batch_id"),
    })


@app.get("/live/contracts-finder")
def live_contracts_finder(
    cpv_prefixes: Optional[str] = Query(None),
    min_value: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
    stages: Optional[str] = Query(None),
    buyer: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
):
    """Read CF opportunities from the saved CSV and apply filters."""
    all_opps  = load_source_csv("cf")
    cpv_list  = [p.strip() for p in cpv_prefixes.split(",") if p.strip()] if cpv_prefixes else None
    stage_list = [s.strip() for s in stages.split(",") if s.strip()] if stages else None
    filtered  = filter_opportunities(
        all_opps,
        cpv_prefixes=cpv_list,
        min_value=min_value,
        max_value=max_value,
        stages=stage_list,
        buyer=buyer,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
    )
    return JSONResponse(sorted(filtered, key=lambda o: o.get("published_date") or "", reverse=True))


# -----------------------------------------------------------------------
# PUBLIC CONTRACTS SCOTLAND
# -----------------------------------------------------------------------

@app.post("/load/pcs")
def load_pcs():
    """Fetch the last 2 months from Public Contracts Scotland, append new records to PCS CSV."""
    opps = fetch_pcs(months_back=2)
    batch_id = _get_or_create_source_batch("pcs")
    new_saved = save_to_source_csv("pcs", opps, batch_id)
    state = _load_source_batches("pcs")
    return JSONResponse({
        "total_fetched": len(opps),
        "new_saved": new_saved,
        "batch_id": batch_id,
        "last_seen_batch_id": state.get("last_seen_batch_id"),
    })


@app.get("/batches/pcs")
def get_pcs_batches():
    """Return PCS batch metadata in reverse-chronological order."""
    state = _load_source_batches("pcs")
    return JSONResponse({
        "batches": sorted(state.get("batches", []), key=lambda b: b["batch_id"], reverse=True),
        "active_batch_id": state.get("active_batch_id"),
        "last_seen_batch_id": state.get("last_seen_batch_id"),
    })


@app.get("/live/pcs")
def live_pcs(
    cpv_prefixes: Optional[str] = Query(None),
    min_value: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
    stages: Optional[str] = Query(None),
    buyer: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
):
    """Read PCS opportunities from the saved CSV and apply filters."""
    all_opps  = load_source_csv("pcs")
    cpv_list  = [p.strip() for p in cpv_prefixes.split(",") if p.strip()] if cpv_prefixes else None
    stage_list = [s.strip() for s in stages.split(",") if s.strip()] if stages else None
    filtered  = filter_opportunities(
        all_opps,
        cpv_prefixes=cpv_list,
        min_value=min_value,
        max_value=max_value,
        stages=stage_list,
        buyer=buyer,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
    )
    return JSONResponse(sorted(filtered, key=lambda o: o.get("published_date") or "", reverse=True))


# -----------------------------------------------------------------------
# TRIAGE
# -----------------------------------------------------------------------

@app.get("/triage")
def get_triage():
    """Return all triage sessions, most recent first."""
    state = load_triage()
    sessions = sorted(state.get("sessions", []), key=lambda s: s["session_id"], reverse=True)
    return JSONResponse({"sessions": sessions})


@app.post("/triage", status_code=201)
def post_triage(body: TriageSessionRequest):
    """Save a new triage session from the current review selections."""
    if not body.opportunities:
        return JSONResponse({"error": "No opportunities provided"}, status_code=422)
    opps = [o.model_dump() for o in body.opportunities]
    session = save_triage_session(opps)
    return JSONResponse(session, status_code=201)


@app.patch("/triage/{session_id}", status_code=200)
def patch_triage(session_id: str, body: TriagePatchRequest):
    """Update the opportunities (e.g. notes) on an existing triage session."""
    opps = [o.model_dump() for o in body.opportunities]
    found = update_triage_session_opportunities(session_id, opps)
    if not found:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse({"ok": True})


@app.delete("/triage/{session_id}", status_code=204)
def delete_triage(session_id: str):
    """Delete a triage session by ID."""
    found = delete_triage_session(session_id)
    if not found:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return Response(status_code=204)
