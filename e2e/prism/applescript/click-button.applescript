-- Click a button by name anywhere in Prism.
-- Dialogs/sheets: full subtree search (small). Standard windows: direct
-- buttons only — NEVER entire-contents on a doc window (data grid = thousands
-- of cells, hangs). Usage: osascript click-button.applescript "Open"
on run argv
	set btnName to item 1 of argv
	tell application "System Events"
		tell process "Prism"
			repeat with i from 1 to (count of windows)
				set w to window i
				try
					set wr to subrole of w as string
				on error
					set wr to ""
				end try
				if wr is "AXDialog" or wr is "AXFloatingWindow" then
					try
						set els to entire contents of w
						repeat with el in els
							try
								if (class of el as string) is "button" then
									if (name of el as string) is btnName then
										click el
										return "CLICKED win" & i & ":" & btnName
									end if
								end if
							end try
						end repeat
					end try
				else
					try
						repeat with b in (every button of w)
							try
								if (name of b as string) is btnName then
									click b
									return "CLICKED win" & i & ":" & btnName
								end if
							end try
						end repeat
					end try
				end if
				try
					repeat with s in (every sheet of w)
						set els2 to entire contents of s
						repeat with el in els2
							try
								if (class of el as string) is "button" then
									if (name of el as string) is btnName then
										click el
										return "CLICKED win" & i & " sheet:" & btnName
									end if
								end if
							end try
						end repeat
					end repeat
				end try
			end repeat
			return "NOT-FOUND:" & btnName
		end tell
	end tell
end run
