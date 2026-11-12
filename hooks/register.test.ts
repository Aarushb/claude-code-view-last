// Tests for /view. Every engine call is stubbed, so nothing opens a real window.
import { expect, test } from 'claude-code/testing'

type Message = { role: 'user' | 'assistant'; text: string; toolUses: never[] }

// Builds a session message with no tool calls.
const msg = (role: Message['role'], text: string): Message => ({ role, text, toolUses: [] })

// A short chat with two replies, "first" then "second".
const CHAT = [msg('user', 'hi'), msg('assistant', 'first'), msg('user', 'again'), msg('assistant', 'second')]

const WINDOWS: Record<string, string> = { OS: 'Windows_NT', TEMP: 'C:\\Temp' }
const POSIX: Record<string, string> = { TMPDIR: '/var/tmp/' }

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

// Builds a temp folder entry whose last change was the given number of days ago.
const entry = (name: string, daysOld: number, kind: Entry['kind'] = 'file'): Entry => ({
  name,
  kind,
  size: 1,
  mtimeMs: Date.now() - daysOld * 24 * 60 * 60 * 1000,
  isLink: false,
})

// True when the command is a file delete, not an editor launch.
const isDelete = (argv: string[]) => argv[0] === 'rm' || (argv[0] === 'cmd' && argv[2] === 'del')

// Stubs every call /view makes, recording the files written, the editor
// launched and the files deleted. `existing` lists files already on disk and
// `files` is what the temp folder listing returns.
function stubEngine(
  on: (event: string, hook: (...args: any[]) => unknown) => unknown,
  env: Record<string, string>,
  {
    uname = 'Linux',
    messages = CHAT,
    id = 'abc',
    existing = [],
    files = [],
  }: { uname?: string; messages?: Message[]; id?: string; existing?: string[]; files?: Entry[] } = {},
) {
  const written: { path: string; text: string }[] = []
  const launched: string[][] = []
  const removed: string[][] = []
  const toasts: string[] = []
  // The engine resolves paths against the host, so a POSIX path can arrive with
  // a drive letter and backslashes. Compare paths without those differences.
  const key = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  const onDisk = new Set(existing.map(key))
  on('session.messages', () => ({ value: messages }))
  on('session.id', () => ({ value: id }))
  on('env.get', (_: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    written.push({ path: e.path, text: e.text })
    onDisk.add(key(e.path))
    return { value: {} }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: onDisk.has(key(e.path)) }))
  on('fs.list', () => ({ value: files }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const argv = [...e.argv]
    if (argv[0] === 'uname') return { value: { exitCode: 0, stdout: uname + '\n', stderr: '' } }
    if (isDelete(argv)) removed.push(argv)
    else launched.push(argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: {} }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  return { written, launched, removed, toasts }
}

test('/view writes the last reply to a temp file and opens it in notepad', async ($, on) => {
  on('command.register', () => ({ value: { command: 'view' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const { written, launched } = stubEngine(on, WINDOWS)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'view', args: '' })

  expect(written).toHaveLength(1)
  expect(written[0].text).toBe('second')
  expect(written[0].path).toMatch(/^C:\\Temp[\\/]claude-response-abc\.txt$/)
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

  expect(launched).toEqual([['open', '-t', '/var/tmp/claude-response-abc.txt']])
})

test('/view on Linux opens the file with xdg-open', async ($, on) => {
  const { launched } = stubEngine(on, POSIX, { uname: 'Linux' })

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['xdg-open', '/var/tmp/claude-response-abc.txt']])
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

  expect(launched).toEqual([['open', '-a', 'Sublime Text', '/var/tmp/claude-response-abc.txt']])
})

test('the editor option replaces xdg-open on Linux', { options: { editor: 'gedit' } }, async ($, on) => {
  const { launched } = stubEngine(on, POSIX, { uname: 'Linux' })

  await $.command.run({ command: 'view', args: '' })

  expect(launched).toEqual([['gedit', '/var/tmp/claude-response-abc.txt']])
})

// A chat with three replies, "one" oldest to "three" latest, for the range tests.
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

const OWN = 'C:\\Temp\\claude-response-abc.txt'

test('sending a message deletes this session file', async ($, on) => {
  const { removed } = stubEngine(on, WINDOWS, { existing: [OWN] })

  await $.prompt.submit({ text: 'hello' })

  expect(removed).toEqual([['cmd', '/c', 'del', '/q', OWN]])
})

test('sending a message with no file on disk deletes nothing', async ($, on) => {
  const { removed } = stubEngine(on, WINDOWS)

  await $.prompt.submit({ text: 'hello' })

  expect(removed).toEqual([])
})

test('/view then sending a message leaves nothing behind', async ($, on) => {
  const { written, removed } = stubEngine(on, WINDOWS)

  await $.command.run({ command: 'view', args: '' })
  await $.prompt.submit({ text: 'thanks' })

  expect(removed).toEqual([['cmd', '/c', 'del', '/q', written[0].path]])
})

test('ending the session deletes the file of the session that ended', async ($, on) => {
  const { removed } = stubEngine(on, WINDOWS, { id: 'new' })

  await $.session.end({ reason: 'clear', sessionId: 'old' })

  expect(removed).toEqual([['cmd', '/c', 'del', '/q', 'C:\\Temp\\claude-response-old.txt']])
})

test('files are deleted with rm on macOS and Linux', async ($, on) => {
  const { removed } = stubEngine(on, POSIX, { existing: ['/var/tmp/claude-response-abc.txt'] })

  await $.prompt.submit({ text: 'hello' })

  expect(removed).toEqual([['rm', '-f', '/var/tmp/claude-response-abc.txt']])
})

test('an odd session id cannot change the folder the file lands in', async ($, on) => {
  const { written } = stubEngine(on, WINDOWS, { id: '../x y' })

  await $.command.run({ command: 'view', args: '' })

  expect(written[0].path).toBe('C:\\Temp\\claude-response-___x_y.txt')
})

test('a new session sweeps only our own files older than a day', async ($, on) => {
  on('command.register', () => ({ value: { command: 'view' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const { removed } = stubEngine(on, WINDOWS, {
    files: [
      entry('claude-response-old1.txt', 2),
      entry('claude-response-fresh.txt', 0.1),
      entry('claude-last-response.txt', 5),
      entry('notes.txt', 30),
      entry('claude-response-dir.txt', 9, 'dir'),
    ],
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(removed.map(argv => argv.at(-1))).toEqual([
    'C:\\Temp\\claude-response-old1.txt',
    'C:\\Temp\\claude-last-response.txt',
  ])
})
