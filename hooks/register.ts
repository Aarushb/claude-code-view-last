import type { Register } from 'claude-code'

const FILE_NAME = 'claude-last-response.txt'

type Platform = 'windows' | 'mac' | 'linux'

// What the person is told is opening, per platform.
const DEFAULT_NAME: Record<Platform, string> = {
  windows: 'Notepad',
  mac: 'your text editor',
  linux: 'your default app',
}

// No shell: the argument list is run as is. On Windows `start` returns at
// once, so the editor window outlives the call.
function launchArgv(platform: Platform, editor: string, path: string): string[] {
  if (platform === 'windows') return ['cmd', '/c', 'start', '', editor || 'notepad', path]
  if (platform === 'mac') return editor ? ['open', '-a', editor, path] : ['open', '-t', path]
  return [editor || 'xdg-open', path]
}

// Which replies to open, counted from the bottom: 1 is the latest.
// "" is the default count, "N" is one reply, "A-B" is a range (either way round).
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

export const register: Register = (on, options) => {
  // The `editor` userConfig option; empty means the platform default.
  const editor = typeof options?.editor === 'string' ? options.editor.trim() : ''
  // The `count` option: replies opened when no number is given.
  const count = Math.max(1, Math.floor(Number(options?.count)) || 1)
  // The `order` option: oldest-first keeps the latest reply at the bottom.
  const newestFirst = options?.order === 'newest-first'

  on('session.start', async ($, e, next) => {
    // Register last: a taken name throws and would skip the rest of this hook.
    await $.command.register({
      name: 'view',
      description: "Open Claude's last response in a separate window",
      argumentHint: '[N | A-B]',
      immediate: true,
    })
    return next(e)
  })

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

    const isWindows = (await $.env.get('OS')) === 'Windows_NT'
    let platform: Platform = 'windows'
    if (!isWindows) {
      const uname = await $.process.run(['uname', '-s'])
      platform = uname.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
    }

    const dir = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    const sep = dir.includes('\\') ? '\\' : '/'
    const path = `${dir.replace(/[\\/]+$/, '')}${sep}${FILE_NAME}`
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
