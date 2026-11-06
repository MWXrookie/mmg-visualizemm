import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import python from '@shikijs/langs/python'
import darkPlus from '@shikijs/themes/dark-plus'
import lightPlus from '@shikijs/themes/light-plus'

// Only Python and the two VS Code themes are bundled; no network requests.
const highlighter = createHighlighterCoreSync({
  langs: [python], themes: [darkPlus, lightPlus], engine: createJavaScriptRegexEngine(),
})
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function highlightPython(code) {
  const tokens = highlighter.codeToTokensWithThemes(code, {
    lang: 'python', themes: { light: 'light-plus', dark: 'dark-plus' },
  })
  return tokens.map(line => line.map(token => {
    const light = token.variants.light
    const dark = token.variants.dark
    return `<span style="--token-light:${light.color};--token-dark:${dark.color}">${escapeHtml(token.content)}</span>`
  }).join('')).join('\n')
}
