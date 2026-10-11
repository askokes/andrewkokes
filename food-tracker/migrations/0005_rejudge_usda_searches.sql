-- Searches are now ranked and judged with a stricter idea of a fair answer: a hit must have every word
-- of the phrase that says which food it is ("blue moon beer" is not just any beer), and a search with
-- no fair answer is remembered as empty. Cached searches keep the old order for up to 30 days, so
-- forget them; each is searched again the next time someone asks. Cached foods (usda_cache) stay.

DELETE FROM usda_search_cache;
