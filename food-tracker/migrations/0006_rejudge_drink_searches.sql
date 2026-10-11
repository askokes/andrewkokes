-- Drinks, cocktails and snacks are judged more strictly (a pale ale mustard is no pale ale, a cherry
-- cabernet vinegar no Cabernet, prime beef no PRIME drink). Cached searches keep their old picks for
-- up to 30 days, so forget them; each is searched again the next time someone asks. Cached foods
-- (usda_cache) stay.

DELETE FROM usda_search_cache;
