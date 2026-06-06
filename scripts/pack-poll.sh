#!/usr/bin/env bash
# Drives /api/pack/auto-advance every 30s until all scene_groups for the test
# pack reach final_url (or error), logging stage transitions + a DB snapshot.
set -u
cd "$(dirname "$0")/.."

SURL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
SKEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
[ -z "$SKEY" ] && SKEY=$(grep -E '^SUPABASE_SERVICE_KEY=' .env.local | cut -d= -f2-)
SID="c820c7c0-8f47-4d67-a73d-b3a40e835192"
BASE="http://localhost:3000"
MAX_ITERS=200  # 200 * 15s ≈ 50 min ceiling

hcurl(){ curl -s -H "apikey: $SKEY" -H "Authorization: Bearer $SKEY" "$@"; }

for i in $(seq 1 $MAX_ITERS); do
  TS=$(date '+%H:%M:%S')
  ADV=$(curl -s -m 60 -X POST "$BASE/api/pack/auto-advance" -H "Content-Type: application/json" -d '{}')

  # scene-level snapshot
  GEN=$(hcurl "$SURL/rest/v1/creative_generations?session_id=eq.$SID&select=status" | grep -o '"status":"[^"]*"' | sort | uniq -c | tr '\n' ' ')
  # group-level snapshot (stage signals)
  GRP=$(hcurl "$SURL/rest/v1/creative_scene_groups?session_id=eq.$SID&select=status,voiceover_done,creatomate_render_id,final_url")

  echo "[$TS #$i] adv=$ADV"
  echo "         gens: $GEN"
  echo "         grps: $GRP"
  echo "---"

  # Done? every group has final_url (no nulls) OR all error
  NULLS=$(echo "$GRP" | grep -o '"final_url":null' | wc -l | tr -d ' ')
  NERR=$(echo "$GRP" | grep -o '"status":"error"' | wc -l | tr -d ' ')
  NGRP=$(echo "$GRP" | grep -o '"id"\|"status"' | grep -c '"status"')
  if [ "$NULLS" = "0" ]; then echo "ALL GROUPS FINALIZED"; break; fi
  if [ "$NERR" -gt 0 ] && [ "$NERR" = "$NGRP" ]; then echo "ALL GROUPS ERRORED"; break; fi

  sleep 15
done
echo "POLL LOOP EXIT at $(date '+%H:%M:%S')"
