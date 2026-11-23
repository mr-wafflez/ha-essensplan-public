/* Joins the card and its modules into one script for vm-based unit tests (no browser, no bundler). */
const fs = require('node:fs');
const path = require('node:path');
const importLine = /^import \{([^}]*)\} from '([^']+)';$/gm;
function cardSource(file = path.join(__dirname, '../custom_components/essensplan/frontend/essensplan-card.js')) {
  const seen = new Set();
  const inline = name => {
    const resolved = path.resolve(path.dirname(name), '');
    if (seen.has(name)) return '';
    seen.add(name);
    const text = fs.readFileSync(name, 'utf8');
    let deps = '';
    for (const [, , spec] of text.matchAll(importLine)) {
      deps += inline(path.resolve(resolved, spec.split('?')[0]));
    }
    return deps + text.replace(importLine, '').replace(/^export (const|function|async function) /gm, '$1 ') + '\n';
  };
  return inline(file);
}
module.exports = {cardSource};
