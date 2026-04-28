import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Paths — ingestion/ lives at the project root
PROJECT_ROOT = Path(__file__).parent.parent
PDF_DIR = PROJECT_ROOT / "hr_policy_pdfs"
OUTPUT_DIR = Path(__file__).parent / "output_markdown"

# Chunking parameters
WINDOW_SIZE = 300     # words per child chunk
OVERLAP = 100         # word overlap between windows

# Embedding
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
EMBEDDING_DIMENSION = int(os.getenv("EMBEDDING_DIMENSION", "384"))

# PostgreSQL (read from env or defaults)
POSTGRES_DSN = (
    f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
    f"port={os.getenv('POSTGRES_PORT', '5432')} "
    f"dbname={os.getenv('POSTGRES_DB', 'agentic_hr')} "
    f"user={os.getenv('POSTGRES_USER', 'agentic_hr')} "
    f"password={os.getenv('POSTGRES_PASSWORD', 'agentic_hr_dev')}"
)

# LLM for summarization
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
SUMMARIZER_MODEL = os.getenv("LLM_FAST_MODEL", "claude-haiku-4-5-20251001")
