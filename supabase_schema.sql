-- Run this in Supabase SQL Editor once.
-- This project uses Supabase only from Netlify Functions with the service-role key.
-- The frontend never receives your Supabase keys.

create table if not exists participants (
  participant_key text primary key,
  name text not null,
  file_id text,
  file_name text,
  updated_at timestamptz not null default now()
);

create table if not exists predictions (
  participant_key text not null references participants(participant_key) on delete cascade,
  match_no integer not null,
  kickoff timestamptz,
  round_label text,
  home_team text not null,
  away_team text not null,
  pred_home integer not null,
  pred_away integer not null,
  updated_at timestamptz not null default now(),
  primary key (participant_key, match_no)
);

create table if not exists matches (
  match_no integer primary key,
  api_id text,
  kickoff timestamptz,
  status text,
  stage text,
  group_name text,
  home_team text,
  away_team text,
  real_home integer,
  real_away integer,
  score_source text,
  is_scorable boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists group_position_predictions (
  participant_key text not null references participants(participant_key) on delete cascade,
  group_name text not null,
  position integer not null check (position between 1 and 4),
  team text not null,
  updated_at timestamptz not null default now(),
  primary key (participant_key, group_name, position)
);

create table if not exists group_standings (
  group_name text not null,
  position integer not null check (position between 1 and 4),
  team text not null,
  primary key (group_name, position)
);

create table if not exists special_predictions (
  participant_key text not null references participants(participant_key) on delete cascade,
  category text not null,
  predicted_value text not null,
  updated_at timestamptz not null default now(),
  primary key (participant_key, category)
);

create table if not exists special_results (
  category text primary key,
  actual_value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists sync_logs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default false,
  source text,
  participants_count integer,
  predictions_count integer,
  matches_count integer,
  warnings jsonb default '[]'::jsonb,
  error text
);

create index if not exists predictions_match_no_idx on predictions(match_no);
create index if not exists matches_status_idx on matches(status);
create index if not exists sync_logs_started_at_idx on sync_logs(started_at desc);
