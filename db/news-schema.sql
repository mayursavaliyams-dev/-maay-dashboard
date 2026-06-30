-- ════════════════════════════════════════════════════════════════════════════
-- News Intelligence Engine — PostgreSQL schema (production DB module)
-- The running engine persists to JSONL/JSON today; this is the target schema for
-- the Postgres module. Apply with: psql "$DATABASE_URL" -f db/news-schema.sql
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news_sources (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sectors (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS stocks (
  symbol  TEXT PRIMARY KEY,
  name    TEXT,
  sector  TEXT REFERENCES sectors(name),
  aliases TEXT[]
);

CREATE TABLE IF NOT EXISTS news_articles (
  id            TEXT PRIMARY KEY,                 -- dedup hash (link + normalized title)
  title         TEXT NOT NULL,
  summary       TEXT,
  url           TEXT,
  source_id     TEXT REFERENCES news_sources(id),
  published_at  TIMESTAMPTZ,
  -- sentiment
  sentiment     TEXT CHECK (sentiment IN ('BULLISH','BEARISH','NEUTRAL')),
  sent_score    INTEGER,                          -- -100..100
  confidence    INTEGER,                          -- 0..100
  impact_score  INTEGER,                          -- 0..100
  affected_stocks  TEXT[],
  affected_sectors TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_sectors   ON news_articles USING GIN (affected_sectors);
CREATE INDEX IF NOT EXISTS idx_news_stocks    ON news_articles USING GIN (affected_stocks);

-- Macro / corporate event calendar (RBI, earnings, economic prints, actions)
CREATE TABLE IF NOT EXISTS events (
  id      BIGSERIAL PRIMARY KEY,
  date    DATE NOT NULL,
  type    TEXT NOT NULL,                          -- RBI_POLICY, BUDGET, FED, GDP, CPI, RESULTS, DIVIDEND, ...
  title   TEXT NOT NULL,
  impact  TEXT,                                   -- LOW / MEDIUM / HIGH
  symbol  TEXT,
  UNIQUE (date, type, title)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (date);

-- FII/DII cash + derivative daily flows (Rs crore)
CREATE TABLE IF NOT EXISTS fii_dii (
  date              DATE PRIMARY KEY,
  fii_cash          REAL,
  dii_cash          REAL,
  fii_index_fut     REAL,
  fii_index_opt     REAL,
  fii_stock_fut     REAL,
  fii_stock_opt     REAL,
  raw               JSONB
);

-- India VIX time series
CREATE TABLE IF NOT EXISTS india_vix (
  ts          TIMESTAMPTZ PRIMARY KEY,
  value       REAL NOT NULL,
  change      REAL,
  change_pct  REAL,
  regime      TEXT
);

-- Rolled-up scores snapshot (optional cache for the dashboard)
CREATE TABLE IF NOT EXISTS market_scores (
  ts                TIMESTAMPTZ PRIMARY KEY DEFAULT now(),
  market_sentiment  TEXT,
  market_score      INTEGER,
  event_risk_score  INTEGER,
  vix_value         REAL,
  payload           JSONB
);
