# Hidden setup for docs/demo.tape. Builds the CLI, then defines an `npx`
# function that intercepts `npx claudemd-doctor` specifically and runs the
# freshly-built local dist against the synthetic demo fixture (--home
# demo/home --cwd "D:\demo-project") -- never anything from the machine
# recording it. Any other `npx` call still goes to the real npx.cmd.
#
# Output is paced section-by-section (a short pause after each numbered
# heading) rather than line-by-line: a per-line throttle was tried first
# and made the Windows console repaint its whole buffer on nearly every
# frame, ballooning the GIF to ~15MB for 8 seconds. Pausing only at the 5
# section boundaries keeps the same readable "scroll through tree, then
# unreferenced rules, then the conflict" pacing with far fewer distinct
# frames to encode.

# PowerShell's console defaults to the system codepage, not UTF-8 — the
# report's box-drawing characters (┌─┘) and "≈"/"·" glyphs come out as
# mojibake without this.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

npm run build *> $null

function npx {
    $rest = $args
    if ($rest.Length -gt 0 -and $rest[0] -eq "claudemd-doctor") {
        $extra = if ($rest.Length -gt 1) { $rest[1..($rest.Length - 1)] } else { @() }
        # 2>$null: suppress the stderr "scanning N/M sessions..." progress
        # line — real and correct in an interactive TTY, but just noise in
        # a ~9-second demo recording of a scan that finishes instantly.
        & node "$PWD\dist\cli.js" --home "$PWD\demo\home" --cwd "D:\demo-project" @extra 2>$null | ForEach-Object {
            $_
            if ($_ -match "Instruction tree|2\. Cost|Measured reality|Unreferenced rules|Conflicts & duplicates") {
                Start-Sleep -Milliseconds 650
            }
        }
    } else {
        & npx.cmd @rest
    }
}

Clear-Host
