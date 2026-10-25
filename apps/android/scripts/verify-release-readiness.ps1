# Verifies local release signing, static analysis, unit tests, and signed AAB/APK artifacts.
# Usage: .\apps\android\scripts\verify-release-readiness.ps1

$ErrorActionPreference = "Stop"
$androidDir = Split-Path -Parent $PSScriptRoot

Write-Host "=== Luminara Suite Android Release Readiness ===" -ForegroundColor Cyan

$keystore = Join-Path $androidDir "release.jks"
$propsFile = Join-Path $androidDir "keystore.properties"
if (-not (Test-Path $keystore)) {
    Write-Error "Missing $keystore - run generate-release-keystore.ps1 first."
}
if (-not (Test-Path $propsFile)) {
    Write-Error "Missing $propsFile"
}
Write-Host "[OK] Local keystore and keystore.properties exist" -ForegroundColor Green

. (Join-Path $PSScriptRoot "env.ps1")
Push-Location $androidDir
try {
    Write-Host "Running static analysis, unit tests, and release builds..." -ForegroundColor Cyan
    & .\gradlew.bat ktlintCheck detekt lintRelease test assembleDebug assembleDebugAndroidTest assembleRelease bundleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle verification or release build failed" }

    $apk = Get-ChildItem "app\build\outputs\apk\release\*.apk" | Select-Object -First 1
    if (-not $apk -or $apk.Name -match "unsigned") { throw "Signed release APK was not produced" }
    Write-Host "[OK] Signed APK: $($apk.FullName) ($([Math]::Round($apk.Length / 1KB, 1)) KiB)" -ForegroundColor Green

    $aab = Get-ChildItem "app\build\outputs\bundle\release\*.aab" | Select-Object -First 1
    if (-not $aab) { throw "No AAB produced" }
    Write-Host "[OK] Signed AAB: $($aab.FullName) ($([Math]::Round($aab.Length / 1KB, 1)) KiB)" -ForegroundColor Green

    $jarsigner = Join-Path $env:JAVA_HOME "bin\jarsigner.exe"
    $verifyOut = & $jarsigner -verify -strict $aab.FullName 2>&1 | Out-String
    if ($verifyOut -notmatch "jar verified") {
        throw "AAB signature verification failed: $verifyOut"
    }
    Write-Host "[OK] AAB signature verified via jarsigner" -ForegroundColor Green
} finally {
    Pop-Location
}
