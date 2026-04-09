-- Migration 004: add creatomate render tracking to creative_scene_groups
alter table creative_scene_groups
  add column if not exists creatomate_render_id text;
-- status now also accepts: stitching
