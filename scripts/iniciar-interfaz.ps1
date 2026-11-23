param(
  [int]$Puerto = 4173
)

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$servidor = Join-Path $raiz 'web/server.js'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no está instalado o no aparece en PATH.'
}

Push-Location $raiz
$puertoAnterior = $env:UI_PORT
try {
  $env:UI_PORT = [string]$Puerto
  Write-Host "Interfaz local: http://127.0.0.1:$Puerto"
  Write-Host 'Mantené esta ventana abierta. Ctrl+C detiene solo la interfaz web.'
  node $servidor
} finally {
  if ($null -eq $puertoAnterior) {
    Remove-Item Env:UI_PORT -ErrorAction SilentlyContinue
  } else {
    $env:UI_PORT = $puertoAnterior
  }
  Pop-Location
}
