from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

from app.scraper.find_tender import load_findtender_opps

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI()

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"opportunities": []}
    )

@app.post("/load", response_class=HTMLResponse)
def load_opportunities(request: Request):
    opportunities = load_findtender_opps()
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"opportunities": opportunities}
    )