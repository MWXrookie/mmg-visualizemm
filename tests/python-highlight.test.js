import test from 'node:test'
import assert from 'node:assert/strict'
import { highlightPython } from '../web/src/lib/pythonHighlight.js'

test('VS Code themes distinguish builtin calls, punctuation and unfinished strings', () => {
  const html = highlightPython('print("hello)')
  assert.match(html, /--token-light:#795E26;--token-dark:#DCDCAA">print<\/span>/)
  assert.match(html, /--token-light:#000000;--token-dark:#D4D4D4">\(<\/span>/)
  assert.match(html, /--token-light:#A31515;--token-dark:#CE9178">&quot;hello\)<\/span>/)
})

test('triple-quoted strings carry grammar state across lines, then resume code', () => {
  const html = highlightPython('note = """first\nif print # text\n"""\nprint(1)')
  assert.match(html, /--token-dark:#CE9178">if print # text<\/span>/)
  assert.match(html, /--token-dark:#DCDCAA">print<\/span>/)
})

test('string hash is not a comment; actual comment uses each VS Code theme', () => {
  const html = highlightPython('label = "# value" # actual comment')
  assert.match(html, /--token-dark:#CE9178">[^<]*# value/)
  assert.match(html, /--token-light:#008000;--token-dark:#6A9955"># actual comment<\/span>/)
})

test('highlighting escapes HTML without changing source content', () => {
  const html = highlightPython('print("<img src=x onerror=alert(1)>&")')
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&amp;/)
})
