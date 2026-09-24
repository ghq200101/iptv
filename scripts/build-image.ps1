param(
    [string]$ImageName = $env:DOCKER_IMAGE_NAME,
    [switch]$NoPush,
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'

if (-not $ImageName) { $ImageName = 'ghq200101/iptv' }

$PackageJsonPath = Join-Path $PSScriptRoot '..\package.json'
if (-not (Test-Path $PackageJsonPath)) {
    throw "package.json not found: $PackageJsonPath"
}

$Package = Get-Content -Path $PackageJsonPath -Raw | ConvertFrom-Json
$Version = [string]$Package.version
if (-not ($Version -match '^\d+\.\d+\.\d+$')) {
    throw "Invalid version in package.json: $Version"
}

$VersionParts = $Version.Split('.')
$Major = $VersionParts[0]
$Minor = $VersionParts[1]
$Patch = $VersionParts[2]

$Tags = @(
    'latest',
    $Version,
    "$Major.$Minor",
    $Major
) | Select-Object -Unique

function Ensure-DockerAvailable {
    Write-Host "[1/4] Checking Docker availability"
    docker version --format '{{.Server.Version}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not available or not running. Start Docker Desktop/Engine first."
    }
}

function Ensure-DockerLogin {
    if ($NoPush -or $LocalOnly) { return }

    Write-Host "[2/4] Checking Docker Hub login state"
    $dockerConfig = $env:DOCKER_CONFIG
    if (-not $dockerConfig) { $dockerConfig = Join-Path $HOME '.docker' }
    $authFile = Join-Path $dockerConfig 'config.json'
    if (-not (Test-Path $authFile)) {
        Write-Host "Docker login config not found at $authFile"
        Write-Host "You may need to run: docker login"
        Write-Host "If you are using a proxy or custom environment, fix that before pushing."
    }
}

Ensure-DockerAvailable
Ensure-DockerLogin

Write-Host "Docker image: $ImageName"
Write-Host "Version: $Version"
Write-Host "Tags: $($Tags -join ', ')"

$BuildTarget = "${ImageName}:latest"
Write-Host "[3/4] Building image"
Write-Host "Building $BuildTarget"
docker build -t $BuildTarget .
if ($LASTEXITCODE -ne 0) {
    throw "docker build failed for $BuildTarget. Check Docker base image access and network."
}

if ($NoPush -or $LocalOnly) {
    Write-Host "Local build complete; no push requested."
    Write-Host "Local tags:"
    foreach ($Tag in $Tags) {
        Write-Host "  ${ImageName}:${Tag}"
    }
    return
}

Write-Host "[4/4] Pushing release tags"
foreach ($Tag in $Tags) {
    $FullTag = "${ImageName}:${Tag}"
    if ($Tag -ne 'latest') {
        docker tag $BuildTarget $FullTag
        if ($LASTEXITCODE -ne 0) { throw "docker tag failed for $FullTag" }
    }

    Write-Host "Pushing $FullTag"
    docker push $FullTag
    if ($LASTEXITCODE -ne 0) {
        throw "docker push failed for $FullTag. Check Docker Hub credentials, proxy settings, and network access."
    }
}

Write-Host "`nPublished image tags:"
foreach ($Tag in $Tags) {
    Write-Host "  ${ImageName}:${Tag}"
}
