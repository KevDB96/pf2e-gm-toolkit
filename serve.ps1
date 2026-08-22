$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = 'http://localhost:8001/'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "HTTP server listening on $prefix (Serving from $folder). Press Ctrl+C to stop."
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath.TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = Join-Path $folder $path
    if (-not (Test-Path $file)) {
      $ctx.Response.StatusCode = 404
      $buf = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $ctx.Response.OutputStream.Write($buf,0,$buf.Length)
      $ctx.Response.Close()
      continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $mime = 'application/octet-stream'
    switch -regex ($file) {
      '\.html$' { $mime='text/html' }
      '\.css$' { $mime='text/css' }
      '\.js$' { $mime='application/javascript' }
      '\.json$' { $mime='application/json' }
      '\.png$' { $mime='image/png' }
      '\.jpg$' { $mime='image/jpeg' }
      '\.jpeg$' { $mime='image/jpeg' }
    }
    $ctx.Response.ContentType = $mime
    $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
    $ctx.Response.Close()
  } catch {
  }
}
