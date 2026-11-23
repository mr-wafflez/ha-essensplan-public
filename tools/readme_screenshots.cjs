/* Render the README images from a fixture. Called by tools/readme_screenshots.py. */
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const load = name => {
  try { return require(name); }
  catch { return createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()+'/node_modules','_entry.js'))(name); }
};
const {chromium} = load('playwright');
const [fixturePath, outDir] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const frontend = path.join(__dirname, '../custom_components/essensplan/frontend');
// Home Assistant's default light theme, so the images look like a fresh installation.
const theme = `:root{--primary-color:#03a9f4;--text-primary-color:#fff;--card-background-color:#fff;
  --secondary-background-color:#e5e5e5;--divider-color:rgba(0,0,0,.12);--primary-text-color:#212121;
  --secondary-text-color:#727272;--success-color:#43a047;--warning-color:#e65100;--error-color:#db4437}
  body{margin:0;background:#fafafa;font-family:Roboto,"Segoe UI",sans-serif}main{max-width:720px;margin:16px auto;padding:0 12px}`;

(async () => {
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox'],
    ...(process.env.ESSENSPLAN_BROWSER_EXECUTABLE ? {executablePath: process.env.ESSENSPLAN_BROWSER_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 760, height: 980}, deviceScaleFactor: 1, hasTouch: true});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('http://essensplan.test/**', route => route.fulfill({contentType: 'text/html',
    body: `<!doctype html><html lang="de"><head><style>${theme}</style></head><body><main></main></body></html>`}));
  await page.route(url => url.origin !== 'http://essensplan.test', route => route.abort());
  await page.route('http://essensplan.test/essensplan_static/**', route => {
    const name = new URL(route.request().url()).pathname.slice('/essensplan_static/'.length);
    if (!/^(essensplan-card\.js|card\/[a-z]+\.mjs|recipe-ocr\.mjs|recipe-placeholder\.svg|kitchen-background\.svg|ocr\/[a-z0-9.-]+)$/.test(name)) {
      return route.fulfill({status: 404, body: ''});
    }
    return route.fulfill({path: path.join(frontend, name),
      contentType: name.endsWith('.svg') ? 'image/svg+xml' : /\.m?js$/.test(name) ? 'text/javascript' : 'application/octet-stream'});
  });
  await page.goto('http://essensplan.test/');
  // Home Assistant defines <ha-card> as a block element; the test page needs a stand-in.
  await page.evaluate(() => customElements.define('ha-card', class extends HTMLElement {
    connectedCallback() { this.style.display = 'block'; }
  }));
  await page.addScriptTag({url: 'http://essensplan.test/essensplan_static/essensplan-card.js', type: 'module'});
  await page.waitForFunction(() => customElements.get('essensplan-card'));
  await page.evaluate(fixture => {
    window.state = fixture.state;
    window.hass = {states: {}, callWS: async cmd => {
      if (cmd.type === 'essensplan/get') return structuredClone(state);
      if (cmd.type === 'essensplan/ingredients') return {revision: state.revision, ingredient_list: fixture.ingredient_list};
      if (cmd.type === 'essensplan/nutrition_search') return cmd.queries.map(q => fixture.search[q] || []);
      if (cmd.type === 'essensplan/product_search') return fixture.products[cmd.query] || [];
      throw new Error('Im Bildskript nicht vorgesehen');
    }};
    const card = document.createElement('essensplan-card');
    card.setConfig({mode: 'week'});
    document.querySelector('main').append(card);
    card.hass = hass;
    window.card = card;
  }, fixture);
  const card = page.locator('essensplan-card');
  const dialog = card.locator('dialog');
  const shot = async (name, locator, maxHeight, margin = 0) => {
    // No hover or focus ring from the last click in the picture.
    await page.mouse.move(0, 0);
    await page.evaluate(() => card.shadowRoot.activeElement?.blur());
    const box = await locator.boundingBox();
    await page.screenshot({path: path.join(outDir, name), clip: {x: box.x - margin, y: box.y - margin,
      width: box.width + 2 * margin, height: Math.min(box.height, maxHeight || box.height) + 2 * margin}});
    console.log(name);
  };
  const ids = fixture.ids;

  // Week plan with tiles, mealprep leftovers and the cooked check.
  await card.locator('.day').first().waitFor();
  await shot('wochenplan.png', card, 760, 10);

  // Recipe choice from a free slot.
  await card.locator('.slot.empty .slot-main').nth(5).click();
  await dialog.waitFor();
  await page.waitForTimeout(200);
  await shot('rezeptwahl.png', dialog);
  await dialog.locator('[data-close], button:has-text("Abbrechen")').first().click();
  await dialog.waitFor({state: 'detached'});

  // Action sheet of a mealprep cooking slot.
  await card.locator('.slot:not(.empty) .slot-main').first().click();
  await dialog.waitFor();
  await page.waitForTimeout(200);
  await shot('mealprep.png', dialog);
  await page.keyboard.press('Escape');
  await dialog.waitFor({state: 'detached'});

  // Household ingredient list with suggestions.
  await page.evaluate(() => { card._mode = 'recipes'; card.render(); });
  await card.locator('[data-ingredients]').click();
  await dialog.getByText('Vorschlag:', {exact: false}).first().waitFor();
  await dialog.locator('[data-filter="all"]').click();
  await page.waitForTimeout(200);
  await shot('zutaten-naehrwerte.png', dialog);
  // One search: foods from the BLS and products, each with kcal per 100 g.
  const cream = dialog.locator('.ing-row').filter({hasText: 'Sahne'});
  await cream.locator('[data-edit]').click();
  await cream.locator('[data-search]').click();
  await cream.getByText('Beispielhof').waitFor();
  await page.evaluate(() => card.shadowRoot.querySelector('.ing-panel').scrollIntoView({block: 'start'}));
  await page.waitForTimeout(200);
  await shot('suche.png', cream, 820);
  await cream.locator('[data-cancel]').click();
  await dialog.locator('[data-close]').click();
  await dialog.waitFor({state: 'detached'});

  // Amounts table of one recipe with missing assignments.
  await card.locator(`[data-amounts="${ids['Kartoffel-Lauch-Auflauf']}"]`).click();
  await dialog.locator('.amount-row').first().waitFor();
  await page.waitForTimeout(300);
  await shot('mengen-naehrwerte.png', dialog);
  await dialog.locator('[data-close]').click();
  await dialog.waitFor({state: 'detached'});

  // Local screenshot import review.
  const pageImage = async lines => ({name: 'rezept.png', mimeType: 'image/png', buffer: Buffer.from(await page.evaluate(lines => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 80 + lines.length * 56;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black'; ctx.font = '34px Arial'; lines.forEach((line, i) => ctx.fillText(line, 40, 60 + i * 56));
    return canvas.toDataURL('image/png').split(',')[1];
  }, lines), 'base64')});
  await card.locator('[data-act="new"]').click();
  await card.locator('#recipe-screenshot').setInputFiles(await pageImage(['Zutaten:', '250 g rote Linsen', '2 Karotten',
    '1 l Gemüsebrühe', 'Zubereitung:', '1. Linsen waschen.', '2. Alles 20 Minuten kochen.']));
  await card.locator('#ocr-review').waitFor({timeout: 60000});
  await page.waitForTimeout(300);
  await shot('screenshot-pruefung.png', card.locator('#ocr-review'), 900);

  if (errors.length) throw new Error(errors.join('\n'));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
