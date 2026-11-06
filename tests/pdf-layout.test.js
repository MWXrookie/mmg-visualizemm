import test from 'node:test'
import assert from 'node:assert/strict'
import { pdfLayoutText } from '../server/pdf-layout.js'
import { PDFParse } from 'pdf-parse'
import { pdfTableFixture } from './support/document-pdf.js'
import { analyzeProblemText } from '../web/src/lib/problemText.js'

test('真实PDF字节解析后保留三列三行和零值', async () => {
  const parser = new PDFParse({ data: pdfTableFixture() })
  try {
    const doc = await parser.load()
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const text = pdfLayoutText(content.items)
    const view = analyzeProblemText(text, 'pdf', [{ num: 1, text }])
    assert.deepEqual(view.sections[0].items.find((i) => i.type === 'table').rows, [
      ['Region', 'Sales', 'Cost'], ['East', '12', '4'], ['West', '0', '8'],
    ])
  } finally { await parser.destroy() }
})

test('PDF synthetic gap spaces do not collapse columns; ordinary word gaps remain spaces', () => {
  const item = (str, x, y, width, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, x, y], height: 12, width, hasEOL })
  assert.equal(pdfLayoutText([
    item('Region', 50, 700, 40), item(' ', 90, 700, 90), item('Sales', 180, 700, 30, true),
    item('West', 50, 675, 30), item(' ', 80, 675, 100), item('0', 180, 675, 8, true),
    item('ordinary', 50, 650, 50), item('words', 103, 650, 30, true),
  ]), 'Region\tSales\nWest\t0\nordinary words')
})
