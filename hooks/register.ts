import type { Register } from 'claude-code'

const EDITOR = 'notepad'
const FILE_NAME = 'claude-last-response.txt'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Register last: a taken name throws and would skip the rest of this hook.
    await $.command.register({
      name: 'view',
      description: "Open Claude's last response in Notepad",
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

    const dir = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    const sep = dir.includes('\\') ? '\\' : '/'
    const path = `${dir.replace(/[\\/]+$/, '')}${sep}${FILE_NAME}`
    await $.fs.write(path, reply.text)

    $.ui.toast(`Opening Claude's last response in ${EDITOR}. Close ${EDITOR} when you're done.`, {
      timeoutMs: 6000,
    })

    // `start` returns at once, so the editor outlives this call.
    const ran = await $.process.run(['cmd', '/c', 'start', '', EDITOR, path])
    if (ran.exitCode !== 0) {
      return { text: `view-last: could not start ${EDITOR} (${ran.stderr.trim()}). Saved to ${path}` }
    }
    return {}
  })
}
