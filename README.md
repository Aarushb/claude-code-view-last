# view-last

A [Claude Code](https://code.claude.com) mod that opens Claude's last response in a separate editor window with one command, so you can read, scroll and search it at your own pace and then close it.

Long replies are awkward to read in the terminal, especially with a screen reader. Object navigation helps; but is not enough in my experience. `Ctrl+G` already opens your editor, but it is an edit-and-send flow for your prompt. `/view` is read-only by intent: it writes the reply to a temp file, opens it, and gets out of the way. Closing the window sends nothing back to Claude.

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

## Hotkeys

A plugin can't ship keybindings, so add your own. Run `/keybindings` (or edit `~/.claude/keybindings.json`) and bind a key to the `command:` action. For example, `Alt+G` for `/view` and `Alt+C` for the built-in `/copy`:

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "meta+g": "command:view",
        "meta+c": "command:copy"
      }
    }
  ]
}
```

`meta` is the Alt key on Windows and Linux and Option on macOS (which needs Option set as Meta in the terminal). The file reloads on its own.

I wanted to use `Ctrl+Shift+G`, it seemed intuitive given `Ctrl+G`. However, that only works in terminals that can tell it apart from `Ctrl+G` (those that implement the kitty keyboard protocol). The classic Windows console cannot. I personally use `Alt+G`.

## Install

Requires Claude Code v2.1.287 or later (mods are on by default from that version).

### From Claude Code

At the prompt of a terminal session:

```
/plugin install view-last --marketplace Aarushb/claude-code-view-last
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). From a shell instead:

```
claude plugin install view-last --marketplace Aarushb/claude-code-view-last
```

### Manually

Clone the repository, then use either route.

```
git clone https://github.com/Aarushb/claude-code-view-last.git
```

**For one session**, point Claude Code at the folder:

```
claude --plugin-dir ./claude-code-view-last
```

**Permanently**, add the clone as a local marketplace and install from it:

```
claude plugin marketplace add ./claude-code-view-last
claude plugin install view-last@aarushb-mods
```

Editing the clone and running `/reload-plugins` picks up changes with no reinstall.

To check it loaded, run `/plugin`; a dim line under the tabs reads `1 mod active · view-last`. Then type `/view`.

## Update and uninstall

```
claude plugin update view-last
claude plugin uninstall view-last
```

## Development

```
claude plugin validate .      # what the mod hooks and calls
claude plugin test .          # unit tests, no session and no model calls
claude --plugin-dir .         # load it live; saving a file reloads it
```

The tests stub every engine call, so they run without a Claude session and cost nothing. The code is one hooks module, `hooks/register.ts`.

## License

[MIT](LICENSE)
