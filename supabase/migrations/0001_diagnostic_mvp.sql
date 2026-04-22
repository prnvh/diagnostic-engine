create extension if not exists pgcrypto;

create table if not exists public.diagnostic_sessions (
  session_id text primary key,
  patient_id text not null,
  body_region text not null default 'knee',
  status text not null,
  round integer not null default 0,
  debounce_expires_at timestamptz not null,
  session_data jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists diagnostic_sessions_reuse_idx
  on public.diagnostic_sessions (patient_id, body_region, status, debounce_expires_at desc);

create index if not exists diagnostic_sessions_updated_idx
  on public.diagnostic_sessions (updated_at desc);

create table if not exists public.diagnostic_ledger_entries (
  sequence bigint generated always as identity primary key,
  session_id text not null references public.diagnostic_sessions(session_id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  at timestamptz not null default timezone('utc', now())
);

create index if not exists diagnostic_ledger_session_idx
  on public.diagnostic_ledger_entries (session_id, sequence);

alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_ledger_entries enable row level security;
