$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$nodes = @(
    @{ name = 'consultorios'; container = 'salud_consultorios'; config = 'configuracion_consultorios.sql'; hasConsultorios = $true },
    @{ name = 'laboratorio'; container = 'salud_laboratorio'; config = 'configuracion_laboratorio.sql'; hasConsultorios = $false },
    @{ name = 'imagenes'; container = 'salud_imagenes'; config = 'configuracion_imagenes.sql'; hasConsultorios = $false }
)

$backupName = 'pre_upgrade_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
$backupDirectory = Join-Path $projectRoot (Join-Path 'backups' $backupName)
New-Item -ItemType Directory -Path $backupDirectory | Out-Null
$dockerPath = (Get-Command docker -ErrorAction Stop).Source

foreach ($node in $nodes) {
    $backupFile = Join-Path $backupDirectory ($node.name + '.dump')
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $dockerPath
    $start.Arguments = 'exec ' + $node.container + ' pg_dump -Fc -U salud_admin -d salud_db'
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    $output = [System.IO.File]::Create($backupFile)
    $process.StandardOutput.BaseStream.CopyTo($output)
    $output.Dispose()
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw ('Backup failed for ' + $node.name + ': ' + $errorText)
    }
    Write-Host ('Backup created: ' + $backupFile)
}

$sqlFiles = @(
    'sql/sincronizacion.sql',
    'sql/esquema_sedes.sql',
    'sql/migrar_nodos_existentes.sql',
    'sql/turnos.sql',
    'sql/eventos_automaticos.sql',
    'sql/eventos_consultorios.sql',
    'sql/configuracion_consultorios.sql',
    'sql/configuracion_laboratorio.sql',
    'sql/configuracion_imagenes.sql'
)

foreach ($node in $nodes) {
    foreach ($file in $sqlFiles) {
        docker cp $file ($node.container + ':/tmp/' + [System.IO.Path]::GetFileName($file))
        if ($LASTEXITCODE -ne 0) { throw ('Could not copy ' + $file + ' to ' + $node.name) }
    }
}

foreach ($node in $nodes) {
    $orderedFiles = @(
        'sincronizacion.sql',
        'esquema_sedes.sql',
        'migrar_nodos_existentes.sql',
        $node.config,
        'turnos.sql',
        'eventos_automaticos.sql'
    )
    if ($node.hasConsultorios) { $orderedFiles += 'eventos_consultorios.sql' }

    foreach ($file in $orderedFiles) {
        docker exec $node.container psql -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -f ('/tmp/' + $file)
        if ($LASTEXITCODE -ne 0) {
            throw ('Migration stopped at ' + $file + ' on ' + $node.name + '. Restore from ' + $backupDirectory + ' if needed.')
        }
    }
    Write-Host ('Database upgraded: ' + $node.name)
}

Write-Host ('Upgrade complete. Backups: ' + $backupDirectory)
