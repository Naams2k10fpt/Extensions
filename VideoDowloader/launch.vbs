Set WshShell = CreateObject("WScript.Shell")
' Get the directory path of the current VBScript file
strPath = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))

' Start the Node.js backend server in the background (0 = Hidden window, False = Do not wait for it to exit)
WshShell.Run "node.exe """ & strPath & "backend\server.js""", 0, False

' Sleep for 2 seconds to let the Express server start up
WScript.Sleep 2000

' Launch Chrome in App Mode (1 = Normal window, False = Do not wait for it to exit)
WshShell.Run "chrome.exe --app=http://localhost:4000 --window-size=440,730", 1, False
