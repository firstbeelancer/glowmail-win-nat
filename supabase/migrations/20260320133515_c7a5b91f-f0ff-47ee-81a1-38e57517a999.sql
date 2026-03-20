ALTER TABLE public.email_search_cache ADD COLUMN IF NOT EXISTS body_text text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.mail_sync_state (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_key text NOT NULL,
  folder_id text NOT NULL,
  last_synced_uid bigint NOT NULL DEFAULT 0,
  total_messages bigint NOT NULL DEFAULT 0,
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  full_sync_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_key, folder_id)
);

ALTER TABLE public.mail_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.mail_sync_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.email_search_cache_document_v2(
  p_subject text, p_snippet text, p_from_name text, p_from_email text,
  p_to_addresses jsonb, p_cc_addresses jsonb, p_attachment_names text[], p_body_text text
)
RETURNS tsvector LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT to_tsvector('simple', trim(both ' ' from concat_ws(' ',
    coalesce(p_subject, ''), coalesce(p_snippet, ''), coalesce(p_from_name, ''), coalesce(p_from_email, ''),
    coalesce((select string_agg(trim(both ' ' from concat_ws(' ', addr->>'name', addr->>'email')), ' ') from jsonb_array_elements(coalesce(p_to_addresses, '[]'::jsonb)) addr), ''),
    coalesce((select string_agg(trim(both ' ' from concat_ws(' ', addr->>'name', addr->>'email')), ' ') from jsonb_array_elements(coalesce(p_cc_addresses, '[]'::jsonb)) addr), ''),
    array_to_string(coalesce(p_attachment_names, '{}'), ' '),
    left(coalesce(p_body_text, ''), 2000)
  )));
$$;

CREATE OR REPLACE FUNCTION public.search_email_search_cache(
  p_account_key text, p_folder_id text, p_query text, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0
)
RETURNS TABLE(uid bigint) LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH normalized AS (SELECT nullif(trim(coalesce(p_query, '')), '') AS query_text)
  SELECT cache.uid FROM public.email_search_cache cache CROSS JOIN normalized
  WHERE cache.account_key = p_account_key AND cache.folder_id = p_folder_id AND normalized.query_text IS NOT NULL
    AND (
      cache.search_document @@ websearch_to_tsquery('simple', normalized.query_text)
      OR cache.subject ILIKE '%' || normalized.query_text || '%'
      OR cache.snippet ILIKE '%' || normalized.query_text || '%'
      OR cache.from_name ILIKE '%' || normalized.query_text || '%'
      OR cache.from_email ILIKE '%' || normalized.query_text || '%'
      OR cache.body_text ILIKE '%' || normalized.query_text || '%'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(cache.to_addresses) addr WHERE concat_ws(' ', addr->>'name', addr->>'email') ILIKE '%' || normalized.query_text || '%')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(cache.cc_addresses) addr WHERE concat_ws(' ', addr->>'name', addr->>'email') ILIKE '%' || normalized.query_text || '%')
      OR EXISTS (SELECT 1 FROM unnest(cache.attachment_names) attachment_name WHERE attachment_name ILIKE '%' || normalized.query_text || '%')
    )
  ORDER BY ts_rank_cd(cache.search_document, websearch_to_tsquery('simple', normalized.query_text)) DESC NULLS LAST, cache.sent_at DESC, cache.uid DESC
  LIMIT greatest(coalesce(p_limit, 1000), 1) OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.list_cached_emails(
  p_account_key text, p_folder_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE(uid bigint, subject text, snippet text, from_name text, from_email text, to_addresses jsonb, cc_addresses jsonb, flags text[], has_attachments boolean, attachment_names text[], message_id text, in_reply_to text, sent_at timestamptz)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT cache.uid, cache.subject, cache.snippet, cache.from_name, cache.from_email,
    cache.to_addresses, cache.cc_addresses, cache.flags, cache.has_attachments,
    cache.attachment_names, cache.message_id, cache.in_reply_to, cache.sent_at
  FROM public.email_search_cache cache
  WHERE cache.account_key = p_account_key AND cache.folder_id = p_folder_id
  ORDER BY cache.uid DESC
  LIMIT greatest(coalesce(p_limit, 50), 1) OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_sync_state(p_account_key text, p_folder_id text)
RETURNS TABLE(last_synced_uid bigint, total_messages bigint, last_sync_at timestamptz, full_sync_done boolean)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT s.last_synced_uid, s.total_messages, s.last_sync_at, s.full_sync_done
  FROM public.mail_sync_state s WHERE s.account_key = p_account_key AND s.folder_id = p_folder_id;
$$;

CREATE OR REPLACE FUNCTION public.count_cached_emails(p_account_key text, p_folder_id text)
RETURNS bigint LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT count(*) FROM public.email_search_cache WHERE account_key = p_account_key AND folder_id = p_folder_id;
$$