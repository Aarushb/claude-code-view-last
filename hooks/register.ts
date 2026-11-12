import type { Register } from 'claude-code'

// Each session writes its own file, so two sessions never overwrite each other.
const FILE_PREFIX = 'claude-response-'
// The single shared file that versions before 0.3.0 wrote.
const LEGACY_NAME = 'claude-last-response.txt'
// A file this old is taken as abandoned and swept when a session starts.
const MAX_AGE_MS = 24 * 60 * 60 * 1000

type Platform = 'windows' | 'mac' | 'linux'

// The part of the engine interface the file helpers use.
type Host = {
  env: { get(name: string): Promise<string | undefined> }
  process: {
    run(argv: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
}

// What the person is told is opening, per platform.
const DEFAULT_NAME: Record<Platform, string> = {
  windows: 'Notepad',
  mac: 'your text editor',
  linux: 'your default app',
}

// Builds the command that opens the file in the editor, per platform.
// No shell: the argument list is run as is. On Windows `start` returns at
// once, so the editor window outlives the call.
function launchArgv(platform: Platform, editor: string, path: string): string[] {
  if (platform === 'windows') return ['cmd', '/c', 'start', '', editor || 'notepad', path]
  if (platform === 'mac') return editor ? ['open', '-a', editor, path] : ['open', '-t', path]
  return [editor || 'xdg-open', path]
}

// Works out which platform the session runs on.
async function platformOf($: Host): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  const uname = await $.process.run(['uname', '-s'])
  return uname.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
}

// Returns the temp folder, with no trailing separator.
async function tempDir($: Host): Promise<string> {
  const dir = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  return dir.replace(/[\\/]+$/, '')
}

// Joins a name onto a folder using the folder's own separator, so a Windows
// path never ends up with mixed slashes.
function joinPath(dir: string, name: string): string {
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`
}

// Returns the path of the file that holds one session's reply.
async function sessionFile($: Host, sessionId: string): Promise<string> {
  const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_')
  return joinPath(await tempDir($), `${FILE_PREFIX}${safeId}.txt`)
}

// Deletes a file, and never throws: a file that is already gone is the goal.
// There is no delete in the file API, so a command does it (no shell).
async function removeFile($: Host, path: string): Promise<void> {
  const argv =
    (await platformOf($)) === 'windows' ? ['cmd', '/c', 'del', '/q', path] : ['rm', '-f', path]
  try {
    await $.process.run(argv)
  } catch {
    // Nothing to do: the file will be swept on a later session start.
  }
}

// Turns the /view argument into the range of replies to open. Replies are
// counted from the bottom, so 1 is the latest. "" is the default count, "N" is
// one reply, "A-B" is a range (either way round).
function parseSelection(args: string, defaultCount: number): { from: number; to: number } {
  const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(args)
  if (range) {
    const a = Math.max(1, Number(range[1]))
    const b = Math.max(1, Number(range[2]))
    return { from: Math.min(a, b), to: Math.max(a, b) }
  }
  const n = Number.parseInt(args, 10)
  if (n >= 1) return { from: n, to: n }
  return { from: 1, to: defaultCount }
}

// The mod's entry point: adds the /view command and reads the plugin options.
export const register: Register = (on, options) => {
  // The `editor` userConfig option; empty means the platform default.
  const editor = typeof options?.editor === 'string' ? options.editor.trim() : ''
  // The `count` option: replies opened when no number is given.
  const count = Math.max(1, Math.floor(Number(options?.count)) || 1)
  // The `order` option: oldest-first keeps the latest reply at the bottom.
  const newestFirst = options?.order === 'newest-first'

  // Sweeps abandoned files and adds /view to the slash commands when a session starts.
  on('session.start', async ($, e, next) => {
    // Files from sessions that ended without a clean exit. The age limit keeps
    // this from touching a file another open session may still be showing.
    try {
      const dir = await tempDir($)
      for (const entry of await $.fs.list(dir)) {
        const isOurs =
          entry.name === LEGACY_NAME ||
          (entry.name.startsWith(FILE_PREFIX) && entry.name.endsWith('.txt'))
        if (isOurs && entry.kind === 'file' && Date.now() - entry.mtimeMs > MAX_AGE_MS) {
          await removeFile($, joinPath(dir, entry.name))
        }
      }
    } catch {
      // A sweep that fails must not stop the command from registering.
    }
    // Register last: a taken name throws and would skip the rest of this hook.
    await $.command.register({
      name: 'view',
      description: "Open Claude's last response in a separate window",
      argumentHint: '[N | A-B]',
      immediate: true,
    })
    return next(e)
  })

  // Deletes this session's file when a message is sent. An editor window that
  // is still open keeps its text, and /view writes the file again.
  on('prompt.submit', async ($, e, next) => {
    const path = await sessionFile($, await $.session.id())
    if (await $.fs.exists(path)) await removeFile($, path)
    return next(e)
  })

  // Deletes the ending session's file. The id comes from the event: after a
  // /clear the process goes on under a new id.
  on('session.end', async ($, e, next) => {
    await removeFile($, await sessionFile($, e.sessionId))
    return next(e)
  })

  // Runs /view: writes the chosen replies to a temp file and opens it in the editor.
  on('command.run', { command: 'view' }, async ($, e) => {
    // /view N opens the Nth-latest response, as /copy N does; /view A-B a range.
    const { from, to } = parseSelection(e.args, count)

    const messages = await $.session.messages()
    const replies = messages.filter(m => m.role === 'assistant' && m.text.trim() !== '')
    if (from > replies.length) return { text: 'view-last: no response to open yet.' }

    // Numbered from the bottom, so a number here is the one to give /view.
    const picked: { number: number; text: string }[] = []
    for (let number = Math.min(to, replies.length); number >= from; number--) {
      picked.push({ number, text: replies.at(-number)!.text })
    }
    if (newestFirst) picked.reverse()
    const body =
      picked.length === 1
        ? picked[0].text
        : picked.map(r => `===== Reply ${r.number} =====\n\n${r.text}`).join('\n\n')

    const platform = await platformOf($)
    const path = await sessionFile($, await $.session.id())
    await $.fs.write(path, body)

    const name = editor || DEFAULT_NAME[platform]
    const what =
      picked.length === 1 ? 'last response' : `${from === 1 ? 'last ' : ''}${picked.length} responses`
    $.ui.toast(`Opening Claude's ${what} in ${name}. Close it when you're done.`, {
      timeoutMs: 6000,
    })

    const ran = await $.process.run(launchArgv(platform, editor, path))
    if (ran.exitCode !== 0) {
      return { text: `view-last: could not open ${name} (${ran.stderr.trim()}). Saved to ${path}` }
    }
    return {}
  })
}
