from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path
from typing import Optional

from app.scraper.find_tender import (
    load_findtender_opps,
    load_csv,
    filter_opportunities,
    _load_batches,
)

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI()

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


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
    """
    Return batch metadata in reverse-chronological order.
    """
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
    cpv_prefixes: Optional[str] = Query(None, description="Comma-separated CPV prefixes, e.g. '30,48,72'"),
    min_value: Optional[float] = Query(None),
    max_value: Optional[float] = Query(None),
    stages: Optional[str] = Query(None, description="Comma-separated stage tags"),
    buyer: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    keyword: Optional[str] = Query(None, description="Free-text search across title, description, and buyer"),
):
    """
    Read all opportunities from the CSV and return a filtered JSON list.
    All filter params are optional — omit to return everything.
    """
    all_opps = load_csv()

    cpv_list = [p.strip() for p in cpv_prefixes.split(",") if p.strip()] if cpv_prefixes else None
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
