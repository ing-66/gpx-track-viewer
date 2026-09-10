@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node
where npm >nul 2>nul
if errorlevel 1 goto :no_npm

if not exist "package.json" (
  echo ========================================
  echo 项目配置不完整：缺少 package.json
  echo 请重新 Clone 项目后再试。
  echo ========================================
  pause
  exit /b 1
)
if not exist "server.js" (
  echo ========================================
  echo 项目配置不完整：缺少 server.js
  echo 请重新 Clone 项目后再试。
  echo ========================================
  pause
  exit /b 1
)

echo 正在安装项目依赖，请稍候...
call npm ci
if errorlevel 1 (
  echo ========================================
  echo 依赖安装失败，请检查网络后重新运行本文件。
  echo 仍失败时可执行：npm cache verify
  echo ========================================
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

echo ========================================
echo 首次安装完成
echo.
echo 以后无需再次运行本文件。
echo.
echo 日常使用请双击：
echo 启动系统.bat
echo ========================================
pause
exit /b 0

:no_node
echo ========================================
echo 未检测到 Node.js
echo 请先安装 Node.js LTS 后重新运行本程序。
echo.
echo 安装完成后关闭当前窗口，
echo 重新双击“首次安装.bat”。
echo ========================================
pause
exit /b 1

:no_npm
echo ========================================
echo 未检测到 npm
echo 请重新安装 Node.js LTS 后再运行本程序。
echo ========================================
pause
exit /b 1
