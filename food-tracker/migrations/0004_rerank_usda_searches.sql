-- Searches are now ranked from 50 USDA hits (was 10) with a new ranking, so
-- cached search results would keep the old, worse order for up to 30 days.
-- Forget them; each is searched again the next time someone asks. Cached
-- foods (usda_cache) stay.

DELETE FROM usda_search_cache;
