#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime_dir=${OMP_USAGE_DASHBOARD_DIR:-/Users/trannhattuan/.omp/usage-dashboard}
agent_label=com.trannhattuan.omp-usage-dashboard
launch_domain="gui/$(/usr/bin/id -u)"
launch_agent=${OMP_DASHBOARD_LAUNCH_AGENT:-/Users/trannhattuan/Library/LaunchAgents/$agent_label.plist}
plist_backup=LaunchAgent.plist
backup_root="$runtime_dir/backups/deploy"
app_files='server.mjs omp-tool-catalog.mjs omp-tool-map.json console-bridge.mjs acp-worker.mjs acp-session-context.mjs gemini-account-pin-extension.mjs honpi-dashboard-mark-8138753b.png honpi-chat-dashboard-SKE.html honpi-quota-dashboard-SKE.html honpi-chat-dashboard-live.js honpi-chat-dashboard-legacy.js'
omp_extension_source="$project_dir/omp/agent/extensions/omp-account-preference.js"
omp_extension_target=/Users/trannhattuan/.omp/agent/extensions/omp-account-preference.js
omp_extension_backup=OMPAccountPreference.js
command=${1:-}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

write_manifest() {
  backup=$1
  (
    CDPATH= cd -- "$backup"
    set -- BACKUP-VERSION
    for file in $app_files; do
      if [ -f "$file" ]; then set -- "$@" "$file"; else set -- "$@" "ABSENT-$file"; fi
    done
    if [ -f "$omp_extension_backup" ]; then set -- "$@" "$omp_extension_backup"; else set -- "$@" "ABSENT-$omp_extension_backup"; fi
    if [ -f "$plist_backup" ]; then set -- "$@" "$plist_backup"; else set -- "$@" "ABSENT-$plist_backup"; fi
    /usr/bin/shasum -a 256 "$@"
  ) > "$backup/MANIFEST.sha256"
  /bin/chmod 600 "$backup/MANIFEST.sha256"
}

verify_backup() {
  backup=$1
  [ -d "$backup" ] || fail "Backup không tồn tại: $backup"
  [ -f "$backup/BACKUP-VERSION" ] || fail "Không chấp nhận backup cũ hoặc thiếu marker code-only"
  [ "$(/bin/cat "$backup/BACKUP-VERSION")" = "code-only-v2" ] || fail "Phiên bản backup không hợp lệ"
  [ -f "$backup/MANIFEST.sha256" ] || fail "Backup thiếu manifest checksum"
  (CDPATH= cd -- "$backup" && /usr/bin/shasum -a 256 -c MANIFEST.sha256 >/dev/null) || fail "Checksum backup không khớp"
}

restore_backup() {
  backup=$1
  verify_backup "$backup"
  for file in $app_files; do
    if [ -f "$backup/$file" ]; then
      /bin/cp "$backup/$file" "$runtime_dir/$file" || return 1
      /bin/chmod 600 "$runtime_dir/$file" || return 1
    elif [ -f "$backup/ABSENT-$file" ]; then
      /bin/rm -f "$runtime_dir/$file" || return 1
    else
      fail "Backup thiếu file hoặc marker: $file"
    fi
  done
  if [ -f "$backup/$omp_extension_backup" ]; then
    /bin/mkdir -p "$(/usr/bin/dirname "$omp_extension_target")" || return 1
    /bin/cp "$backup/$omp_extension_backup" "$omp_extension_target" || return 1
    /bin/chmod 600 "$omp_extension_target" || return 1
  elif [ -f "$backup/ABSENT-$omp_extension_backup" ]; then
    /bin/rm -f "$omp_extension_target" || return 1
  else
    fail "Backup thiếu OMP extension"
  fi
  if [ -f "$backup/$plist_backup" ]; then
    /bin/cp "$backup/$plist_backup" "$launch_agent" || return 1
    /bin/chmod 600 "$launch_agent" || return 1
  elif [ -f "$backup/ABSENT-$plist_backup" ]; then
    /bin/rm -f "$launch_agent" || return 1
  else
    fail "Backup thiếu LaunchAgent plist"
  fi
}

wait_for_health() {
  ready=0
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if /usr/bin/curl -fsS http://127.0.0.1:4177/healthz >/dev/null 2>&1; then ready=1; break; fi
    attempt=$((attempt + 1))
    /bin/sleep 0.2
  done
  [ "$ready" -eq 1 ]
}

