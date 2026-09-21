#!/usr/bin/env bash
#
# approve-push.sh — 承認後の push 一連（通行証書き込み → push → 失効/同期確認）を1本化。
#
#   使い方:  bash scripts/approve-push.sh <承認対象のフルSHA>
#
#   ★ このスクリプトは「司令塔の検分承認が宣言された後」にのみ実行すること。
#      承認前の実行は検分の飛ばし＝禁止（azuma-terrace CLAUDE.md §3）。
#   出典: coupon-site の scripts/approve-push.sh を同仕様で複製（2026-09 体制同期案件・第2段）。
#
#   処理:
#     1) HEAD と引数SHAの一致を検証（不一致なら通行証を書かず即中止）
#     2) .review-approved に HEAD を書き込み（通行証）
#     3) git push origin main
#     4) 通行証を失効（1コミット1検分を維持）＋ 通行証/作業ツリー/ローカル=リモート を確認出力
#     いずれかで失敗したら即中止（set -e）し状態を表示する。
#
#   注意（検分ゲートとの関係）:
#     PreToolUse 検分ゲート hook は「コマンド文字列に 'git push' を含む Bash 呼び出し」だけに作動する。
#     `bash scripts/approve-push.sh ...` は文字列に 'git push' を含まないため hook は不関与＝
#     スクリプト内部の push はゲートを通らない。そのため本スクリプト自身が上記1)のHEAD一致検証を
#     enforcement として持つ（＝承認SHAと一致する時だけ通行証を書いて push する）。
#     手動 `git push` の経路は従来どおり hook でブロックされる。
#
set -euo pipefail

fail() { echo "✗ $*" >&2; exit 1; }

APPROVED_SHA="${1:-}"
[ -n "$APPROVED_SHA" ] || fail "引数に承認対象のフルSHAを指定してください: bash scripts/approve-push.sh <SHA>"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HEAD="$(git rev-parse HEAD)"

# 1) HEAD と引数の一致検証（不一致なら通行証を書かず中止）
if [ "$HEAD" != "$APPROVED_SHA" ]; then
  echo "✗ HEADが承認対象と不一致のため中止しました（通行証は書き込んでいません）。" >&2
  echo "    承認SHA : $APPROVED_SHA" >&2
  echo "    現在HEAD: $HEAD" >&2
  exit 1
fi

# 2) 通行証書き込み
echo "$HEAD" > "$ROOT/.review-approved"
echo "✓ 通行証を書き込み: $(cat "$ROOT/.review-approved")"

# 3) push
echo "→ git push origin main ..."
git push origin main

# 4) 通行証失効（1コミット1検分）＋確認
rm -f "$ROOT/.review-approved"

echo ""
echo "===== push後の確認 ====="
if [ -f "$ROOT/.review-approved" ]; then
  echo "通行証        : 残存(要注意)"
else
  echo "通行証        : 失効済み(正常)"
fi

DIRTY="$(git status --porcelain | grep -vc '^??' || true)"
echo "未コミット変更: ${DIRTY} 件（0が正常）"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "ローカル=リモート: 一致(OK)  ${LOCAL}"
else
  fail "ローカル=リモート不一致 (local=${LOCAL} remote=${REMOTE})"
fi

echo "✓ 完了"
