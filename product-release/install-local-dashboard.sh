#!/bin/sh
set -eu
umask 077

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR=${OMP_USAGE_DASHBOARD_DIR:-${HOME}/.omp/usage-dashboard}
WORKSPACE_DIR=${OMP_DASHBOARD_WORKSPACE:-$SOURCE_DIR}
LAUNCH_DIR=${OMP_DASHBOARD_LAUNCH_DIR:-${HOME}/Library/LaunchAgents}
LABEL=${OMP_DASHBOARD_LABEL:-com.trannhattuan.omp-usage-dashboard}
NODE_BIN=$(command -v node || true)
NPM_BIN=$(command -v npm || true)
USER_ID=$(/usr/bin/id -u)
LAUNCH_DOMAIN="gui/$USER_ID"
PLIST="$LAUNCH_DIR/$LABEL.plist"
PLIST_BACKUP=LaunchAgent.plist
BACKUP_ROOT="$TARGET_DIR/backups/deploy"
APP_FILES='server.mjs console-bridge.mjs acp-worker.mjs acp-session-context.mjs gemini-account-pin-extension.mjs honpi-dashboard-mark-8138753b.png honpi-chat-dashboard-SKE.html honpi-quota-dashboard-SKE.html honpi-chat-dashboard-live.js honpi-chat-dashboard-legacy.js package.json package-lock.json scripts/fix-node-pty-helper.mjs'
OMP_EXTENSION_SOURCE="$SOURCE_DIR/omp-account-preference.js"
OMP_EXTENSION_TARGET="${HOME}/.omp/agent/extensions/omp-account-preference.js"
OMP_EXTENSION_BACKUP=OMPAccountPreference.js

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

install_dependencies() {
  if [ -f "$TARGET_DIR/package.json" ]; then
    [ -n "$NPM_BIN" ] || fail "npm is required to install terminal dependencies"
    "$NPM_BIN" ci --omit=dev --prefix "$TARGET_DIR" || return 1
  else
    /bin/rm -rf "$TARGET_DIR/node_modules" || return 1
  fi
}

