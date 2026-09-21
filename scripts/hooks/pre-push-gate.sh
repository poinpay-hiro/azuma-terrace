#!/usr/bin/env bash
#
# pre-push-gate.sh  —  PreToolUse hook（Bash用）
#
# 目的: 「git push」を含む Bash コマンドは、司令塔の検分済み証明があるときだけ通す。
#   証明 = リポジトリ直下の .review-approved の1行目が、現在のHEAD(git rev-parse HEAD)と完全一致すること。
#   一致 → exit 0（通す） ／ 不一致・不存在 → stderrに案内を出して exit 2（ブロック）。
#
# ★フェイルオープン禁止（安全側=fail-closed）:
#   JSON解析・git参照など内部処理でエラーが起きた場合は「素通り」させず必ず exit 2 で止める。
#   set -euo pipefail ＋ ERRトラップで、想定外エラーを exit 2 に集約する。
#
set -euo pipefail
trap 'echo "pre-push-gate: 内部エラーのため安全側で停止しました (exit 2)" >&2; exit 2' ERR

# 標準入力のJSON（PreToolUse hookのペイロード）からコマンドを取得
INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')"

# 「git push」を含まないコマンドには一切干渉しない（不関与）
# git push が「コマンド位置」にある時だけ作動（メッセージ内の文字列では作動しない）
if printf '%s' "$CMD" | grep -Eq '(^|[;&|])[[:space:]]*git[[:space:]]+push([[:space:]]|$)'; then
  :
else
  exit 0
fi

# ここから先は git push を含むコマンドのみ
ROOT="$(git rev-parse --show-toplevel)"
HEAD="$(git rev-parse HEAD)"
APPROVED="$ROOT/.review-approved"

if [ -f "$APPROVED" ]; then
  FIRST="$(head -n 1 "$APPROVED" | tr -d '[:space:]')"
  if [ -n "$FIRST" ] && [ "$FIRST" = "$HEAD" ]; then
    exit 0   # 検分済み証明がHEADと一致 → 通す
  fi
fi

echo "検分未了：司令塔の検分を受け、.review-approved にHEADのコミットIDを記録してからpushしてください" >&2
echo "  現在のHEAD: $HEAD" >&2
exit 2
