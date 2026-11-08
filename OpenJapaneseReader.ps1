[CmdletBinding()]
param(
    [int]$StartupTimeoutSeconds = 120,
    [int]$HealthCheckIntervalSeconds = 2,
    [switch]$ForceRecreate
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$imageName = 'japanesereader:latest'
$url = 'http://localhost:8000/'
$healthUrl = 'http://localhost:8000/api/health'
$documentationUrl = 'http://localhost:8000/docs'
$composeFile = Join-Path $projectRoot 'docker-compose.yml'
$composeStartedByScript = $false

function Log {
    param([string]$Message)

    $timestamp = Get-Date -Format 'dd/MM/yyyy HH:mm:ss'
    Write-Host "[$timestamp] $Message"
}

function Test-ApplicationHealth {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
    throw "docker-compose.yml não foi encontrado em '$projectRoot'."
}

try {
    Push-Location $projectRoot

    if ($ForceRecreate) {
        Log "Reconstruindo a imagem '$imageName' sem cache..."
        docker compose build --no-cache
        if ($LASTEXITCODE -ne 0) {
            throw 'O Docker Compose não conseguiu reconstruir a imagem.'
        }

        Log 'Recriando o container com a imagem reconstruída...'
        docker compose up -d --force-recreate --no-build
    }
    else {
        docker image inspect $imageName *> $null
        $imageExists = $LASTEXITCODE -eq 0

        if ($imageExists) {
            Log "A imagem '$imageName' já existe. Iniciando a aplicação com Docker Compose..."
            docker compose up -d
        }
        else {
            Log "A imagem '$imageName' não existe. Construindo e iniciando a aplicação com Docker Compose..."
            docker compose up -d --build
        }
    }

    if ($LASTEXITCODE -ne 0) {
        throw 'O Docker Compose não conseguiu iniciar a aplicação.'
    }
    $composeStartedByScript = $true

    docker image inspect $imageName *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "A imagem '$imageName' não foi encontrada após o build."
    }

    Log "Aguardando a aplicação responder em $healthUrl..."
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-ApplicationHealth) {
            break
        }

        Start-Sleep -Seconds $HealthCheckIntervalSeconds
    }

    if (-not (Test-ApplicationHealth)) {
        throw "A aplicação não ficou saudável dentro de $StartupTimeoutSeconds segundos. Consulte 'docker compose logs'."
    }

    Log "Aplicação pronta. Abrindo $url"
    Start-Process $url | Out-Null
    Log "Documentação da API: $documentationUrl"
    Log 'A aplicação continuará executando em Docker. Pressione Ctrl+C para encerrá-la.'

    while ($true) {
        Start-Sleep -Seconds 60
    }
}
catch {
    Log "Erro: $($_.Exception.Message)"
    throw
}
finally {
    Pop-Location -ErrorAction SilentlyContinue

    if ($composeStartedByScript) {
        Log 'Parando a aplicação Docker sem remover o container...'
        docker compose -f $composeFile stop
        if ($LASTEXITCODE -ne 0) {
            Log 'Não foi possível parar a aplicação automaticamente.'
        }
        else {
            Log 'Aplicação parada; o container foi preservado.'
        }
    }
}
