create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  avatar_url text,
  monthly_budget numeric(14, 2) not null default 1000 check (monthly_budget > 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  label text not null,
  description text not null default '',
  icon text not null default 'tag',
  color text not null default '#83AF3B',
  created_at timestamptz not null default now()
);

create unique index if not exists categories_system_name_unique
  on public.categories (lower(name)) where user_id is null;
create unique index if not exists categories_user_name_unique
  on public.categories (user_id, lower(name)) where user_id is not null;

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  category_id uuid not null references public.categories(id) on delete restrict,
  description text not null default '',
  day smallint not null check (day between 1 and 28),
  active boolean not null default true,
  next_run_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  category_id uuid not null references public.categories(id) on delete restrict,
  description text not null default '',
  payment_method text,
  expense_date date not null,
  recurring_id uuid references public.recurring_expenses(id) on delete set null,
  recurring_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists expenses_recurring_occurrence_unique
  on public.expenses (user_id, recurring_id, recurring_date)
  where recurring_id is not null;
create index if not exists expenses_user_date_idx
  on public.expenses (user_id, expense_date desc);
create index if not exists expenses_user_category_date_idx
  on public.expenses (user_id, category_id, expense_date desc);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  period text not null default 'monthly' check (period in ('weekly', 'monthly')),
  month smallint not null check (month between 1 and 12),
  year smallint not null check (year between 2000 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists budgets_user_scope_period_unique
  on public.budgets (
    user_id,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period,
    year,
    month
  );
create index if not exists budgets_user_month_idx
  on public.budgets (user_id, year, month);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 60),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),
  deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  income_date date not null,
  description text not null default '',
  recurring_id uuid,
  recurring_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists income_recurring_occurrence_unique
  on public.income_entries (user_id, recurring_id, recurring_date)
  where recurring_id is not null;
create index if not exists income_user_date_idx
  on public.income_entries (user_id, income_date desc);

create table if not exists public.recurring_income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  description text not null default '',
  day smallint not null check (day between 1 and 28),
  active boolean not null default true,
  next_run_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.income_entries
  drop constraint if exists income_entries_recurring_id_fkey;
alter table public.income_entries
  add constraint income_entries_recurring_id_fkey
  foreign key (recurring_id) references public.recurring_income(id) on delete set null;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  reminder_date date not null,
  description text not null default '',
  type text not null default 'custom' check (type in ('bill', 'savings', 'custom')),
  amount numeric(14, 2) check (amount is null or amount > 0),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legacy_account_migrations (
  legacy_user_id text primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  migrated_at timestamptz not null default now()
);
alter table public.legacy_account_migrations enable row level security;
revoke all on public.legacy_account_migrations from anon, authenticated;
grant all on public.legacy_account_migrations to service_role;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles as current_profile (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when current_profile.full_name = '' then excluded.full_name
          else current_profile.full_name
        end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.create_profile_for_auth_user();

create or replace function public.enforce_owned_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_owner uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select user_id into category_owner
  from public.categories
  where id = new.category_id;

  if not found or (category_owner is not null and category_owner <> new.user_id) then
    raise exception 'Category is not available to this user' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_category_owner on public.expenses;
create trigger expenses_category_owner
  before insert or update of category_id, user_id on public.expenses
  for each row execute function public.enforce_owned_category();
drop trigger if exists recurring_expenses_category_owner on public.recurring_expenses;
create trigger recurring_expenses_category_owner
  before insert or update of category_id, user_id on public.recurring_expenses
  for each row execute function public.enforce_owned_category();
drop trigger if exists budgets_category_owner on public.budgets;
create trigger budgets_category_owner
  before insert or update of category_id, user_id on public.budgets
  for each row execute function public.enforce_owned_category();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'expenses', 'categories', 'budgets', 'savings_goals',
    'income_entries', 'recurring_expenses', 'recurring_income', 'reminders'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

drop policy if exists "Profiles are private" on public.profiles;
create policy "Profiles are private" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Users update their profile" on public.profiles;
create policy "Users update their profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Users read available categories" on public.categories;
create policy "Users read available categories" on public.categories
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
drop policy if exists "Users create their categories" on public.categories;
create policy "Users create their categories" on public.categories
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Users update their categories" on public.categories;
create policy "Users update their categories" on public.categories
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "Users delete their categories" on public.categories;
create policy "Users delete their categories" on public.categories
  for delete to authenticated using (user_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'expenses', 'budgets', 'savings_goals', 'income_entries',
    'recurring_expenses', 'recurring_income', 'reminders'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'Users manage own ' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      'Users manage own ' || table_name,
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'expenses', 'budgets', 'savings_goals',
    'income_entries', 'recurring_expenses', 'recurring_income', 'reminders'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

insert into public.categories (user_id, name, label, description, icon, color)
values
  (null, 'Food', 'Food & Groceries', 'Fresh groceries, snacks, and meals.', 'food', '#F3A847'),
  (null, 'Transport', 'Transport', 'Fuel, rides, transit, and commute costs.', 'transport', '#4E8DEB'),
  (null, 'Housing', 'Housing', 'Rent, utilities, and upkeep costs.', 'housing', '#9B7BEA'),
  (null, 'Entertainment', 'Entertainment', 'Streaming, outings, and hobbies.', 'entertainment', '#EC6F91'),
  (null, 'Savings', 'Savings', 'Emergency and future savings.', 'savings', '#83AF3B'),
  (null, 'Utilities', 'Utilities', 'Electricity, water, and internet costs.', 'utilities', '#47AFA5'),
  (null, 'Other', 'Other', 'Unexpected or uncategorized spending.', 'other', '#7F8794')
on conflict do nothing;

revoke all on public.profiles, public.categories, public.expenses, public.budgets,
  public.savings_goals, public.income_entries, public.recurring_expenses,
  public.recurring_income, public.reminders
from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.expenses, public.budgets,
  public.savings_goals, public.income_entries, public.recurring_expenses,
  public.recurring_income, public.reminders
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their avatar files" on storage.objects;
create policy "Users read their avatar files" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users upload their avatar files" on storage.objects;
create policy "Users upload their avatar files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users update their avatar files" on storage.objects;
create policy "Users update their avatar files" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete their avatar files" on storage.objects;
create policy "Users delete their avatar files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach table_name in array array[
    'expenses', 'categories', 'budgets', 'savings_goals', 'income_entries',
    'recurring_expenses', 'recurring_income', 'reminders'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