[ -n "$NODE_BIN" ] || fail "Node.js is required"
[ -n "$NPM_BIN" ] || fail "npm is required"
case "$NODE_BIN" in /*) ;; *) fail "Node.js path must be absolute" ;; esac
[ -x "${HOME}/.bun/bin/omp" ] || fail "OMP is required at ~/.bun/bin/omp"
case "$LABEL" in ''|*[!A-Za-z0-9._-]*) fail "Invalid LaunchAgent label" ;; esac
[ -f "$OMP_EXTENSION_SOURCE" ] || fail "Missing OMP extension release asset"

xml_escape() {
  printf '%s' "$1" | /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

write_manifest() {
  backup=$1
  (
    CDPATH= cd -- "$backup"
    set -- BACKUP-VERSION
    for file in $APP_FILES; do
      if [ -f "$file" ]; then set -- "$@" "$file"; else set -- "$@" "ABSENT-$file"; fi
    done
    if [ -f "$OMP_EXTENSION_BACKUP" ]; then set -- "$@" "$OMP_EXTENSION_BACKUP"; else set -- "$@" "ABSENT-$OMP_EXTENSION_BACKUP"; fi
    if [ -f "$PLIST_BACKUP" ]; then set -- "$@" "$PLIST_BACKUP"; else set -- "$@" "ABSENT-$PLIST_BACKUP"; fi
    /usr/bin/shasum -a 256 "$@"
  ) > "$backup/MANIFEST.sha256"
  /bin/chmod 600 "$backup/MANIFEST.sha256"
}

verify_backup() {
  backup=$1
  [ -d "$backup" ] || fail "Backup does not exist: $backup"
  [ -f "$backup/BACKUP-VERSION" ] || fail "Legacy or non-code-only backup rejected"
  [ "$(/bin/cat "$backup/BACKUP-VERSION")" = "code-only-v2" ] || fail "Invalid backup version"
  [ -f "$backup/MANIFEST.sha256" ] || fail "Backup checksum manifest missing"
  (CDPATH= cd -- "$backup" && /usr/bin/shasum -a 256 -c MANIFEST.sha256 >/dev/null) || fail "Backup checksum mismatch"
}

restore_backup() {
  backup=$1
  verify_backup "$backup"
  for file in $APP_FILES; do
    if [ -f "$backup/$file" ]; then
      /bin/mkdir -p "$(/usr/bin/dirname "$TARGET_DIR/$file")" || return 1
      /bin/cp "$backup/$file" "$TARGET_DIR/$file" || return 1
      /bin/chmod 600 "$TARGET_DIR/$file" || return 1
    elif [ -f "$backup/ABSENT-$file" ]; then
      /bin/rm -f "$TARGET_DIR/$file" || return 1
    else
      fail "Backup file or absence marker missing: $file"
    fi
  done
  install_dependencies || return 1
  if [ -f "$backup/$OMP_EXTENSION_BACKUP" ]; then
    /bin/mkdir -p "$(/usr/bin/dirname "$OMP_EXTENSION_TARGET")" || return 1
    /bin/cp "$backup/$OMP_EXTENSION_BACKUP" "$OMP_EXTENSION_TARGET" || return 1
    /bin/chmod 600 "$OMP_EXTENSION_TARGET" || return 1
  elif [ -f "$backup/ABSENT-$OMP_EXTENSION_BACKUP" ]; then
    /bin/rm -f "$OMP_EXTENSION_TARGET" || return 1
  else
    fail "Backup OMP extension or absence marker missing"
  fi
  if [ -f "$backup/$PLIST_BACKUP" ]; then
    /bin/cp "$backup/$PLIST_BACKUP" "$PLIST" || return 1
    /bin/chmod 600 "$PLIST" || return 1
  elif [ -f "$backup/ABSENT-$PLIST_BACKUP" ]; then
    /bin/rm -f "$PLIST" || return 1
  else
    fail "Backup LaunchAgent plist or absence marker missing"
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
  [ "$ready" -eq 1 ] || return 1
  /bin/launchctl print "$LAUNCH_DOMAIN/$LABEL" >/dev/null 2>&1
}

rollback_failed_install() {
  printf 'Install failed; restoring code-only backup %s\n' "$BACKUP_DIR" >&2
  /bin/launchctl bootout "$LAUNCH_DOMAIN/$LABEL" >/dev/null 2>&1 || true
  restore_backup "$BACKUP_DIR" || return 1
  if [ -f "$PLIST" ]; then
    /bin/launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST" || return 1
    /bin/launchctl kickstart -k "$LAUNCH_DOMAIN/$LABEL" || return 1
  fi
  wait_for_health
}

/bin/mkdir -p "$TARGET_DIR" "$LAUNCH_DIR" "$BACKUP_ROOT"
/bin/chmod 700 "$TARGET_DIR/backups" "$BACKUP_ROOT"
timestamp=$(/bin/date +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$timestamp-$$"
/bin/mkdir "$BACKUP_DIR"
/bin/chmod 700 "$BACKUP_DIR"
printf 'code-only-v2\n' > "$BACKUP_DIR/BACKUP-VERSION"
for file in $APP_FILES; do
  [ -f "$SOURCE_DIR/$file" ] || fail "Missing release asset: $file"
  /bin/mkdir -p "$(/usr/bin/dirname "$BACKUP_DIR/$file")"
  /bin/mkdir -p "$(/usr/bin/dirname "$BACKUP_DIR/ABSENT-$file")"
  if [ -f "$TARGET_DIR/$file" ]; then
    /bin/cp "$TARGET_DIR/$file" "$BACKUP_DIR/$file"
  else
    : > "$BACKUP_DIR/ABSENT-$file"
  fi
done
if [ -f "$OMP_EXTENSION_TARGET" ]; then
  /bin/cp "$OMP_EXTENSION_TARGET" "$BACKUP_DIR/$OMP_EXTENSION_BACKUP"
else
  : > "$BACKUP_DIR/ABSENT-$OMP_EXTENSION_BACKUP"
fi
if [ -f "$PLIST" ]; then
  /bin/cp "$PLIST" "$BACKUP_DIR/$PLIST_BACKUP"
else
  : > "$BACKUP_DIR/ABSENT-$PLIST_BACKUP"
fi
write_manifest "$BACKUP_DIR"
/usr/bin/find "$BACKUP_DIR" -type f -exec /bin/chmod 600 {} +
verify_backup "$BACKUP_DIR"

for file in $APP_FILES; do
  target_dir=$(/usr/bin/dirname "$TARGET_DIR/$file")
  target_name=$(/usr/bin/basename "$file")
  /bin/mkdir -p "$target_dir"
  tmp="$target_dir/.$target_name.tmp.$$"
  if ! /bin/cp "$SOURCE_DIR/$file" "$tmp" \
    || ! /bin/chmod 600 "$tmp" \
    || ! /bin/mv -f "$tmp" "$TARGET_DIR/$file" \
    || ! /usr/bin/cmp -s "$SOURCE_DIR/$file" "$TARGET_DIR/$file"; then
    /bin/rm -f "$tmp"
    rollback_failed_install || true
    fail "Failed to install $file"
  fi
done

if ! install_dependencies; then
  rollback_failed_install || true
  fail "Failed to install terminal dependencies"
fi

if ! /bin/mkdir -p "$(/usr/bin/dirname "$OMP_EXTENSION_TARGET")" \
  || ! /bin/cp "$OMP_EXTENSION_SOURCE" "$OMP_EXTENSION_TARGET" \
  || ! /bin/chmod 600 "$OMP_EXTENSION_TARGET" \
  || ! /usr/bin/cmp -s "$OMP_EXTENSION_SOURCE" "$OMP_EXTENSION_TARGET"; then
  rollback_failed_install || true
  fail "Failed to install OMP account control extension"
fi

NODE_XML=$(xml_escape "$NODE_BIN")
TARGET_XML=$(xml_escape "$TARGET_DIR")
WORKSPACE_XML=$(xml_escape "$WORKSPACE_DIR")
PLIST_TMP="$PLIST.tmp.$$"
if ! cat > "$PLIST_TMP" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_XML</string><string>$TARGET_XML/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>OMP_DASHBOARD_PORT</key><string>4177</string>
    <key>OMP_DASHBOARD_WORKSPACE</key><string>$WORKSPACE_XML</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$TARGET_XML/server.stdout.log</string>
  <key>StandardErrorPath</key><string>$TARGET_XML/server.stderr.log</string>
</dict></plist>
EOF
then
  /bin/rm -f "$PLIST_TMP"
  rollback_failed_install || true
  fail "Could not write LaunchAgent plist"
fi
if ! /usr/bin/plutil -lint "$PLIST_TMP" >/dev/null 2>&1 || ! /bin/chmod 600 "$PLIST_TMP" || ! /bin/mv -f "$PLIST_TMP" "$PLIST"; then
  /bin/rm -f "$PLIST_TMP"
  rollback_failed_install || true
  fail "LaunchAgent plist validation or install failed"
fi

/bin/launchctl bootout "$LAUNCH_DOMAIN/$LABEL" >/dev/null 2>&1 || true
if ! /bin/launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST" \
  || ! /bin/launchctl kickstart -k "$LAUNCH_DOMAIN/$LABEL" \
  || ! wait_for_health; then
  rollback_failed_install || printf 'Rollback health check failed\n' >&2
  fail "Dashboard install did not become healthy"
fi

printf 'Dashboard installed: http://127.0.0.1:4177/chat\n'
printf 'Quota dashboard: http://127.0.0.1:4177/quota\n'
printf 'Code-only backup: %s\n' "$BACKUP_DIR"
