#!/bin/bash
# После редактирования файла: проверяем console.log в TS/TSX файлах

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  echo "$INPUT"
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx)
    COUNT=$(grep -c "console\.log" "$FILE_PATH" 2>/dev/null || echo 0)
    if [ "$COUNT" -gt "0" ]; then
      echo "[WARN] $FILE_PATH содержит $COUNT console.log — убери перед коммитом." >&2
    fi
    ;;
esac

echo "$INPUT"
