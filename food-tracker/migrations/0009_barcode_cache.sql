-- Scanned barcodes: which food each one is, so a product is looked up once.
-- fdc_id points into usda_cache (a USDA branded food, or an Open Food Facts
-- product under an id from 1e15 up); null means nobody had it, and is looked
-- up again after a week.

CREATE TABLE barcode_cache (
  code TEXT PRIMARY KEY,                        -- the barcode's digits without leading zeros
  fdc_id INTEGER,                               -- null: not found
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
