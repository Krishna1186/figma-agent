$source = "C:\Users\omen\figma-agent\backend_fastapi"
$dest = "\\wsl$\Ubuntu\home\omen\projects\figma-agent\backend_fastapi"
robocopy $source $dest /MIR /XD __pycache__ .venv /XF "*.pyc"
Write-Host "Sync complete"
