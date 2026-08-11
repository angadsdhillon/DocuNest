-- ============================================================================
-- DocuNest — Phase 1 follow-up: make words inside filenames searchable
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- The `search_vector` column added in the first Phase 1 migration indexed
-- `original_filename` directly. Postgres's English text search parser treats
-- something like `flight-itinerary.pdf` as a single file-path token rather
-- than as words, so it was indexed as one indivisible lump:
--
--     to_tsvector('english', 'flight-itinerary.pdf')
--       => 'flight-itinerary.pdf':1
--
-- Searching for "itinerary" therefore found nothing, even though the word is
-- plainly in the filename. Same for `Scan_2026_council tax.PDF`, which indexed
-- `tax.pdf` as one token. Since finding a document by half-remembering its
-- filename is a core promise of the product, that had to be fixed before any
-- documents exist.
--
-- The fix indexes the filename twice: once as written, so searching the exact
-- filename still works, and once with `. _ - / ( )` swapped for spaces, so the
-- individual words become searchable:
--
--     'flight':2 'flight-itinerary.pdf':1 'itinerari':3 'pdf':4
--
-- The AI summary needed no such treatment — it is ordinary prose.
--
-- The table is empty, so dropping and re-adding the generated column costs
-- nothing. Dropping a column also drops its index, so the GIN index is rebuilt
-- below.
-- ----------------------------------------------------------------------------

alter table public.documents drop column search_vector;

alter table public.documents
  add column search_vector tsvector generated always as (
    setweight(
      to_tsvector(
        'english',
        coalesce(original_filename, '')
          || ' '
          || translate(coalesce(original_filename, ''), '._-/()', '      ')
      ),
      'A'
    )
    || setweight(to_tsvector('english', coalesce(ai_summary, '')), 'B')
  ) stored;

create index documents_search_vector_idx
  on public.documents using gin (search_vector);

comment on column public.documents.search_vector is
  'Generated full-text index over original_filename (weight A, indexed both verbatim and split on punctuation so individual words match) and ai_summary (weight B).';
