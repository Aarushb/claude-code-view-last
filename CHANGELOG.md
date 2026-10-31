# Changelog

## 0.2.0

- `/view A-B` opens a range of replies in one window, each labelled `===== Reply N =====`.
- `Default count` option: how many replies `/view` opens when no number is given (default 1).
- `Order` option: `oldest-first` (default, latest at the bottom) or `newest-first`.

## 0.1.0

- `/view` opens Claude's last response in a separate editor window; `/view N` opens the Nth-latest.
- Works on Windows (Notepad), macOS (`open -t`) and Linux (`xdg-open`).
- `Editor` option to choose the program.
- Tip toast before the window opens.
- Installable from GitHub as a Claude Code marketplace.
