"""
ingest.py — main entry point for the PDF ingestion pipeline.

Usage (from project root):
    python -m ingestion.ingest

Processes all PDFs in hr_policy_pdfs/ and stores vectors in PostgreSQL.
"""
import hashlib
from pathlib import Path

from docling.document_converter import DocumentConverter

from logger import configure_logging, get_logger
from config import PDF_DIR, OUTPUT_DIR
from chunker import split_by_headings, create_child_windows
from embedder import embed_texts
from summarizer import summarize_section
from db import get_conn, store_document, build_hnsw_index

configure_logging()
log = get_logger(__name__)


def ingest_pdf(pdf_path: Path, conn) -> None:
    log.info("=== Ingesting: %s ===", pdf_path.name)

    log.debug("Parsing PDF with Docling")
    converter = DocumentConverter()
    result = converter.convert(str(pdf_path))
    markdown = result.document.export_to_markdown()
    log.info("PDF parsed | file=%s | markdown_len=%d chars", pdf_path.name, len(markdown))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    md_path = OUTPUT_DIR / (pdf_path.stem + ".md")
    md_path.write_text(markdown, encoding="utf-8")
    log.debug("Raw markdown saved to %s", md_path)

    doc_id = hashlib.md5(pdf_path.name.encode()).hexdigest()[:12]

    log.info("Splitting into parent sections | file=%s", pdf_path.name)
    parent_sections = split_by_headings(markdown)
    log.info("Parent sections: %d | file=%s", len(parent_sections), pdf_path.name)

    log.info("Summarising %d section(s) | file=%s", len(parent_sections), pdf_path.name)
    for i, section in enumerate(parent_sections):
        log.debug("Summarising section %d/%d: %r", i + 1, len(parent_sections), section["heading"][:60])
        section["summary"] = summarize_section(section["heading"], section["content"])

    log.info("Creating child windows and embedding | file=%s", pdf_path.name)
    child_windows_with_embeddings: list[list[dict]] = []
    total_windows = 0
    for section in parent_sections:
        windows = create_child_windows(section["content"])
        if not windows:
            child_windows_with_embeddings.append([])
            continue
        embeddings = embed_texts(windows)
        children = [{"text": w, "embedding": e} for w, e in zip(windows, embeddings)]
        child_windows_with_embeddings.append(children)
        total_windows += len(children)

    log.info("Child windows created: %d | file=%s", total_windows, pdf_path.name)

    store_document(
        conn,
        doc_id=doc_id,
        filename=pdf_path.name,
        markdown=markdown,
        parent_sections=parent_sections,
        child_windows_with_embeddings=child_windows_with_embeddings,
    )
    log.info("=== Done: %s ===", pdf_path.name)


def main():
    pdf_paths = sorted(PDF_DIR.glob("*.pdf"))
    if not pdf_paths:
        log.warning("No PDFs found in %s", PDF_DIR)
        return

    log.info("Starting ingestion | pdf_count=%d | source_dir=%s", len(pdf_paths), PDF_DIR)
    conn = get_conn()
    try:
        for pdf_path in pdf_paths:
            ingest_pdf(pdf_path, conn)

        log.info("All PDFs ingested — building HNSW index")
        build_hnsw_index(conn)
        log.info("Ingestion pipeline complete")
    except Exception as e:
        log.error("Ingestion failed: %s", e, exc_info=True)
        raise
    finally:
        conn.close()
        log.debug("PostgreSQL connection closed")


if __name__ == "__main__":
    main()
