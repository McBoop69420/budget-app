# Prints the GDI (Win32) desktop monitor layout as "left,top,right,bottom" per line.
# This is the layout the OS actually paints to / the user sees, unlike Chromium's
# display enumeration which can report phantom monitor sizes (e.g. RDP sessions).
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  "{0},{1},{2},{3}" -f $_.Bounds.Left, $_.Bounds.Top, $_.Bounds.Right, $_.Bounds.Bottom
}