restart_agent() {
  /bin/launchctl kickstart -k "$launch_domain/$agent_label" || return 1
  wait_for_health || return 1
  /bin/launchctl print "$launch_domain/$agent_label" >/dev/null 2>&1
}

rollback_deployment() {
  if ! restore_backup "$backup_dir"; then
    printf 'Không thể phục hồi backup %s\n' "$backup_dir" >&2
    return 1
  fi
  if ! restart_agent; then
    printf 'Đã phục hồi file nhưng LaunchAgent chưa healthy\n' >&2
    return 1
  fi
  return 0
}

if [ "$command" = "--rollback" ]; then
  [ "$#" -eq 2 ] || fail "Dùng: $0 --rollback BACKUP_DIR"
  backup_dir=$(CDPATH= cd -- "$2" && pwd) || fail "Không mở được thư mục backup"
  case "$backup_dir" in
    "$backup_root"/*) ;;
    *) fail "Rollback chỉ nhận backup bên trong $backup_root" ;;
  esac
  restore_backup "$backup_dir"
  restart_agent || fail "Đã phục hồi file nhưng LaunchAgent chưa healthy"
  printf 'Đã rollback code-only từ %s và restart LaunchAgent\n' "$backup_dir"
  exit 0
fi

[ -z "$command" ] || [ "$command" = "--restart" ] || fail "Dùng: $0 [--restart]"
[ -d "$runtime_dir" ] || fail "Runtime chưa tồn tại: $runtime_dir"
[ -f "$launch_agent" ] || fail "LaunchAgent plist chưa tồn tại: $launch_agent"
/bin/launchctl print "$launch_domain/$agent_label" >/dev/null 2>&1 || fail "LaunchAgent đích chưa được nạp"
/usr/bin/curl -fsS http://127.0.0.1:4177/healthz >/dev/null 2>&1 || fail "Runtime chưa healthy trước deploy"
for file in $app_files; do
  [ -f "$project_dir/$file" ] || fail "Thiếu source asset: $file"
done
[ -f "$omp_extension_source" ] || fail "Thiếu source OMP extension"

/bin/mkdir -p "$backup_root"
/bin/chmod 700 "$runtime_dir/backups" "$backup_root"
timestamp=$(/bin/date +%Y%m%d-%H%M%S)
backup_dir="$backup_root/$timestamp-$$"
/bin/mkdir "$backup_dir"
/bin/chmod 700 "$backup_dir"
printf 'code-only-v2\n' > "$backup_dir/BACKUP-VERSION"
for file in $app_files; do
  if [ -f "$runtime_dir/$file" ]; then
    /bin/cp "$runtime_dir/$file" "$backup_dir/$file"
  else
    : > "$backup_dir/ABSENT-$file"
  fi
done
if [ -f "$omp_extension_target" ]; then
  /bin/cp "$omp_extension_target" "$backup_dir/$omp_extension_backup"
else
  : > "$backup_dir/ABSENT-$omp_extension_backup"
fi
/bin/cp "$launch_agent" "$backup_dir/$plist_backup"
write_manifest "$backup_dir"
/usr/bin/find "$backup_dir" -type f -exec /bin/chmod 600 {} +
verify_backup "$backup_dir"

for file in $app_files; do
  if ! /bin/cp "$project_dir/$file" "$runtime_dir/$file" \
    || ! /bin/chmod 600 "$runtime_dir/$file" \
    || ! /usr/bin/cmp -s "$project_dir/$file" "$runtime_dir/$file"; then
    printf 'Deploy asset thất bại: %s; đang rollback\n' "$file" >&2
    rollback_deployment || true
    exit 1
  fi
done

if ! /bin/mkdir -p "$(/usr/bin/dirname "$omp_extension_target")" \
  || ! /bin/cp "$omp_extension_source" "$omp_extension_target" \
  || ! /bin/chmod 600 "$omp_extension_target" \
  || ! /usr/bin/cmp -s "$omp_extension_source" "$omp_extension_target"; then
  printf 'Deploy OMP extension thất bại; đang rollback\n' >&2
  rollback_deployment || true
  exit 1
fi

if [ "$command" = "--restart" ]; then
  if ! restart_agent; then
    printf 'Health check sau deploy thất bại; đang rollback\n' >&2
    rollback_deployment || true
    exit 1
  fi
fi

printf 'Đã đồng bộ dashboard vào %s; backup code-only: %s\n' "$runtime_dir" "$backup_dir"
