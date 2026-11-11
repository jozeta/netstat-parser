# netstat-parser collector, POSIX part. Read-only: prints a header and the socket list to stdout.
# Mirrors the Linux and macOS commands on the app's "How to collect" page.
echo "### netstat-parser v1"
if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
  echo "hostname: $(scutil --get LocalHostName 2>/dev/null || hostname -s)"
  echo "os: macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
  echo "collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "addresses: $(ifconfig | awk '$1=="inet" || $1=="inet6" {print $2}' | grep -vE '^(127\.|::1|fe80:)' | paste -sd, - | sed 's/,/, /g')"
  echo "### netstat"
  netstat -anvW -p tcp
  netstat -anvW -p udp
else
  echo "hostname: $(hostname -s 2>/dev/null || hostname)"
  echo "os: $( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -sr)"
  echo "collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "addresses: $(ip -o addr show 2>/dev/null | awk '$4 !~ /^(127\.|::1)/ {print $4}' | paste -sd, - | sed 's/,/, /g')"
  echo "### netstat"
  if command -v ss >/dev/null 2>&1; then ss -tunap; else netstat -tunapW; fi
fi
