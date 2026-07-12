#!/bin/bash
# Stop hook (GSL, owner mandate 2026-07-10): ход оркестратора ОБЯЗАН заканчиваться
# финальным ТЕКСТОВЫМ сообщением владельцу. Если последний assistant-месседж хода
# оканчивается tool_use-блоком (владелец не увидит в чате ничего) — блокируем стоп
# и требуем написать текст. Fail-open: любая ошибка парсинга => разрешить стоп.
input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

# Защита от бесконечного цикла: если стоп уже блокировался этим хуком — пропускаем.
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$active" = "true" ] && exit 0

tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
{ [ -n "$tp" ] && [ -f "$tp" ]; } || exit 0

# Гонка записи: финальный text-блок может быть ещё не сброшен на диск в момент Stop.
# До 3 чтений с паузой 0.5s; блокируем только если ход СТАБИЛЬНО кончается tool_use.
verdict="ok"
for attempt in 1 2 3; do
  last=$(grep '"type":"assistant"' "$tp" | tail -n 1)
  [ -n "$last" ] || exit 0
  verdict=$(printf '%s' "$last" | jq -r '
    .message.content
    | if type == "array" and length > 0 then
        (.[-1] | if .type == "text" and ((.text // "") | test("\\S")) then "ok" else "silent" end)
      else "ok" end' 2>/dev/null)
  [ "$verdict" = "silent" ] || break
  [ "$attempt" -lt 3 ] && sleep 0.5
done

if [ "$verdict" = "silent" ]; then
  printf '%s' '{"decision":"block","reason":"HARD RULE (owner): ход обязан заканчиваться финальным ТЕКСТОВЫМ сообщением владельцу ПОСЛЕ всех tool-вызовов (включая ScheduleWakeup). Напиши сейчас владельцу текст — статус, дельты, следующий шаг — и заверши ход этим текстом, без tool-вызовов после него."}'
fi
exit 0
