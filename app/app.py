from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path
from typing import Optional
from datetime import datetime

from app.scraper.find_tender import (
    load_findtender_opps,
    load_csv,
    filter_opportunities,
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

    Returns JSON with counts so the frontend can display a summary.
    """
    total_fetched, new_saved = load_findtender_opps()
    return JSONResponse({
        "total_fetched": total_fetched,
        "new_saved": new_saved,
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
    )

    
    sorted_filtered = sorted(
        filtered,
        key=lambda o: datetime.fromisoformat(o["published_date"]),
        reverse=True,
    )


    return JSONResponse(sorted_filtered)
