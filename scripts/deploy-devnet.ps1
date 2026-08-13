# Deploy Bullet to Solana Devnet
# Requires ~3.5 SOL in ~/.config/solana/id.json
# Fund via https://faucet.solana.com (devnet) if CLI airdrop is rate-limited

$ErrorActionPreference = "Stop"
$solanaBin = "$env:USERPROFILE\.local\share\solana\install\active_release\bin"
$avmBin = "$env:USERPROFILE\.avm\bin"
$env:Path = "$avmBin;$solanaBin;$env:USERPROFILE\.cargo\bin;" + $env:Path
$env:CARGO_TARGET_DIR = "$PSScriptRoot\target"

Set-Location $PSScriptRoot
solana config set --url https://api.devnet.solana.com
solana balance
if (-not (Test-Path "target\deploy\bullet.so")) {
  Write-Host "Building..."
  anchor build --no-idl
}
solana program deploy target\deploy\bullet.so --program-id target\deploy\bullet-keypair.json
solana program show (solana-keygen pubkey target\deploy\bullet-keypair.json)
