$ErrorActionPreference = "Stop"

$repoUrlSsh = "git@github.com:a964480551-web/my-notes.git"
$email = "a964480551-web@users.noreply.github.com"

Write-Host "== Push Project To GitHub ==" -ForegroundColor Cyan

# Always use script folder as repo path to avoid Chinese path encoding issues
$repoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repoPath

if (-not (Test-Path -LiteralPath ".git")) {
  throw "Not a git repo: $repoPath"
}

Write-Host "1) Set remote URL..." -ForegroundColor Yellow
git remote set-url origin $repoUrlSsh

Write-Host "2) Configure SSH over port 443..." -ForegroundColor Yellow
$sshDir = Join-Path $HOME ".ssh"
if (-not (Test-Path -LiteralPath $sshDir)) {
  New-Item -ItemType Directory -Path $sshDir | Out-Null
}

$sshConfig = @"
Host github.com
  HostName ssh.github.com
  User git
  Port 443
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
"@
$sshConfigPath = Join-Path $sshDir "config"
$sshConfig | Out-File -LiteralPath $sshConfigPath -Encoding ascii

$privateKey = Join-Path $sshDir "id_ed25519"
$publicKey = Join-Path $sshDir "id_ed25519.pub"

if (-not (Test-Path -LiteralPath $privateKey) -or -not (Test-Path -LiteralPath $publicKey)) {
  Write-Host "3) Generate SSH key..." -ForegroundColor Yellow
  ssh-keygen -t ed25519 -C $email -f $privateKey -N ""
}

Write-Host "3) Test SSH auth..." -ForegroundColor Yellow
$sshText = cmd /c "ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1"
$sshText = ($sshText | Out-String)

if ($sshText -match "successfully authenticated" -or $sshText -match "Hi ") {
  Write-Host "SSH auth ok, pushing..." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "SSH auth failed. Add this public key to GitHub:" -ForegroundColor Red
  Get-Content -LiteralPath $publicKey
  Write-Host ""
  Write-Host "Path: GitHub -> Settings -> SSH and GPG keys -> New SSH key" -ForegroundColor Red
  Write-Host "Then run this script again." -ForegroundColor Red
  exit 1
}

Write-Host "4) Push to origin/main..." -ForegroundColor Yellow
git push -u origin main

Write-Host ""
Write-Host "Done: project pushed to GitHub." -ForegroundColor Green
