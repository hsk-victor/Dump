; Next.js writes a route cache into server\.next at runtime. Left in place by an update, it keeps serving
; the previous build's pages (and their old JS), so clear the old server before installing the new one.
; Close the running app first (cancelling aborts with nothing deleted), then give its server a few
; seconds to exit so node.exe is no longer locked.
!macro NSIS_HOOK_PREINSTALL
  StrCmp $INSTDIR "" dump_hook_done
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  StrCpy $R9 0
  dump_hook_wait:
    ClearErrors
    Delete "$INSTDIR\server\node.exe"
    IfErrors 0 dump_hook_clear
    IntOp $R9 $R9 + 1
    IntCmp $R9 20 dump_hook_done
    Sleep 500
    Goto dump_hook_wait
  dump_hook_clear:
    RMDir /r "$INSTDIR\server"
  dump_hook_done:
!macroend
