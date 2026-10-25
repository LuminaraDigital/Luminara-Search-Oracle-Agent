<#
.SYNOPSIS
    Generates a production 4096-bit RSA release signing keystore for Luminara Suite Android.
.DESCRIPTION
    Uses keytool to generate a high-entropy release key, outputting release.jks and
    populating keystore.properties for local Gradle builds.
#>
param(
    [string]$KeystoreName = "release.jks",
    [string]$Alias = "luminarasuite-release",
    [string]$Password = "",
    [int]$ValidityDays = 10000
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "env.ps1")

$Keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
if (-not (Test-Path $Keytool)) {
    $Keytool = "keytool"
}

if (-not $Password) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $passBuilder = New-Object System.Text.StringBuilder
    foreach ($b in $bytes) {
        $idx = $b % $chars.Length
        [void]$passBuilder.Append($chars[$idx])
    }
    $Password = $passBuilder.ToString()
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidDir = Split-Path -Parent $ScriptDir
$KeystorePath = Join-Path $AndroidDir $KeystoreName
$PropertiesPath = Join-Path $AndroidDir "keystore.properties"

if (Test-Path $KeystorePath) {
    Write-Host "Keystore already exists at $KeystorePath" -ForegroundColor Green
    exit 0
}

Write-Host "Generating 4096-bit RSA release keystore at: $KeystorePath" -ForegroundColor Cyan

& $Keytool -genkeypair -v `
    -keystore $KeystorePath `
    -alias $Alias `
    -keyalg RSA `
    -keysize 4096 `
    -validity $ValidityDays `
    -storepass $Password `
    -keypass $Password `
    -dname "CN=Luminara Suite, OU=Mobile Engineering, O=Luminara Digital Pty Ltd, L=Melbourne, ST=VIC, C=AU"

if ($LASTEXITCODE -eq 0) {
    $propsContent = @"
# Generated $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
storeFile=$KeystoreName
storePassword=$Password
keyAlias=$Alias
keyPassword=$Password
"@
    Set-Content -Path $PropertiesPath -Value $propsContent -Encoding UTF8
    Write-Host "Created local keystore.properties at $PropertiesPath" -ForegroundColor Green
} else {
    Write-Error "Failed to generate keystore."
}
