-- Fast doc-state dump for Prism's front document window. Walks the AX tree but
-- never descends into data grids (AXTable/AXGrid). Collects window title,
-- navigator rows, static texts and buttons. No clicks.
-- NOTE: the walk handler carries its own `tell application "System Events"`
-- because handlers do not inherit the caller's tell context (class names like
-- `static text` fail to compile otherwise).
global gOut, gCount

on walk(el, depth)
	tell application "System Events"
		if gCount > 150 or depth > 8 then return
		try
			set r to role of el as string
		on error
			return
		end try
		if r is "AXTable" or r is "AXGrid" then return
		if r is "AXStaticText" then
			try
				set v to value of el
				if v is not missing value and v is not "" then
					set end of gOut to "TXT: " & v
					set gCount to gCount + 1
				end if
			end try
			return
		end if
		if r is "AXButton" then
			try
				set nm to name of el as string
				if nm is not missing value and nm is not "" then
					set end of gOut to "BTN: " & nm
					set gCount to gCount + 1
				end if
			end try
			return
		end if
		if r is "AXRow" then
			try
				repeat with t in (every static text of el)
					set v to value of t
					if v is not missing value and v is not "" then
						set end of gOut to "ROW: " & v
						set gCount to gCount + 1
					end if
				end repeat
			end try
			return
		end if
		try
			set kids to UI elements of el
			repeat with k in kids
				my walk(k, depth + 1)
				if gCount > 150 then return
			end repeat
		end try
	end tell
end walk

on run
	set gOut to {}
	set gCount to 0
	with timeout of 25 seconds
		tell application "System Events"
			tell process "Prism"
				set n to count of windows
				set out to {"WINDOWS: " & n}
				repeat with i from 1 to n
					try
						set wn to name of window i as string
					on error
						set wn to "(no name)"
					end try
					set out to out & {"WIN " & i & ": [" & wn & "]"}
				end repeat
				set gOut to out
				repeat with i from 1 to n
					try
						set wn to name of window i as string
						set wr to subrole of window i as string
					on error
						set wn to ""
						set wr to ""
					end try
					if wr is "AXStandardWindow" and wn does not start with "Welcome" then
						set gOut to gOut & {"--- DOC WINDOW " & i & ": [" & wn & "] ---"}
						my walk(window i, 0)
						exit repeat
					end if
				end repeat
			end tell
		end tell
	end timeout
	return gOut as string
end run
