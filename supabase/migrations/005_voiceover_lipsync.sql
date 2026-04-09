-- Migration 005: voiceover + lipsync columns
alter table creative_generations
  add column if not exists dialogue      text,
  add column if not exists audio_url     text,
  add column if not exists lipsync_job_id text,
  add column if not exists lipsynced_url text;

alter table creative_scene_groups
  add column if not exists voiceover_done boolean default false;
