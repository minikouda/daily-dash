#!/bin/zsh
# Install (or reinstall) the three launchd agents:
#   web      dashboard on http://127.0.0.1:8765, always running
#   digest   08:00 daily: fetch + extract + briefing
#   refresh  every 4 hours: fetch + extract (Claude only runs if there's new mail)
# Usage: scripts/install-launchd.sh [uninstall]
set -euo pipefail

PROJECT="${0:A:h:h}"
UV="$(command -v uv)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/.daily-dash/logs"
LABEL_PREFIX="com.${USER}.dailydash"
PATH_ENV="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
UID_NUM="$(id -u)"

mkdir -p "$AGENTS" "$LOGS"

unload() {
  for job in web digest refresh; do
    launchctl bootout "gui/$UID_NUM/$LABEL_PREFIX.$job" 2>/dev/null || true
    # bootout returns before the job is gone; bootstrapping too early fails with error 5.
    for _ in {1..50}; do
      launchctl print "gui/$UID_NUM/$LABEL_PREFIX.$job" >/dev/null 2>&1 || break
      sleep 0.2
    done
    rm -f "$AGENTS/$LABEL_PREFIX.$job.plist"
  done
}

if [[ "${1:-}" == "uninstall" ]]; then
  unload
  echo "removed daily-dash launchd agents"
  exit 0
fi

write_plist() {  # name, args (space separated), schedule xml
  local name=$1 args=$2 schedule=$3
  local plist="$AGENTS/$LABEL_PREFIX.$name.plist"
  local arg_xml=""
  for a in ${=args}; do arg_xml+="    <string>$a</string>"$'\n'; done
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_PREFIX.$name</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UV</string>
    <string>run</string>
    <string>--project</string>
    <string>$PROJECT</string>
    <string>daily-dash</string>
$arg_xml  </array>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH_ENV</string></dict>
  <key>StandardOutPath</key><string>$LOGS/$name.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$name.log</string>
  <key>ProcessType</key><string>Background</string>
$schedule
</dict>
</plist>
EOF
  plutil -lint "$plist" >/dev/null
  launchctl bootstrap "gui/$UID_NUM" "$plist"
  echo "installed $LABEL_PREFIX.$name"
}

unload
write_plist web "web" "  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>"
write_plist digest "run digest" "  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>"
write_plist refresh "run refresh" "  <key>StartInterval</key><integer>14400</integer>"

echo "dashboard: http://127.0.0.1:8765   logs: $LOGS"
