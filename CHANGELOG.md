# Changelog

## 0.3.1

- The file is no longer deleted when you send a message or when the session ends, so an editor that has it open does not report a missing file. Running `/view` again overwrites the same file.
- Files older than a day are still swept when a new session starts.

## 0.3.0

- Each session writes its own temp file, so two sessions no longer overwrite each other.
- The file is deleted when you send a message and when the session ends.
- A new session deletes leftover files from earlier sessions that are more than a day old.

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
