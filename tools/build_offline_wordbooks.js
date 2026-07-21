'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const wordListDirectory = path.join(projectRoot, 'word_list');
const filenames = [
  '400词含例句同反义词.json',
  '机考SAT真题词汇1900_Day1-24.json',
  '机考SAT真题词汇2000_Day1-10.json',
  '机考SAT真题词汇2000_Day11-20.json',
  '机考SAT真题词汇2000_Day21-26.json'
];

for (const filename of filenames) {
  const sourcePath = path.join(wordListDirectory, filename);
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const outputFilename = filename.replace(/\.json$/i, '.offline.js');
  const outputPath = path.join(wordListDirectory, outputFilename);
  const source = [
    'window.__SAT_BUNDLED_WORDBOOKS__ = window.__SAT_BUNDLED_WORDBOOKS__ || {};',
    `window.__SAT_BUNDLED_WORDBOOKS__[${JSON.stringify(filename)}] = ${JSON.stringify(parsed)};`,
    ''
  ].join('\n');
  fs.writeFileSync(outputPath, source, 'utf8');
  console.log(`${outputFilename}: ${parsed.words?.length || parsed.length || 0} entries`);
}
