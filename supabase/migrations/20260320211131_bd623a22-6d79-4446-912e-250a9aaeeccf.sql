CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.email_search_cache
  ADD COLUMN IF NOT EXISTS body_text text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.email_search_cache_document_v2(
  p_subject text,
  p_snippet text,
  p_from_name text,
  p_from_email text,
  p_to_addresses jsonb,
  p_cc_addresses jsonb,
  p_attachment_names text[],
  p_body_text text
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT to_tsvector('simple', trim(both ' ' from concat_ws(' ',
    coalesce(p_subject, ''),
    coalesce(p_snippet, ''),
    coalesce(p_from_name, ''),
    coalesce(p_from_email, ''),
    coalesce((select string_agg(trim(both ' ' from concat_ws(' ', addr->>'name', addr->>'email')), ' ') from jsonb_array_elements(coalesce(p_to_addresses, '[]'::jsonb)) addr), ''),
    coalesce((select string_agg(trim(both ' ' from concat_ws(' ', addr->>'name', addr->>'email')), ' ') from jsonb_array_elements(coalesce(p_cc_addresses, '[]'::jsonb)) addr), ''),
    array_to_string(coalesce(p_attachment_names, '{}'), ' '),
    left(coalesce(p_body_text, ''), 8000)
  )));
$function$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_search_cache'
      AND column_name = 'search_document'
  ) THEN
    ALTER TABLE public.email_search_cache DROP COLUMN search_document;
  END IF;
END $$;

ALTER TABLE public.email_search_cache
ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
  public.email_search_cache_document_v2(subject, snippet, from_name, from_email, to_addresses, cc_addresses, attachment_names, body_text)
) STORED;

CREATE INDEX IF NOT EXISTS email_search_cache_search_document_idx
  ON public.email_search_cache
  USING gin (search_document);

CREATE INDEX IF NOT EXISTS email_search_cache_body_text_trgm_idx
  ON public.email_search_cache
  USING gin (lower(body_text) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_email_search_cache(
  p_account_key text,
  p_folder_id text,
  p_query text,
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(uid bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT nullif(trim(coalesce(p_query, '')), '') AS query_text
  ), prepared AS (
    SELECT query_text, lower(query_text) AS query_text_lower
    FROM normalized
    WHERE query_text IS NOT NULL
  )
  SELECT cache.uid
  FROM public.email_search_cache cache
  CROSS JOIN prepared
  WHERE cache.account_key = p_account_key
    AND cache.folder_id = p_folder_id
    AND (
      cache.search_document @@ websearch_to_tsquery('simple', prepared.query_text)
      OR cache.subject ILIKE '%' || prepared.query_text || '%'
      OR cache.snippet ILIKE '%' || prepared.query_text || '%'
      OR cache.from_name ILIKE '%' || prepared.query_text || '%'
      OR cache.from_email ILIKE '%' || prepared.query_text || '%'
      OR lower(cache.body_text) LIKE '%' || prepared.query_text_lower || '%'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cache.to_addresses) addr
        WHERE concat_ws(' ', addr->>'name', addr->>'email') ILIKE '%' || prepared.query_text || '%'
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cache.cc_addresses) addr
        WHERE concat_ws(' ', addr->>'name', addr->>'email') ILIKE '%' || prepared.query_text || '%'
      )
      OR EXISTS (
        SELECT 1
        FROM unnest(cache.attachment_names) attachment_name
        WHERE attachment_name ILIKE '%' || prepared.query_text || '%'
      )
    )
  ORDER BY
    CASE WHEN lower(cache.body_text) LIKE '%' || prepared.query_text_lower || '%' THEN 1 ELSE 0 END DESC,
    ts_rank_cd(cache.search_document, websearch_to_tsquery('simple', prepared.query_text)) DESC NULLS LAST,
    cache.sent_at DESC,
    cache.uid DESC
  LIMIT greatest(coalesce(p_limit, 1000), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$function$;