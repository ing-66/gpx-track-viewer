@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_runtime
where npm >nul 2>nul
if errorlevel 1 goto :no_runtime

if not exist "node_modules\" (
  echo 尚未完成首次安装。
  echo 请先双击“首次安装.bat”。
  pause
  exit /b 1
)
if not exist "data" mkdir "data"

echo 正在准备街巷消杀轨迹系统...
call npm run build
if errorlevel 1 (
  echo 系统构建失败，请查看上方错误。
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8787/api/tasks'; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 goto :open_app

start "街巷消杀轨迹系统" /min cmd /c "npm start"
powershell -NoProfile -Command "$ok=$false; 1..20 | ForEach-Object { if (-not $ok) { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8787/api/tasks'; if ($r.StatusCode -eq 200) { $ok=$true } } catch {}; if (-not $ok) { Start-Sleep -Milliseconds 300 } } }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo 本地服务未能启动。请检查 8787 端口是否被其他程序占用。
  pause
  exit /b 1
)

:open_app
if defined GPX_NO_BROWSER (
  echo 系统已就绪：http://127.0.0.1:8787/
  exit /b 0
)
start "" "http://127.0.0.1:8787/"
echo 系统已打开：http://127.0.0.1:8787/
exit /b 0

:no_runtime
echo 未检测到 Node.js/npm，请先安装 Node.js LTS。
pause
exit /b 1
