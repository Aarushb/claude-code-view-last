# view-last

A [Claude Code](https://code.claude.com) mod that opens Claude's last response in a separate editor window with one command, so you can read, scroll and search it at your own pace and then close it.

Long replies are awkward to read in the terminal, especially with a screen reader or object navigation. `Ctrl+G` already opens your editor, but it is an edit-and-send flow for your prompt. `/view` is read-only by intent: it writes the reply to a temp file, opens it, and gets out of the way. Closing the window sends nothing back to Claude.

## Usage

| Command | What it does |
| --- | --- |
| `/view` | Open Claude's latest reply |
| `/view 2` | Open the second-latest reply (`/view N` for the Nth) |

- Replies that only called tools (no text) are skipped.
- It works while Claude is still working on a turn.
- A short tip appears first, saying what is opening and that you can simply close it.
- The reply is written to `claude-last-response.txt` in your temp folder (`%TEMP%` on Windows, `$TMPDIR` or `/tmp` elsewhere). It is overwritten on each use.

## Editor

By default `/view` opens Notepad on Windows, the default text editor on macOS (`open -t`), and your default app on Linux (`xdg-open`). To use something else, set the **Editor** option for the plugin in `/plugin` (or `/config`), for example `code` or `subl`.

Pick a program that opens its own window. A terminal editor such as `vim` has no terminal to run in.
