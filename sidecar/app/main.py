from fastapi import FastAPI

from app.models import GenerateRequest, GenerateResponse
from app.solver import solve

app = FastAPI(title="shift-scheduler-sidecar")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    status, assignments, elapsed, message = solve(req)
    return GenerateResponse(status=status, assignments=assignments, solveTimeSeconds=elapsed, message=message)
