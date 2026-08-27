import { sql } from "drizzle-orm";
import { db } from "@/db";

let ready: Promise<void> | null = null;

export function ensureFinancialIngestionTables(): Promise<void> {
  if (!ready) {
    ready = db.execute(sql`
      CREATE TABLE IF NOT EXISTS financial_source_documents (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        source VARCHAR(30) NOT NULL,
        document_type VARCHAR(40) NOT NULL,
        document_url TEXT NOT NULL,
        document_hash VARCHAR(64) NOT NULL UNIQUE,
        source_content_hash VARCHAR(64),
        report_type VARCHAR(40),
        period VARCHAR(10),
        fiscal_year INTEGER,
        filing_date VARCHAR(10),
        retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        content_type VARCHAR(80),
        parser_version VARCHAR(30) NOT NULL DEFAULT 'raw-v1',
        status VARCHAR(20) NOT NULL DEFAULT 'raw',
        raw_payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fs_source_doc_symbol_idx ON financial_source_documents(symbol, retrieved_at);
      ALTER TABLE financial_source_documents ADD COLUMN IF NOT EXISTS source_content_hash VARCHAR(64);
      CREATE TABLE IF NOT EXISTS financial_normalized_facts (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES financial_source_documents(id),
        symbol VARCHAR(20) NOT NULL,
        statement_type VARCHAR(20) NOT NULL,
        period VARCHAR(10) NOT NULL,
        fiscal_year INTEGER NOT NULL,
        report_scope VARCHAR(20) NOT NULL DEFAULT 'consolidated',
        currency VARCHAR(10) NOT NULL DEFAULT 'VND',
        unit VARCHAR(30) NOT NULL DEFAULT 'reported',
        period_end VARCHAR(10),
        filing_date VARCHAR(10),
        source VARCHAR(30) NOT NULL,
        source_url TEXT NOT NULL,
        quality_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified',
        quality_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
        data JSONB NOT NULL,
        normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(symbol, statement_type, period, fiscal_year, report_scope, source)
      );
      CREATE INDEX IF NOT EXISTS fs_normalized_symbol_idx ON financial_normalized_facts(symbol, fiscal_year, period);
      ALTER TABLE financial_normalized_facts ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified';
      CREATE TABLE IF NOT EXISTS financial_llm_outputs (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        analysis_type VARCHAR(20) NOT NULL,
        period_key VARCHAR(80) NOT NULL,
        input_fingerprint VARCHAR(64) NOT NULL UNIQUE,
        model VARCHAR(80) NOT NULL,
        source_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        output JSONB NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'valid',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS financial_llm_symbol_idx ON financial_llm_outputs(symbol, analysis_type, updated_at);
    `).then(() => undefined);
  }
  return ready;
}
