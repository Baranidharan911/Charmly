; Included by electron-builder (build.nsis.include).
; Remove the "Start at login" Run value on a real uninstall (not during an update, where the
; old uninstaller runs before the new version is installed and the setting must survive).
; Value names (verified against Electron 44 setLoginItemSettings, which names the value after
; the AppUserModelId):
;   in.elbrit.charmline       - v1.1+, main.js sets app.setAppUserModelId(appId)
;   electron.app.Charm Line   - v1.0, Electron's default AUMID "electron.app.<exe product name>"
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "in.elbrit.charmline"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Charm Line"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "in.elbrit.charmline"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.Charm Line"
  ${endIf}
!macroend
