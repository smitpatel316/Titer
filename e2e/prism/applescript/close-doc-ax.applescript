-- Close Prism's front document window via its AX close button (no keystrokes:
-- they go to the frontmost app, which may not be Prism). If a save sheet
-- appears, click "Don't Save". Prints window state before/after.
on run
	set out to {}
	tell application "System Events"
		tell process "Prism"
			set n to count of windows
			set docIdx to 0
			repeat with i from 1 to n
				try
					set wn to name of window i as string
					set wr to subrole of window i as string
				on error
					set wn to ""
					set wr to ""
				end try
				if wr is "AXStandardWindow" and wn does not start with "Welcome" then
					set docIdx to i
					exit repeat
				end if
			end repeat
			if docIdx is 0 then
				return "ALREADY-CLEAN no-doc-window"
			end if
			set out to out & {"CLOSING-WIN " & docIdx & ": [" & (name of window docIdx as string) & "]"}
			-- click the close button (AXCloseButton subrole)
			try
				set cb to first button of window docIdx whose subrole is "AXCloseButton"
				click cb
				set out to out & {"CLICKED close button"}
			on error errMsg
				set out to out & {"CLOSE-BTN-ERROR: " & errMsg}
				return out as string
			end try
		end tell
	end tell
	delay 3
	tell application "System Events"
		tell process "Prism"
			-- save sheet?
			try
				repeat with i from 1 to (count of windows)
					try
						repeat with s in (every sheet of window i)
							repeat with b in (every button of s)
								try
									set nm to name of b as string
									if nm is "Don't Save" or nm is "Don’t Save" then
										click b
										set out to out & {"CLICKED: Don't Save"}
									end if
								end try
							end repeat
						end repeat
					end try
				end repeat
			end try
			delay 1
			set names2 to {}
			repeat with i from 1 to (count of windows)
				try
					set end of names2 to (name of window i as string)
				end try
			end repeat
			set out to out & {"WINDOWS-AFTER: " & (names2 as string)}
		end tell
	end tell
	return out as string
end run
