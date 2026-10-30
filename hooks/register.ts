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

export const register: Register = (on, options) => {
  // The `editor` userConfig option; empty means the platform default.
  const editor = typeof options?.editor === 'string' ? options.editor.trim() : ''

  on('session.start', async ($, e, next) => {
    // Register last: a taken name throws and would skip the rest of this hook.
    await $.command.register({
      name: 'view',
      description: "Open Claude's last response in a separate window",
      argumentHint: '[N]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'view' }, async ($, e) => {
    // /view N opens the Nth-latest response, as /copy N does.
    const n = Math.max(1, Number.parseInt(e.args, 10) || 1)

    const messages = await $.session.messages()
    const replies = messages.filter(m => m.role === 'assistant' && m.text.trim() !== '')
    const reply = replies.at(-n)
    if (reply === undefined) return { text: 'view-last: no response to open yet.' }

    const isWindows = (await $.env.get('OS')) === 'Windows_NT'
    let platform: Platform = 'windows'
    if (!isWindows) {
      const uname = await $.process.run(['uname', '-s'])
      platform = uname.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
    }

    const dir = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    const sep = dir.includes('\\') ? '\\' : '/'
    const path = `${dir.replace(/[\\/]+$/, '')}${sep}${FILE_NAME}`
    await $.fs.write(path, reply.text)

    const name = editor || DEFAULT_NAME[platform]
    $.ui.toast(`Opening Claude's last response in ${name}. Close it when you're done.`, {
      timeoutMs: 6000,
    })

    const ran = await $.process.run(launchArgv(platform, editor, path))
    if (ran.exitCode !== 0) {
      return { text: `view-last: could not open ${name} (${ran.stderr.trim()}). Saved to ${path}` }
    }
    return {}
  })
}
