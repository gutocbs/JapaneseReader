$scriptPath = Join-Path $PSScriptRoot "deploy-local.ps1"
$powershell = (Get-Command pwsh.exe -ErrorAction Stop).Source

Describe "deploy-local.ps1" {
    It "reports the missing frontend dependency command before building" {
        $nodeModules = Join-Path (Split-Path -Parent $PSScriptRoot) "frontend\node_modules"
        $backup = "$nodeModules.deploy-local-test-backup"
        Move-Item -LiteralPath $nodeModules -Destination $backup
        try {
            $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath 2>&1 | Out-String
        }
        finally {
            Move-Item -LiteralPath $backup -Destination $nodeModules
        }

        $output | Should Match "Frontend dependencies missing"
        $output | Should Match "npm --prefix frontend ci"
    }
}
