create or replace function public.search_email_search_cache(
  p_account_key text,
  p_folder_id text,
  p_query text,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table(uid bigint)
language sql
stable
as $$
  with normalized as (
    select nullif(trim(coalesce(p_query, '')), '') as query_text
  )
  select cache.uid
  from public.email_search_cache cache
  cross join normalized
  where cache.account_key = p_account_key
    and cache.folder_id = p_folder_id
    and normalized.query_text is not null
    and (
      cache.search_document @@ websearch_to_tsquery('simple', normalized.query_text)
      or cache.subject ilike '%' || normalized.query_text || '%'
      or cache.snippet ilike '%' || normalized.query_text || '%'
      or cache.from_name ilike '%' || normalized.query_text || '%'
      or cache.from_email ilike '%' || normalized.query_text || '%'
      or exists (
        select 1
        from jsonb_array_elements(cache.to_addresses) addr
        where concat_ws(' ', addr->>'name', addr->>'email') ilike '%' || normalized.query_text || '%'
      )
      or exists (
        select 1
        from jsonb_array_elements(cache.cc_addresses) addr
        where concat_ws(' ', addr->>'name', addr->>'email') ilike '%' || normalized.query_text || '%'
      )
      or exists (
        select 1
        from unnest(cache.attachment_names) attachment_name
        where attachment_name ilike '%' || normalized.query_text || '%'
      )
    )
  order by
    ts_rank_cd(cache.search_document, websearch_to_tsquery('simple', normalized.query_text)) desc nulls last,
    cache.sent_at desc,
    cache.uid desc
  limit greatest(coalesce(p_limit, 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
