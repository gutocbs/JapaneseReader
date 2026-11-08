$scriptPath = Join-Path $PSScriptRoot "deploy-local.ps1"
$powershell = (Get-Command pwsh.exe -ErrorAction Stop).Source

Describe "deploy-local.ps1" {
    It "attempts to install missing frontend dependencies before building" {
        $nodeModules = Join-Path (Split-Path -Parent $PSScriptRoot) "frontend\node_modules"
        $backup = "$nodeModules.deploy-local-test-backup"
        $fakeBin = Join-Path $TestDrive "bin"
        $fakeNpm = Join-Path $fakeBin "npm.cmd"
        New-Item -ItemType Directory -Path $fakeBin | Out-Null
        Set-Content -LiteralPath $fakeNpm -Value @(
            "@echo off"
            "exit /b 37"
        )

        $originalPath = $env:PATH
        Move-Item -LiteralPath $nodeModules -Destination $backup
        try {
            $env:PATH = "$fakeBin;$originalPath"
            $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath 2>&1 | Out-String
        }
        finally {
            $env:PATH = $originalPath
            Move-Item -LiteralPath $backup -Destination $nodeModules
        }

        $output | Should Match "Installing frontend dependencies"
        $output | Should Match "Installing frontend dependencies failed with exit code 37"
    }
}
