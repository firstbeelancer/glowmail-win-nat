create extension if not exists pg_trgm;

create or replace function public.email_search_cache_document(
  p_subject text,
  p_snippet text,
  p_from_name text,
  p_from_email text,
  p_to_addresses jsonb,
  p_cc_addresses jsonb,
  p_attachment_names text[]
)
returns tsvector
language sql
immutable
as $$
  select to_tsvector(
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

create table if not exists public.email_search_cache (
  id bigserial primary key,
  account_key text not null,
  account_email text not null,
  imap_host text not null,
  folder_id text not null,
  uid bigint not null,
  subject text not null default '',
  snippet text not null default '',
  from_name text not null default '',
  from_email text not null default '',
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,
  attachment_names text[] not null default '{}',
  has_attachments boolean not null default false,
  flags text[] not null default '{}',
  message_id text not null default '',
  in_reply_to text not null default '',
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    public.email_search_cache_document(subject, snippet, from_name, from_email, to_addresses, cc_addresses, attachment_names)
  ) stored
);

create unique index if not exists email_search_cache_account_folder_uid_idx
  on public.email_search_cache (account_key, folder_id, uid);

create index if not exists email_search_cache_search_document_idx
  on public.email_search_cache
  using gin (search_document);

create index if not exists email_search_cache_account_folder_sent_at_idx
  on public.email_search_cache (account_key, folder_id, sent_at desc);

create or replace function public.set_email_search_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_email_search_cache_updated_at on public.email_search_cache;
create trigger set_email_search_cache_updated_at
before update on public.email_search_cache
for each row
execute function public.set_email_search_cache_updated_at();
