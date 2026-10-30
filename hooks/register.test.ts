import { expect, test } from 'claude-code/testing'

const msg = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] })

test('/view writes the last reply to a temp file and opens it in notepad', async ($, on) => {
  const written: { path: string; text: string }[] = []
  const launched: string[][] = []
  on('command.register', () => ({ value: { command: 'view' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [msg('user', 'hi'), msg('assistant', 'first'), msg('user', 'again'), msg('assistant', 'second')],
  }))
  on('env.get', (_, e) => ({ value: e.name === 'TEMP' ? 'C:\\Temp' : undefined }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: {} }
  })
  on('process.run', (_, e) => {
    launched.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'view', args: '' })

  expect(written).toHaveLength(1)
  expect(written[0].text).toBe('second')
  expect(written[0].path).toMatch(/^C:\\Temp[\\/]claude-last-response\.txt$/)
  // notepad is handed exactly the file that was written
  expect(launched).toEqual([['cmd', '/c', 'start', '', 'notepad', written[0].path]])
  expect(out.text ?? '').toBe('')
})

test('/view 2 opens the second-latest reply and skips tool-only turns', async ($, on) => {
  const written: string[] = []
  on('session.messages', () => ({
    value: [msg('assistant', 'older'), msg('assistant', 'newer'), msg('assistant', '')],
  }))
  on('env.get', () => ({ value: 'C:\\Temp' }))
  on('fs.write', (_, e) => {
    written.push(e.text)
    return { value: {} }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))

  await $.command.run({ command: 'view', args: '2' })

  expect(written).toEqual(['older'])
})

test('/view with no reply says so and opens nothing', async ($, on) => {
  let launched = 0
  on('session.messages', () => ({ value: [msg('user', 'hi')] }))
  on('process.run', () => {
    launched += 1
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  const out = await $.command.run({ command: 'view', args: '' })

  expect(out.text).toMatch(/no response/)
  expect(launched).toBe(0)
})
