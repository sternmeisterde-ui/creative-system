# Авто-запуск montage-worker (launchd, macOS)

Держит `scripts/montage-worker.mjs` запущенным в фоне: стартует при логине, перезапускается при падении.
Воркер раз в 20с забирает scene-группы со статусом `ready_montage` и монтирует финальное видео
(см. раздел «Финальный монтаж» в корневом `CLAUDE.md`).

## Установка

```bash
cp scripts/launchd/de.sternmeister.montage-worker.plist ~/Library/LaunchAgents/
# при необходимости поправь пути в plist под свою машину (node, WorkingDirectory, логи)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/de.sternmeister.montage-worker.plist
launchctl enable gui/$(id -u)/de.sternmeister.montage-worker
```

## Управление

```bash
L=de.sternmeister.montage-worker
launchctl print gui/$(id -u)/$L            # статус (state, pid)
launchctl kickstart -k gui/$(id -u)/$L     # перезапуск (после правок воркера)
launchctl bootout gui/$(id -u)/$L          # остановить и выгрузить
tail -f ~/Library/Logs/montage-worker.out.log   # логи (out)
tail -f ~/Library/Logs/montage-worker.err.log   # ошибки
```

## Замечания

- launchd даёт минимальный PATH — в plist прописан полный PATH, чтобы воркер находил `ffmpeg`/`ffprobe`/`python3`.
- Логи воркера пишутся синхронно (`fs.writeSync`), поэтому видны сразу, без буферизации.
- Конфиг воркера — через env (можно добавить в блок `EnvironmentVariables` plist): `MONTAGE_FONT`,
  `MONTAGE_BGM_VOLUME`, `MONTAGE_UNIQUIFY`, `MONTAGE_MAX_WORDS`, `MONTAGE_POLL_SECONDS`.
