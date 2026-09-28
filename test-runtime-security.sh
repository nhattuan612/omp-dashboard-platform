#!/bin/sh
set -eu

base_url=${OMP_DASHBOARD_BASE_URL:-http://127.0.0.1:4177}
runtime_cwd=${OMP_DASHBOARD_RUNTIME_CWD:-/Users/trannhattuan/.omp/usage-dashboard}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

assert_status() {
  expected=$1
  shift
  actual=$("$@")
  [ "$actual" = "$expected" ] || { echo "expected HTTP $expected, got $actual" >&2; exit 1; }
}

assert_status 200 /usr/bin/curl -sS -o /dev/null -w '%{http_code}' "$base_url/healthz"
/usr/bin/curl -sS -D "$tmp_dir/page.headers" -o /dev/null -c "$tmp_dir/cookies" "$base_url/chat"
/usr/bin/grep -qi '^set-cookie: omp_dashboard_session=' "$tmp_dir/page.headers"
/usr/bin/grep -qi '^content-security-policy:' "$tmp_dir/page.headers"

assert_status 401 /usr/bin/curl -sS -o "$tmp_dir/unauth.json" -w '%{http_code}' "$base_url/api/console/state"
assert_status 200 /usr/bin/curl -sS -b "$tmp_dir/cookies" -o "$tmp_dir/state.json" -w '%{http_code}' "$base_url/api/console/state"
! /usr/bin/grep -q '"cwd"' "$tmp_dir/state.json"
! /usr/bin/grep -q 'OMP context có lỗi nội bộ; chi tiết không được gửi tới browser' "$tmp_dir/state.json"
assert_status 200 /usr/bin/curl -sS -o "$tmp_dir/gateway-capabilities.json" -w '%{http_code}' "$base_url/api/omp/v1/capabilities"
assert_status 403 /usr/bin/curl -sS -H 'Origin: https://evil.example' -o "$tmp_dir/gateway-origin.json" -w '%{http_code}' "$base_url/api/omp/v1/capabilities"
assert_status 403 /usr/bin/curl -sS -H 'Host: evil.example' -o "$tmp_dir/host.json" -w '%{http_code}' "$base_url/healthz"

assert_status 403 /usr/bin/curl -sS -b "$tmp_dir/cookies" -H 'Origin: https://evil.example' -o "$tmp_dir/origin.json" -w '%{http_code}' "$base_url/api/console/state"
assert_status 403 /usr/bin/curl -sS -b "$tmp_dir/cookies" -H 'content-type: application/json' -d '{"contextId":"x","command":{"type":"bash","command":"echo unsafe"}}' -o "$tmp_dir/command.json" -w '%{http_code}' "$base_url/api/console/command"
assert_status 403 /usr/bin/curl -sS -b "$tmp_dir/cookies" -H 'content-type: application/json' -d '{"cwd":"/"}' -o "$tmp_dir/cwd.json" -w '%{http_code}' "$base_url/api/console/start"
assert_status 400 /usr/bin/curl -sS -b "$tmp_dir/cookies" -o "$tmp_dir/browser-mode.json" -w '%{http_code}' "$base_url/api/v1/chat/stream?prompt=ping&model=neural-flash-3.8&browserMode=invalid"
assert_status 400 /usr/bin/curl -sS -b "$tmp_dir/cookies" -H 'content-type: application/json' -d '{"contextId":"x","modelSource":"invalid","command":{"type":"set_model","modelId":"not-in-catalog"}}' -o "$tmp_dir/model-source.json" -w '%{http_code}' "$base_url/api/console/command"
/usr/bin/grep -q '"field":"modelSource"' "$tmp_dir/model-source.json"


echo "runtime security smoke: pass"
