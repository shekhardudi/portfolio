from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from graph.builder import get_compiled_graph
from logger import configure_logging, get_logger
from api.chat import router as chat_router
from api.approvals import router as approvals_router
from db.connection import init_pool, close_pool
from db.embedder import embed_texts
configure_logging()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Agentic HR backend")
    init_pool()
    get_compiled_graph()  # warm up graph and all nodes at startup to avoid latency on first request
    embed_texts(["sample text"])  # warm up embedder
    log.info("PostgreSQL connection pool ready")
    yield
    log.info("Shutting down — closing connection pool")
    close_pool()


app = FastAPI(
    title="Agentic HR",
    description="AI-powered HR assistant with LangGraph orchestration",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(approvals_router)


@app.get("/health")
def health():
    log.debug("Health check")
    return {"status": "ok"}
