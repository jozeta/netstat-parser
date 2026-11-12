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
  echo "os: $( [ -r /etc/os-release ] && . /etc/os-release && echo "$PRETTY_NAME" || uname -sr)"
  echo "collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "addresses: $(if command -v ip >/dev/null 2>&1; then ip -o addr show 2>/dev/null | awk '$4 !~ /^(127\.|::1)/ {print $4}'; else ifconfig 2>/dev/null | awk '$1=="inet" || $1=="inet6" {a=$2; if (a=="addr:") a=$3; sub(/^addr:/, "", a); m=""; for (i=3; i<=NF; i++) { if ($i=="netmask" || $i=="prefixlen") m="/" $(i+1); else if ($i ~ /^Mask:/) m="/" substr($i, 6) } if (a !~ /^(127\.|::1(\/|$)|fe80:)/) print a m}'; fi | paste -sd, - | sed 's/,/, /g')"
  echo "### netstat"
  if command -v ss >/dev/null 2>&1; then ss -tunap; else netstat -tunapW; fi
fi
