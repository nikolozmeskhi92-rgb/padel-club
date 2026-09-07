@echo off
REM Deploy without arguing with PowerShell's execution policy.
REM
REM Typing .\deploy.ps1 on a default Windows install fails with "running
REM scripts is disabled on this system". A .cmd file is not a script in that
REM sense, so this one runs the real thing for you, unblocked for this one
REM process only - no machine-wide security setting is changed.
REM
REM   .\deploy           test, build, push
REM   .\deploy -Check    test and build, push nothing
REM   .\deploy -Fast     skip the build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy.ps1" %*
