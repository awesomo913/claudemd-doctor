# VHS tape for claudemd-doctor's README demo GIF.
# Install VHS: https://github.com/charmbracelet/vhs
# Render: vhs docs/demo.tape  (needs ttyd + ffmpeg on PATH)
#
# Run from the repository root. All setup (build + the `npx` function that
# redirects `npx claudemd-doctor` to the freshly-built local dist against
# the synthetic demo fixture — see docs/demo-setup.ps1) happens hidden, so
# the only command the viewer ever sees typed is exactly:
#
#     npx claudemd-doctor
#
# demo-setup.ps1 also throttles the CLI's own output to a readable
# per-line pace, so the recording reads as a scroll — summary box, then
# tree, then unreferenced rules, then the npm/pnpm conflict — ending held
# on the conflict, rather than one instant screen-dump.

Output docs/assets/demo.gif

Set Shell "powershell"
Set Theme "Dracula"
Set FontSize 19
Set Width 1200
Set Height 650
Set Padding 20
Set TypingSpeed 40ms

Hide
Type ". .\docs\demo-setup.ps1"
Enter
Sleep 2500ms
Show

Type "npx claudemd-doctor"
Sleep 400ms
Enter
Sleep 11500ms
