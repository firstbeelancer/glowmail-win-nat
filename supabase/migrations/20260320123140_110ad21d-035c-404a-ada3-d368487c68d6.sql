
ALTER FUNCTION public.email_search_cache_document(text, text, text, text, jsonb, jsonb, text[])
  SET search_path = public;

ALTER FUNCTION public.set_email_search_cache_updated_at()
  SET search_path = public;

ALTER FUNCTION public.search_email_search_cache(text, text, text, integer, integer)
  SET search_path = public;
