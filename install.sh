#!/usr/bin/env bash
# ⛔⛔⛔ ЗАЩИТА — СКРИПТ ВРЕМЕННО ОТКЛЮЧЁН (owner, 2026-07-20) ⛔⛔⛔
# Агенты могут случайно вызвать install.sh и перезаписать ГЛОБАЛЬНЫЕ скиллы
# (~/.claude/skills/*, в т.ч. orchestrating-delivery-agents — авторитетна ГЛОБАЛЬНАЯ копия,
# в локальной skill/ есть проблемы). Текущая стратегия: все проекты работают с глобальным
# скиллом и проверяют его на практике; sync local→global НЕ выполняется. Обратная
# синхронизация (global→local, с анализом) — только по явной команде владельца.
# Снятие защиты — ТОЛЬКО по явной команде владельца: закомментировать две строки ниже.
echo "install.sh: ⛔ ЗАЩИТА ВКЛЮЧЕНА — sync local→global отключён владельцем 2026-07-20 (см. шапку скрипта)." >&2
exit 1
# Install every owned skill subfolder from skill/ into ~/.claude/skills/.
# Idempotent: re-run after editing any skill/ subfolder to refresh it.
#
# SAFETY: operates ONLY on explicit per-skill subdirectories
# ~/.claude/skills/<name>/.  Never runs rsync --delete or rm against the
# parent ~/.claude/skills/ itself, and never touches any skill dir that is
# not one of our own subfolders.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="${REPO_DIR}/skill"
SKILLS_DEST="${HOME}/.claude/skills"

if [ ! -d "${SKILLS_SRC}" ]; then
  echo "error: ${SKILLS_SRC} not found — run from the harness project root." >&2
  exit 1
fi

installed=0
for skill_dir in "${SKILLS_SRC}"/*/; do
  skill_name="$(basename "${skill_dir}")"
  dest="${SKILLS_DEST}/${skill_name}"
  mkdir -p "${dest}"
  rsync -a --delete "${skill_dir}" "${dest}/"
  echo "installed: ${skill_name} -> ${dest}"
  (( installed++ )) || true
done

if (( installed == 0 )); then
  echo "warning: no skill subdirectories found under ${SKILLS_SRC}" >&2
  exit 1
fi

echo "done: ${installed} skill(s) installed."
