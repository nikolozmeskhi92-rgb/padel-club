<#
  deploy.ps1 — one command instead of five.

  Run it from the project folder:  .\deploy

  The leading .\ is required — PowerShell will not run a command from the
  current directory without it.

  You launch deploy.cmd, not this file. Windows refuses to run an unsigned
  .ps1 at all ("running scripts is disabled on this system"), and a .cmd is
  exempt, so the wrapper starts PowerShell with that restriction lifted for
  its own process only — nothing about the machine's settings changes. This
  file lives in tools\ so that ".\deploy" cannot resolve to it by mistake:
  PowerShell looks for a .ps1 before a .cmd, and when both sat side by side
  it found this one and refused to run it.

  It does, in order:
    1. clears the stale .git lock files a bridge commit leaves behind
    2. refuses to deploy if something is uncommitted (so nothing is half-shipped)
    3. runs the tests
    4. runs a real production build — dev mode never type-checks
    5. pushes to booking-fixes, which is Vercel's production branch

  Any failing step stops it. Nothing reaches the live site unless the whole
  thing is green.

  Switches:
    -Check   run steps 1-4 and stop; never pushes
    -Fast    skip the build (use only for a docs-only change)
#>

param(
  [switch]$Check,
  [switch]$Fast
)

$ErrorActionPreference = 'Stop'
# PowerShell 7.4 turns a non-zero exit code from git/npm into a thrown exception,
# which would bury the plain-English message this script wants to give you.
# Harmless to set on Windows PowerShell 5.1, which has no such variable.
$PSNativeCommandUseErrorActionPreference = $false

# This file lives in <project>\tools, so the project itself is one level up.
# $PSScriptRoot is empty if these lines are pasted into a console rather than
# run as a file, so fall back to wherever you already are.
$repo   = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$branch = 'booking-fixes'

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Die($text) { Write-Host "`nSTOPPED: $text" -ForegroundColor Red; exit 1 }

Set-Location -LiteralPath $repo
Write-Host "Luki Padel — $repo" -ForegroundColor DarkGray

# 1 -------------------------------------------------------------------------
Step 1 'Clearing stale git locks'
# Commits made through the Claude bridge cannot delete their own lock files, so
# git leaves index.lock / HEAD.lock behind and the NEXT git command refuses to
# run. Harmless to remove when no git process is actually running.
Remove-Item .git\index.lock, .git\HEAD.lock, .git\refs\heads\*.lock `
  -Force -ErrorAction SilentlyContinue
Write-Host '    done'

# 2 -------------------------------------------------------------------------
Step 2 'Checking the working tree'
$dirty = git status --porcelain
if ($dirty) {
  Write-Host $dirty -ForegroundColor Yellow
  Die 'there are uncommitted changes. Commit them first, then run this again.'
}
$head = git log --oneline -1
Write-Host "    clean, at $head"

$ahead = $null
try { $ahead = git log --oneline "origin/$branch..$branch" 2>$null } catch { }
if (-not $ahead -and -not $Check) {
  Write-Host '    nothing to push — already up to date with GitHub.' -ForegroundColor DarkGray
}

# 3 -------------------------------------------------------------------------
Step 3 'Running the tests'
npm.cmd test --silent
if ($LASTEXITCODE -ne 0) { Die 'tests failed. Nothing was pushed.' }

# 4 -------------------------------------------------------------------------
if ($Fast) {
  Write-Host "`n[4] Build SKIPPED (-Fast)" -ForegroundColor Yellow
} else {
  Step 4 'Building for production'
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { Die 'the build failed. Nothing was pushed.' }
}

# 5 -------------------------------------------------------------------------
if ($Check) {
  Write-Host "`nAll green. -Check was set, so nothing was pushed." -ForegroundColor Green
  exit 0
}

Step 5 "Pushing to $branch (Vercel's production branch)"
git push origin $branch
if ($LASTEXITCODE -ne 0) { Die 'the push failed. Read the message above.' }

Write-Host "`nPushed. Vercel is building now." -ForegroundColor Green
Write-Host '   Give it a minute, then check the LIVE SITE, not the build log:' -ForegroundColor DarkGray
Write-Host '   https://padel-club-puce.vercel.app' -ForegroundColor DarkGray
