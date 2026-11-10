create table if not exists public.app_documents (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_documents enable row level security;

revoke all on public.app_documents from anon, authenticated;
grant all on public.app_documents to service_role;
