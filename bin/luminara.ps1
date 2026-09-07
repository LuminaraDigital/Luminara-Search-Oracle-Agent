# ==============================================================================
# Luminara Archy: Standalone Command Router (PowerShell)
# Usage: .\bin\luminara.ps1 <group> <action> [args] [--flags]
# ==============================================================================

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
)

$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Node.js is required to execute the Luminara CLI harness."
    exit 1
}

$CliScript = Join-Path $RepoRoot "services\harness\standaloneCli.ts"
& npx tsx $CliScript $CommandArgs
exit $LASTEXITCODE
