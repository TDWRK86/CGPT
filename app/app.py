from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path
from typing import Optional
from pydantic import BaseModel

from app.scraper.find_tender import (
    load_findtender_opps,
    load_csv,
    filter_opportunities,
    _load_batches,
    load_triage,
    save_triage_session,
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

class TriageSessionRequest(BaseModel):
    opportunities: list[TriageOpportunity]


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )


@app.post("/load")
def load_opportunities():
    """
    Fetch today's + yesterday's opportunities from Find a Tender,
    append new records to the CSV (deduplicating by id).
    Seals the previous batch and opens a new one if the active batch has rows.
    """
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
    """Return batch metadata in reverse-chronological order."""
    state = _load_batches()
    batches = sorted(
        state.get("batches", []),
        key=lambda b: b["batch_id"],
        reverse=True,
    )
    return JSONResponse({
        "batches": batches,
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
):
    all_opps = load_csv()
    cpv_list   = [p.strip() for p in cpv_prefixes.split(",") if p.strip()] if cpv_prefixes else None
    stage_list = [s.strip() for s in stages.split(",") if s.strip()] if stages else None

    filtered = filter_opportunities(
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

    sorted_filtered = sorted(
        filtered,
        key=lambda o: o.get("published_date") or "",
        reverse=True,
    )
    return JSONResponse(sorted_filtered)


@app.get("/triage")
def get_triage():
    """Return all triage sessions, most recent first."""
    state = load_triage()
    sessions = sorted(
        state.get("sessions", []),
        key=lambda s: s["session_id"],
        reverse=True,
    )
    return JSONResponse({"sessions": sessions})


@app.post("/triage", status_code=201)
def post_triage(body: TriageSessionRequest):
    """Save a new triage session from the current review selections."""
    if not body.opportunities:
        return JSONResponse({"error": "No opportunities provided"}, status_code=422)
    opps = [o.model_dump() for o in body.opportunities]
    session = save_triage_session(opps)
    return JSONResponse(session, status_code=201)
