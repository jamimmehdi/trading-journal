-- Run this once in Supabase: Project -> SQL Editor -> New Query -> paste -> Run

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  symbol text not null,
  side text not null check (side in ('long','short')),
  status text not null default 'closed' check (status in ('open','closed')),
  entry_price numeric not null,
  exit_price numeric,
  investment_amount numeric not null,
  leverage numeric not null default 1,
  fees numeric not null default 0,
  entry_date date not null,
  exit_date date,
  notes text,
  created_at timestamptz not null default now()
);

alter table trades enable row level security;

create policy "Individuals can view their own trades"
  on trades for select
  using (auth.uid() = user_id);

create policy "Individuals can insert their own trades"
  on trades for insert
  with check (auth.uid() = user_id);

create policy "Individuals can update their own trades"
  on trades for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Individuals can delete their own trades"
  on trades for delete
  using (auth.uid() = user_id);

create index if not exists trades_user_id_idx on trades (user_id);
create index if not exists trades_entry_date_idx on trades (entry_date);
