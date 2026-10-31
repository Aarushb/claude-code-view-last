import { expect, test } from 'claude-code/testing'

type Message = { role: 'user' | 'assistant'; text: string; toolUses: never[] }

const msg = (role: Message['role'], text: string): Message => ({ role, text, toolUses: [] })

const CHAT = [msg('user', 'hi'), msg('assistant', 'first'), msg('user', 'again'), msg('assistant', 'second')]

const WINDOWS: Record<string, string> = { OS: 'Windows_NT', TEMP: 'C:\\Temp' }
const POSIX: Record<string, string> = { TMPDIR: '/var/tmp/' }

// Stubs every call /view makes, recording the files written and commands run.
function stubEngine(
  on: (event: string, hook: (...args: any[]) => unknown) => unknown,
  env: Record<string, string>,
  { uname = 'Linux', messages = CHAT }: { uname?: string; messages?: Message[] } = {},
) {
  const written: { path: string; text: string }[] = []
  const launched: string[][] = []
  const toasts: string[] = []
  on('session.messages', () => ({ value: messages }))
  on('env.get', (_: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    written.push({ path: e.path, text: e.text })
    return { value: {} }
  })
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const argv = [...e.argv]
    if (argv[0] === 'uname') return { value: { exitCode: 0, stdout: uname + '\n', stderr: '' } }
    launched.push(argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: {} }
  })
  return { written, launched, toasts }
}

test('/view writes the last reply to a temp file and opens it in notepad', async ($, on) => {
  on('command.register', () => ({ value: { command: 'view' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const { written, launched } = stubEngine(on, WINDOWS)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'view', args: '' })

  expect(written).toHaveLength(1)
  expect(written[0].text).toBe('second')
  expect(written[0].path).toMatch(/^C:\\Temp[\\/]claude-last-response\.txt$/)
  // notepad is handed exactly the file that was written
  expect(launched).toEqual([['cmd', '/c', 'start', '', 'notepad', written[0].path]])
  expect(out.text ?? '').toBe('')
})

test('/view tells the person what is opening and how to get back', async ($, on) => {
  const { toasts } = stubEngine(on, WINDOWS)

  await $.command.run({ command: 'view', args: '' })

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/last response/i)
  expect(toasts[0]).toMatch(/close it/i)
})

test('/view 2 opens the second-latest reply', async ($, on) => {
  const { written } = stubEngine(on, WINDOWS)

  await $.command.run({ command: 'view', args: '2' })

  expect(written.map(w => w.text)).toEqual(['first'])
})

test('/view skips turns that only called tools', async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, {
    messages: [msg('assistant', 'answer'), msg('assistant', '')],
  })

  await $.command.run({ command: 'view', args: '' })

  expect(written.map(w => w.text)).toEqual(['answer'])
})

test('/view with no reply says so and opens nothing', async ($, on) => {
  const { launched } = stubEngine(on, WINDOWS, { messages: [msg('user', 'hi')] })

  const out = await $.command.run({ command: 'view', args: '' })

  expect(out.text).toMatch(/no response/)
  expect(launched).toEqual([])
})

test('/view on macOS opens the file in the default text editor', async ($, on) => {
  const { launched } = stubEngine(on, POSIX, { uname: 'Darwin' })

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['open', '-t', '/var/tmp/claude-last-response.txt']])
})

test('/view on Linux opens the file with xdg-open', async ($, on) => {
  const { launched } = stubEngine(on, POSIX, { uname: 'Linux' })

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['xdg-open', '/var/tmp/claude-last-response.txt']])
})

test('the editor option replaces Notepad on Windows', { options: { editor: 'code' } }, async ($, on) => {
  const { written, launched, toasts } = stubEngine(on, WINDOWS)

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['cmd', '/c', 'start', '', 'code', written[0].path]])
  expect(toasts[0]).toMatch(/in code\./)
})

test('the editor option is passed to open -a on macOS', { options: { editor: 'Sublime Text' } }, async ($, on) => {
  const { launched } = stubEngine(on, POSIX, { uname: 'Darwin' })

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['open', '-a', 'Sublime Text', '/var/tmp/claude-last-response.txt']])
})

test('the editor option replaces xdg-open on Linux', { options: { editor: 'gedit' } }, async ($, on) => {
  const { launched } = stubEngine(on, POSIX, { uname: 'Linux' })

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['gedit', '/var/tmp/claude-last-response.txt']])
})

const THREE = [
  msg('assistant', 'one'),
  msg('user', 'q'),
  msg('assistant', 'two'),
  msg('user', 'q'),
  msg('assistant', 'three'),
]

test('/view 1-2 opens a range, oldest first, each reply labelled', async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { messages: THREE })

  await $.command.run({ command: 'view', args: '1-2' })

  expect(written[0].text).toBe('===== Reply 2 =====\n\ntwo\n\n===== Reply 1 =====\n\nthree')
})

test('/view 3-2 is the same range as 2-3', async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { messages: THREE })

  await $.command.run({ command: 'view', args: '3-2' })

  expect(written[0].text).toBe('===== Reply 3 =====\n\none\n\n===== Reply 2 =====\n\ntwo')
})

test('a range past the oldest reply is cut to what exists', async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { messages: THREE })

  await $.command.run({ command: 'view', args: '2-9' })

  expect(written[0].text).toBe('===== Reply 3 =====\n\none\n\n===== Reply 2 =====\n\ntwo')
})

test('a range that starts past the oldest reply opens nothing', async ($, on) => {
  const { launched } = stubEngine(on, WINDOWS, { messages: THREE })

  const out = await $.command.run({ command: 'view', args: '7-9' })

  expect(out.text).toMatch(/no response/)
  expect(launched).toEqual([])
})

test('the count option sets how many replies a bare /view opens', { options: { count: 2 } }, async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { messages: THREE })

  await $.command.run({ command: 'view', args: '' })

  expect(written[0].text).toBe('===== Reply 2 =====\n\ntwo\n\n===== Reply 1 =====\n\nthree')
})

test('a number given to /view overrides the count option', { options: { count: 3 } }, async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { messages: THREE })

  await $.command.run({ command: 'view', args: '2' })

  expect(written[0].text).toBe('two')
})

test('the order option puts the latest reply first', { options: { order: 'newest-first' } }, async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { messages: THREE })

  await $.command.run({ command: 'view', args: '1-2' })

  expect(written[0].text).toBe('===== Reply 1 =====\n\nthree\n\n===== Reply 2 =====\n\ntwo')
})
