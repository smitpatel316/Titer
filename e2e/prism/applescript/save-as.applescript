-- Save As the front Prism document under a new filename (same folder as the
-- open document — the save panel defaults there). Uses menu click + keystrokes:
-- the save panel's filename field takes keyboard focus, so typing the name
-- then Return saves. If a "replace existing file?" sheet appears, clicks
-- "Replace". Prints SAVE-AS-OK <path> or SAVE-AS-FAIL <reason>.
-- Argv: 1 = new filename (basename only, e.g. "t137-prism-resaved.prism").
-- NOTE: Cmd+Shift+G (Go to Folder) is deliberately NOT used here.
on run argv
	set newName to item 1 of argv
	tell application "System Events"
		tell process "Prism"
			-- File > Save As…
			click menu item "Save As…" of menu "File" of menu bar 1
			delay 2
			-- The save sheet's filename field has keyboard focus.
			keystroke newName
			delay 1
			keystroke return
			delay 3
			-- Replace-confirmation sheet, if the file already exists.
			repeat 3 times
				try
					set btns to name of every button of sheet 1 of window 1
					if btns contains "Replace" then
						click button "Replace" of sheet 1 of window 1
						delay 2
						exit repeat
					end if
				end try
				delay 1
			end repeat
			set wn to name of window 1 as string
		end tell
	end tell
	if wn contains "Save" then
		return "SAVE-AS-FAIL save sheet still open for " & newName
	end if
	return "SAVE-AS-OK " & newName & " (front window now: " & wn & ")"
end run
