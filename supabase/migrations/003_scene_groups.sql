-- ============================================================
-- Migration 003: creative_scene_groups — multi-scene video gen
-- ============================================================

create table if not exists creative_scene_groups (
  id            uuid primary key default gen_random_uuid(),
  brief_id      uuid references briefs(id) on delete cascade,
  session_id    uuid references constructor_sessions(id) on delete set null,
  format        text not null default 'ugc',
  model         text not null,
  scene_count   int  not null default 0,
  status        text not null default 'generating', -- generating | done | error
  final_url     text,
  error_message text,
  created_at    timestamptz default now()
);

create index if not exists idx_scene_groups_brief_id  on creative_scene_groups(brief_id);
create index if not exists idx_scene_groups_status    on creative_scene_groups(status);
create index if not exists idx_scene_groups_created   on creative_scene_groups(created_at desc);

alter table creative_scene_groups enable row level security;
create policy "allow all" on creative_scene_groups for all using (true) with check (true);

-- Link individual generations back to a scene group
alter table creative_generations
  add column if not exists scene_group_id uuid references creative_scene_groups(id) on delete set null,
  add column if not exists scene_index    int;

create index if not exists idx_creative_generations_scene_group on creative_generations(scene_group_id);
