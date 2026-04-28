#!/bin/bash
set -e

DUMP_FILE="/docker-entrypoint-initdb.d/agentic_hr_db.dump"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE DATABASE nocodb;
    GRANT ALL PRIVILEGES ON DATABASE nocodb TO $POSTGRES_USER;

    CREATE DATABASE mattermost;
    GRANT ALL PRIVILEGES ON DATABASE mattermost TO $POSTGRES_USER;

    CREATE DATABASE gitea;
    GRANT ALL PRIVILEGES ON DATABASE gitea TO $POSTGRES_USER;
EOSQL

if [[ -f "$DUMP_FILE" ]]; then
    echo "Found dump file at $DUMP_FILE. Restoring into database '$POSTGRES_DB'..."
    pg_restore \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        "$DUMP_FILE"
else
    echo "No dump file found. Creating default RAG + audit schema in '$POSTGRES_DB'..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        CREATE EXTENSION IF NOT EXISTS vector;

        CREATE TABLE IF NOT EXISTS documents (
            document_id    TEXT PRIMARY KEY,
            filename       TEXT NOT NULL,
            raw_markdown   TEXT NOT NULL,
            ingested_at    TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS parent_chunks (
            parent_id      TEXT PRIMARY KEY,
            document_id    TEXT REFERENCES documents(document_id),
            heading        TEXT NOT NULL,
            content        TEXT NOT NULL,
            summary        TEXT,
            chunk_index    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS child_chunks (
            child_id       TEXT PRIMARY KEY,
            parent_id      TEXT REFERENCES parent_chunks(parent_id),
            content        TEXT NOT NULL,
            window_index   INTEGER NOT NULL,
            embedding      vector(384),
            ts_content     tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
        );

        CREATE INDEX IF NOT EXISTS idx_child_chunks_fts
            ON child_chunks USING GIN (ts_content);

        CREATE TABLE IF NOT EXISTS audit_events (
            id             BIGSERIAL PRIMARY KEY,
            event_ts       TIMESTAMPTZ DEFAULT now(),
            session_id     TEXT,
            employee_id    TEXT,
            employee_email TEXT,
            intent         TEXT,
            worker         TEXT,
            tools_called   JSONB,
            evidence_used  JSONB,
            outcome        TEXT,
            response_text  TEXT,
            llm_trace      JSONB
        );
EOSQL
fi
