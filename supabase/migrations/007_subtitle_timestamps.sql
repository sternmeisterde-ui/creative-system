alter table creative_generations add column if not exists word_timestamps jsonb;
alter table creative_generations add column if not exists audio_duration float;
