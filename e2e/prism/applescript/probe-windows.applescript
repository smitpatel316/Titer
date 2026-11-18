-- Enumerate every Prism window: name, sheets, buttons. Read-only.
on run
	set out to {}
	tell application "System Events"
		set fp to name of first process whose frontmost is true
		set out to out & {"FRONTMOST: " & fp}
		tell process "Prism"
			set n to count of windows
			set out to out & {"WINDOW COUNT: " & n}
			repeat with i from 1 to n
				set w to window i
				try
					set wn to name of w as string
				on error
					set wn to "(no name)"
				end try
				try
					set wr to subrole of w as string
				on error
					set wr to "(no subrole)"
				end try
				set out to out & {"WIN " & i & ": name=[" & wn & "] subrole=[" & wr & "]"}
				try
					set sh to every sheet of w
					set out to out & {"  sheets: " & (count of sh)}
					repeat with s in sh
						try
							set sn to name of s as string
						on error
							set sn to "(no name)"
						end try
						set out to out & {"  SHEET: [" & sn & "]"}
						try
							repeat with b in (every button of s)
								try
									set out to out & {"    BTN: " & (name of b as string)}
								end try
							end repeat
						end try
						try
							repeat with t in (every static text of s)
								set v to value of t
								if v is not missing value and v is not "" then set out to out & {"    TXT: " & v}
							end repeat
						end try
					end repeat
				end try
				try
					set bs to every button of w
					if (count of bs) > 0 and (count of bs) < 20 then
						repeat with b in bs
							try
								set out to out & {"  BTN: " & (name of b as string)}
							end try
						end repeat
					else
						set out to out & {"  buttons: " & (count of bs)}
					end if
				end try
			end repeat
		end tell
	end tell
	return out as string
end run
