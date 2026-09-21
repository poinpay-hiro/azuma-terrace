#!/usr/bin/env bash
#
# post-push-cleanup.sh  —  PostToolUse hook（Bash用）
#
# 目的: git push が「成功」したら通行証 .review-approved を失効させる（＝1回限りの通行証）。
#   これにより、承認は1コミット1回きりになり、承認の使い回しを防ぐ。
#
# 安全方針: cleanupの失敗は「証明が残る＝次回も検分要求」という安全側に倒れるため fail-open で問題ない。
#   ただし push が失敗しているときは絶対に失効させない（失敗マーカーを検出したら何もしない）。
#
set -uo pipefail

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")"

# git push 以外は不関与
# git push が「コマンド位置」にある時だけ作動（メッセージ内の文字列では作動しない）
if printf '%s' "$CMD" | grep -Eq '(^|[;&|])[[:space:]]*git[[:space:]]+push([[:space:]]|$)'; then
  :
else
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
APPROVED="$ROOT/.review-approved"
[ -f "$APPROVED" ] || exit 0

# ツール応答（stdout/stderr等）を1つのテキストに落として成否を判定する
RESP="$(printf '%s' "$INPUT" | jq -r '(.tool_response // "") | tostring' 2>/dev/null || echo "")"

# 失敗マーカーがあれば失効しない（通行証を残す）
case "$RESP" in
  *rejected*|*"error:"*|*"fatal:"*|*"failed to push"*|*"Could not resolve"*|*"Permission denied"*|*"! [remote"*)
    exit 0 ;;
esac

# 成功の証跡（ref更新 " -> " / 新ブランチ / 新タグ / up-to-date）があれば失効
case "$RESP" in
  *" -> "*|*"[new branch]"*|*"[new tag]"*|*"Everything up-to-date"*)
    rm -f "$APPROVED"
    echo "post-push-cleanup: push成功を確認し .review-approved を失効しました" >&2 ;;
esac

exit 0
