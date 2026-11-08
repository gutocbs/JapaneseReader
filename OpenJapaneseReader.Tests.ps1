$scriptPath = Join-Path $PSScriptRoot "OpenJapaneseReader.ps1"
$powershell = (Get-Command pwsh.exe -ErrorAction Stop).Source

Describe "OpenJapaneseReader.ps1" {
    It "keeps the existing image path when ForceRecreate is omitted" {
        $fakeBin = Join-Path $TestDrive "default-bin"
        $fakeDocker = Join-Path $fakeBin "docker.cmd"
        $dockerLog = Join-Path $TestDrive "default-docker.log"
        New-Item -ItemType Directory -Path $fakeBin | Out-Null
        Set-Content -LiteralPath $fakeDocker -Value @(
            "@echo off"
            'echo %*>> "%FAKE_DOCKER_LOG%"'
            "exit /b 0"
        )

        $originalPath = $env:PATH
        $originalDockerLog = $env:FAKE_DOCKER_LOG
        try {
            $env:PATH = "$fakeBin;$originalPath"
            $env:FAKE_DOCKER_LOG = $dockerLog
            $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -StartupTimeoutSeconds 0 2>&1 | Out-String
        }
        finally {
            $env:PATH = $originalPath
            $env:FAKE_DOCKER_LOG = $originalDockerLog
        }

        $output | Should Match "não ficou saudável"
        $dockerCommands = Get-Content -LiteralPath $dockerLog | Out-String
        $dockerCommands | Should Match "image inspect japanesereader:latest"
        $dockerCommands | Should Match "compose up -d"
        $dockerCommands | Should Not Match "compose build --no-cache"
        $dockerCommands | Should Not Match "force-recreate"
    }

    It "rebuilds without cache and recreates the container when ForceRecreate is set" {
        $fakeBin = Join-Path $TestDrive "bin"
        $fakeDocker = Join-Path $fakeBin "docker.cmd"
        $dockerLog = Join-Path $TestDrive "docker.log"
        New-Item -ItemType Directory -Path $fakeBin | Out-Null
        Set-Content -LiteralPath $fakeDocker -Value @(
            "@echo off"
            'echo %*>> "%FAKE_DOCKER_LOG%"'
            "exit /b 0"
        )

        $originalPath = $env:PATH
        $originalDockerLog = $env:FAKE_DOCKER_LOG
        try {
            $env:PATH = "$fakeBin;$originalPath"
            $env:FAKE_DOCKER_LOG = $dockerLog
            $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ForceRecreate -StartupTimeoutSeconds 0 2>&1 | Out-String
        }
        finally {
            $env:PATH = $originalPath
            $env:FAKE_DOCKER_LOG = $originalDockerLog
        }

        $output | Should Match "não ficou saudável"
        $dockerCommands = Get-Content -LiteralPath $dockerLog | Out-String
        $dockerCommands | Should Match "compose build --no-cache"
        $dockerCommands | Should Match "compose up -d --force-recreate --no-build"
    }
}
