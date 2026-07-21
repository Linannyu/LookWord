'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const wordListDirectory = path.join(projectRoot, 'word_list');
const sourceFiles = [
  '机考SAT真题词汇2000_Day1-10.json',
  '机考SAT真题词汇2000_Day11-20.json',
  '机考SAT真题词汇2000_Day21-26.json'
];
const outputFilename = '机考SAT真题词汇1900_Day1-24.json';
const sourcePdf = '机考SAT真题词汇1900（day1-24).pdf';
const finalIndex = 1890;

const words = sourceFiles
  .flatMap(filename => {
    const sourcePath = path.join(wordListDirectory, filename);
    return JSON.parse(fs.readFileSync(sourcePath, 'utf8')).words || [];
  })
  .filter(entry => Number(entry.index) <= finalIndex)
  .sort((a, b) => Number(a.index) - Number(b.index))
  .map(entry => ({...entry, source: {pdf: sourcePdf}}));

if (words.length !== finalIndex) {
  throw new Error(`Expected ${finalIndex} words, found ${words.length}`);
}

for (let position = 0; position < words.length; position += 1) {
  const expectedIndex = position + 1;
  if (Number(words[position].index) !== expectedIndex) {
    throw new Error(`Missing or duplicate word index near ${expectedIndex}`);
  }
}

const output = {
  schema_version: '2.0',
  title: '机考SAT真题词汇1900（Day 1–24）',
  series: '机考SAT真题词汇1900',
  source_pdf: sourcePdf,
  expected_range: [1, finalIndex],
  entry_count: words.length,
  count_notice: '原资料标题标注1900词；Day 1–24表格按序号实际收录1890个词条。',
  ocr_notice: '内容由中英文双通道 OCR 转换；raw 字段保留逐行结果。',
  words
};

const outputPath = path.join(wordListDirectory, outputFilename);
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`${outputFilename}: ${words.length} entries`);
