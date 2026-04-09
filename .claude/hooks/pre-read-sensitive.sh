#!/bin/bash
# Предупреждение при чтении чувствительных файлов
# Срабатывает на: .env*, *.key, *.pem, *secret*, *credential*

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  echo "$INPUT"
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

SENSITIVE=0
case "$BASENAME" in
  .env|.env.*|*.key|*.pem|*.p12|*.pfx)
    SENSITIVE=1 ;;
esac

case "$BASENAME" in
  *secret*|*credential*|*password*|*token*)
    SENSITIVE=1 ;;
esac

if [ "$SENSITIVE" = "1" ]; then
  echo "[SECURITY] Читаем чувствительный файл: $FILE_PATH — убедись, что секреты не попадут в промпты или коммиты." >&2
fi

echo "$INPUT"
