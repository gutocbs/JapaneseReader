[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8000,

    [string]$DatabasePath,

    [switch]$OpenBrowser,

    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $projectRoot "frontend"
$frontendDist = Join-Path $frontendRoot "dist"
$logRoot = Join-Path $projectRoot ".dev\local-deploy"
$stdoutLog = Join-Path $logRoot "backend.stdout.log"
$stderrLog = Join-Path $logRoot "backend.stderr.log"
$url = "http://127.0.0.1:$Port"
$healthUrl = "$url/api/health"

function Get-RequiredCommand([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required command '$Name' was not found in PATH."
    }

    return $command.Source
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    Write-Host "$Description..."
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path (Join-Path $frontendRoot "package.json") -PathType Leaf)) {
    throw "Frontend package was not found at '$frontendRoot'."
}

$requiredFrontendCommands = @(
    Join-Path $frontendRoot "node_modules\.bin\tsc.cmd"
    Join-Path $frontendRoot "node_modules\.bin\vite.cmd"
)
$missingFrontendCommands = $requiredFrontendCommands | Where-Object {
    -not (Test-Path $_ -PathType Leaf)
}
if ($missingFrontendCommands) {
    throw "Frontend dependencies missing. Run 'npm --prefix frontend ci' from '$projectRoot' before running deploy-local.ps1. Missing: $($missingFrontendCommands -join ', ')."
}

$npm = Get-RequiredCommand "npm.cmd"
$uv = Get-RequiredCommand "uv"

if (-not $SkipBuild) {
    Invoke-CheckedCommand -FilePath $npm -ArgumentList @(
        "--prefix", $frontendRoot,
        "run", "build"
    ) -Description "Building the frontend"
}
else {
    Write-Host "Skipping frontend build (-SkipBuild)."
}

if (-not (Test-Path (Join-Path $frontendDist "index.html") -PathType Leaf)) {
    throw "Frontend build output is missing '$frontendDist\index.html'. Run without -SkipBuild or build the frontend first."
}

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$previousStaticDirectory = [Environment]::GetEnvironmentVariable("STATIC_DIRECTORY", "Process")
$previousDatabasePath = [Environment]::GetEnvironmentVariable("DATABASE_PATH", "Process")
$serverProcess = $null

try {
    [Environment]::SetEnvironmentVariable("STATIC_DIRECTORY", (Resolve-Path $frontendDist).Path, "Process")
    if ($DatabasePath) {
        $databaseCandidate = if ([IO.Path]::IsPathFullyQualified($DatabasePath)) {
            $DatabasePath
        }
        else {
            Join-Path $projectRoot $DatabasePath
        }
        $resolvedDatabasePath = [IO.Path]::GetFullPath($databaseCandidate)
        [Environment]::SetEnvironmentVariable("DATABASE_PATH", $resolvedDatabasePath, "Process")
    }

    Write-Host "Starting local deployment on $url..."
    $serverProcess = Start-Process -FilePath $uv -ArgumentList @(
        "run", "uvicorn", "backend.app.main:app",
        "--host", "127.0.0.1",
        "--port", $Port
    ) -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru -WindowStyle Hidden

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $healthy = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($serverProcess.HasExited) {
            throw "Backend exited before becoming ready (exit code $($serverProcess.ExitCode)). See '$stderrLog'."
        }

        try {
            $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
            if ($response.status -eq "ok") {
                $healthy = $true
                break
            }
        }
        catch {
            # The server may still be starting or loading Sudachi data.
        }

        Start-Sleep -Milliseconds 250
    }

    if (-not $healthy) {
        throw "Backend did not become healthy within 30 seconds. See '$stdoutLog' and '$stderrLog'."
    }

    Write-Host "Local deployment is ready: $url"
    Write-Host "Health check: $healthUrl"
    Write-Host "Logs: $logRoot"
    Write-Host "Press Ctrl+C to stop the local deployment."

    if ($OpenBrowser) {
        Start-Process $url | Out-Null
    }

    while (-not $serverProcess.HasExited) {
        Start-Sleep -Milliseconds 500
    }
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        & taskkill.exe /PID $serverProcess.Id /T /F | Out-Null
        $serverProcess.WaitForExit()
    }

    [Environment]::SetEnvironmentVariable("STATIC_DIRECTORY", $previousStaticDirectory, "Process")
    [Environment]::SetEnvironmentVariable("DATABASE_PATH", $previousDatabasePath, "Process")
}
