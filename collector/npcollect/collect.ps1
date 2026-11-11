# netstat-parser collector, Windows part. Read-only: returns a header and the socket list.
# Mirrors the PowerShell command on the app's "How to collect" page.
$h = $env:COMPUTERNAME
$os = Get-CimInstance Win32_OperatingSystem
$ips = (Get-NetIPAddress | Where-Object { $_.IPAddress -notmatch '^(127\.|::1$)' } | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" }) -join ', '
$lines = @('### netstat-parser v1', "hostname: $h", "os: $($os.Caption) $($os.Version)",
  "collected: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))", "addresses: $ips", '### netstat') +
  (netstat -ano)
$lines -join "`r`n"
