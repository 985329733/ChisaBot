; ChisaBot PC 安装脚本补充（package.json build.nsis.include；docs/online-update.md §2.1）。
;
; electron-builder 的安装包在更新模式（--updated，在线更新默认就是这样运行的）下会保留旧的快捷方式
; （keepShortcuts），也不刷新 Windows 图标缓存：exe 里的图标换了，桌面 / 开始菜单 / 任务栏上看到的还是旧的。
; 每次安装（全新安装、更新、重新安装）结束时这里都会：
;   1. 把还存在的桌面、开始菜单快捷方式按新 exe 重写一遍（用户删掉的不会再建）；
;   2. 通知资源管理器图标已变（SHChangeNotify SHCNE_ASSOCCHANGED + SHCNF_FLUSH）；
;   3. 运行 ie4uinit.exe -show（Windows 10/11 重建图标缓存；旧系统用 -ClearIconCache），失败就算了。
; 任务栏固定的快捷方式由客户端首次启动时更新（src/shell-refresh.js），安装程序不碰它。

!macro chisabotRefreshLink LINK
  ${if} ${FileExists} "${LINK}"
    CreateShortCut "${LINK}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "${LINK}" "${APP_ID}"
  ${endIf}
!macroend

!macro customInstall
  !insertmacro chisabotRefreshLink "$newDesktopLink"
  !insertmacro chisabotRefreshLink "$newStartMenuLink"
  ; SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_FLUSH = 0x1000
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
  ${if} ${FileExists} "$SYSDIR\ie4uinit.exe"
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
    Pop $0
    ${if} $0 != 0
      nsExec::Exec '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
      Pop $0
    ${endIf}
  ${endIf}
!macroend
