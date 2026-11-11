// "How to collect" page: copy-ready commands that write <hostname>_netstat.txt with a header.
import { el, replace } from "./dom.js";

export const COMMANDS = [
  {
    id: "win-ps",
    title: "Windows — PowerShell (recommended)",
    note: "Run in PowerShell. As administrator you also get process names with netstat -anob; -ano works for any user and still shows PIDs.",
    code: `$h = $env:COMPUTERNAME
$os = Get-CimInstance Win32_OperatingSystem
$ips = (Get-NetIPAddress | Where-Object { $_.IPAddress -notmatch '^(127\\.|::1$)' } | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" }) -join ', '
@('### netstat-parser v1', "hostname: $h", "os: $($os.Caption) $($os.Version)",
  "collected: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))", "addresses: $ips", '### netstat') +
  (netstat -ano) | Out-File -Encoding utf8 "$($h)_netstat.txt"`,
  },
  {
    id: "win-cmd",
    title: "Windows — cmd (no header)",
    note: "Works everywhere, any display language. The file name carries the hostname.",
    code: "netstat -ano > %COMPUTERNAME%_netstat.txt",
  },
  {
    id: "linux",
    title: "Linux — bash",
    note: "Uses ss, or netstat -W if ss is missing (-W keeps long IPv6 addresses intact). Run with sudo to see process names for every socket.",
    code: `h=$(hostname -s 2>/dev/null || hostname)
{
  echo "### netstat-parser v1"
  echo "hostname: $h"
  echo "os: $( [ -r /etc/os-release ] && . /etc/os-release && echo "$PRETTY_NAME" || uname -sr)"
  echo "collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "addresses: $(ip -o addr show 2>/dev/null | awk '$4 !~ /^(127\\.|::1)/ {print $4}' | paste -sd, - | sed 's/,/, /g')"
  echo "### netstat"
  if command -v ss >/dev/null 2>&1; then ss -tunap; else netstat -tunapW; fi
} > "\${h}_netstat.txt"`,
  },
  {
    id: "macos",
    title: "macOS — zsh or bash",
    note: "-W keeps long IPv6 addresses intact; -v adds process names and PIDs. Run with sudo to see every process.",
    code: `h=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
{
  echo "### netstat-parser v1"
  echo "hostname: $h"
  echo "os: macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
  echo "collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "addresses: $(ifconfig | awk '$1=="inet" || $1=="inet6" {print $2}' | grep -vE '^(127\\.|::1|fe80:)' | paste -sd, - | sed 's/,/, /g')"
  echo "### netstat"
  netstat -anvW -p tcp
  netstat -anvW -p udp
} > "\${h}_netstat.txt"`,
  },
];

async function copy(text, pre, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to the clipboard.");
  } catch {
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast("Press Ctrl+C / ⌘C to copy the selected command.", "warn");
  }
}

/** @param {HTMLElement} root */
export function renderCollect(root, { toast }) {
  if (root.childElementCount) return; // static content: render once
  replace(root,
    el("section", { class: "lg-card lg-stack" },
      el("p", null, "Run one of these on each computer. Each writes ", el("code", { class: "lg-code" }, "<hostname>_netstat.txt"),
        " in the current folder, with a short header (hostname, OS, addresses, time) so the app knows which machine the file came from. Then load all the files on the Graph page."),
      el("p", { class: "lg-muted lg-small" }, "The commands only read information; they change nothing on the computer. Plain netstat output without the header works too.")),
    COMMANDS.map((c) => {
      const pre = el("pre", { id: `cmd-${c.id}` }, c.code);
      return el("section", { class: "lg-card lg-stack", "aria-labelledby": `h-${c.id}` },
        el("h2", { class: "lg-subtitle", id: `h-${c.id}` }, c.title),
        el("p", { class: "lg-muted lg-small" }, c.note),
        el("div", { class: "np-cmd" }, pre, el("button", { class: "lg-btn", type: "button", onclick: () => copy(c.code, pre, toast), "aria-label": `Copy ${c.title} command` }, "Copy")));
    }),
    el("section", { class: "lg-card lg-stack" },
      el("h2", { class: "lg-subtitle" }, "Many machines at once"),
      el("p", null, "The collector script in this project's ", el("code", { class: "lg-code" }, "collector/"),
        " folder (Python 3) runs the same commands remotely over SSH or WinRM and saves the files on your machine. Export ",
        el("em", null, "Collector targets"), " from the graph to get a starting list of hosts that appear in your files but have none of their own.")));
}
