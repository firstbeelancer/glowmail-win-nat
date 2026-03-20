
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.email_search_cache_document(
  p_subject text,
  p_snippet text,
  p_from_name text,
  p_from_email text,
  p_to_addresses jsonb,
  p_cc_addresses jsonb,
  p_attachment_names text[]
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'simple',
    trim(
      both ' ' from concat_ws(
        ' ',
        coalesce(p_subject, ''),
        coalesce(p_snippet, ''),
        coalesce(p_from_name, ''),
        coalesce(p_from_email, ''),
        coalesce(
          (
            select string_agg(trim(both ' ' from concat_ws(' ', addr->>'name', addr->>'email')), ' ')
            from jsonb_array_elements(coalesce(p_to_addresses, '[]'::jsonb)) addr
          ),
          ''
        ),
        coalesce(
          (
            select string_agg(trim(both ' ' from concat_ws(' ', addr->>'name', addr->>'email')), ' ')
            from jsonb_array_elements(coalesce(p_cc_addresses, '[]'::jsonb)) addr
          ),
          ''
        ),
        array_to_string(coalesce(p_attachment_names, '{}'), ' ')
      )
    )
  );
$$;

CREATE TABLE IF NOT EXISTS public.email_search_cache (
  id bigserial PRIMARY KEY,
  account_key text NOT NULL,
  account_email text NOT NULL,
  imap_host text NOT NULL,
  folder_id text NOT NULL,
  uid bigint NOT NULL,
  subject text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  from_name text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  to_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachment_names text[] NOT NULL DEFAULT '{}',
  has_attachments boolean NOT NULL DEFAULT false,
  flags text[] NOT NULL DEFAULT '{}',
  message_id text NOT NULL DEFAULT '',
  in_reply_to text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    public.email_search_cache_document(subject, snippet, from_name, from_email, to_addresses, cc_addresses, attachment_names)
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS email_search_cache_account_folder_uid_idx
  ON public.email_search_cache (account_key, folder_id, uid);

CREATE INDEX IF NOT EXISTS email_search_cache_search_document_idx
  ON public.email_search_cache USING gin (search_document);

CREATE INDEX IF NOT EXISTS email_search_cache_account_folder_sent_at_idx
  ON public.email_search_cache (account_key, folder_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.set_email_search_cache_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_email_search_cache_updated_at ON public.email_search_cache;
CREATE TRIGGER set_email_search_cache_updated_at
BEFORE UPDATE ON public.email_search_cache
FOR EACH ROW
EXECUTE FUNCTION public.set_email_search_cache_updated_at();

ALTER TABLE public.email_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.email_search_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

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
AS $$
  WITH normalized AS (
    SELECT nullif(trim(coalesce(p_query, '')), '') AS query_text
  )
  SELECT cache.uid
  FROM public.email_search_cache cache
  CROSS JOIN normalized
  WHERE cache.account_key = p_account_key
    AND cache.folder_id = p_folder_id
    AND normalized.query_text IS NOT NULL
    AND (
      cache.search_document @@ websearch_to_tsquery('simple', normalized.query_text)
      OR cache.subject ILIKE '%' || normalized.query_text || '%'
      OR cache.snippet ILIKE '%' || normalized.query_text || '%'
      OR cache.from_name ILIKE '%' || normalized.query_text || '%'
      OR cache.from_email ILIKE '%' || normalized.query_text || '%'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cache.to_addresses) addr
        WHERE concat_ws(' ', addr->>'name', addr->>'email') ILIKE '%' || normalized.query_text || '%'
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cache.cc_addresses) addr
        WHERE concat_ws(' ', addr->>'name', addr->>'email') ILIKE '%' || normalized.query_text || '%'
      )
      OR EXISTS (
        SELECT 1
        FROM unnest(cache.attachment_names) attachment_name
        WHERE attachment_name ILIKE '%' || normalized.query_text || '%'
      )
    )
  ORDER BY
    ts_rank_cd(cache.search_document, websearch_to_tsquery('simple', normalized.query_text)) DESC NULLS LAST,
    cache.sent_at DESC,
    cache.uid DESC
  LIMIT greatest(coalesce(p_limit, 1000), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;
