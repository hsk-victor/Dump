; Next.js writes a route cache into server\.next at runtime. Left in place by an update, it keeps serving
; the previous build's pages (and their old JS), so clear the old server before installing the new one.
!macro NSIS_HOOK_PREINSTALL
  StrCmp $INSTDIR "" +2
    RMDir /r "$INSTDIR\server"
!macroend
