// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD_URL = pathToFileURL(resolve(root, 'board.html')).href;
const UNIT_URL = pathToFileURL(resolve(root, 'tests', 'unit.html')).href;
const KEY = 'personal-kanban-board.v1';

function boardState(tasks, extra = {}) {
  return {
    version: 5,
    revision: 0,
    language: 'de',
    activeProjectId: 'general',
    projects: [{
      id: 'general',
      title: 'General',
      columns: [
        { id: 'backlog', title: 'Backlog', color: '#d95d45', done: false },
        { id: 'done', title: 'Done', color: '#34835b', done: true }
      ],
      tasks
    }],
    ...extra
  };
}

const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

async function openBoard(page, data) {
  await page.goto(BOARD_URL);
  await page.evaluate((key) => { localStorage.clear(); }, KEY);
  if (data !== undefined) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)), [KEY, data]);
  }
  await page.reload();
}

async function openSettings(page) {
  await page.click('#open-settings');
  await expect(page.locator('#settings-dialog')).toHaveJSProperty('open', true);
}

async function createStory(page, title) {
  await page.click('#create-story');
  await page.fill('#story-title', title);
  await page.click('#story-form button[type=submit]');
}

test.beforeEach(async ({ page }) => {
  // Records every violation of the Content Security Policy and every script error.
  await page.addInitScript(() => {
    window.__problems = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__problems.push(`CSP ${event.violatedDirective} ${event.blockedURI}`));
    window.addEventListener('error', (event) => window.__problems.push(`Fehler ${event.message}`));
  });
  page.on('dialog', (dialog) => dialog.accept());
});

test.afterEach(async ({ page }) => {
  const problems = await page.evaluate(() => window.__problems || []).catch(() => []);
  expect(problems).toEqual([]);
});

test('Neues Board startet auf Englisch', async ({ page }) => {
  await openBoard(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#create-story')).toHaveText('+ New entry');
  await expect(page.locator('#open-settings')).toHaveText('Settings');
  await expect(page.locator('.project-tab')).toHaveText('General (0)');
  await expect(page.locator('.empty-state').first()).toHaveText('No entries in this column.');
  await expect(page.locator('.filter-status')).toHaveText('No entries yet');
  await createStory(page, 'Erster');
  await expect(page.locator('.filter-status')).toHaveText('1 of 1 entry shown');
  // Entries are called entries; "Story" only appears as the name of a type.
  expect(await page.locator('body').innerText()).not.toMatch(/stories|new story|edit story/i);
  await page.click('#create-story');
  await expect(page.locator('#story-description')).toHaveAttribute('data-placeholder', 'Enter a description');
});

test('Sprache wird in den Einstellungen umgestellt und gilt für alle Tabs', async ({ page, context }) => {
  await openBoard(page);
  const second = await context.newPage();
  await second.goto(BOARD_URL);
  await openSettings(page);
  await expect(page.locator('[data-language=en]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-language=de]');
  await expect(page.locator('#settings-dialog-title')).toHaveText('Einstellungen');
  await expect(page.locator('[data-language=de]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#close-settings');
  await expect(page.locator('#create-story')).toHaveText('+ Neuer Eintrag');
  await expect(second.locator('#create-story')).toHaveText('+ Neuer Eintrag');
  await page.reload();
  await expect(page.locator('#create-story')).toHaveText('+ Neuer Eintrag');
  await page.click('#create-story');
  await expect(page.locator('#story-description')).toHaveAttribute('data-placeholder', 'Beschreibung eingeben');
});

test('Modultests im Browser bestehen', async ({ page }) => {
  await page.goto(UNIT_URL);
  const result = await page.waitForFunction(() => window.unitTestResult).then((handle) => handle.jsonValue());
  const failures = await page.locator('li.failed').allTextContents();
  expect(failures).toEqual([]);
  expect(result.failed).toBe(0);
  // The attack samples contain style attributes. The Content Security Policy
  // blocks and reports them while they are parsed, before the sanitizer removes
  // them. These reports are expected; all other problems still count.
  await page.evaluate(() => { window.__problems = window.__problems.filter((problem) => !problem.startsWith('CSP style-src')); });
});

test('Schadcode in Beschreibungen wird nicht ausgeführt', async ({ page }) => {
  const attacks = [
    '<img src=x onerror="window.__xss=1">',
    '<svg><style><img src=x onerror="window.__xss=2"></style></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror="window.__xss=3">',
    '<noscript><p title="</noscript><img src=x onerror=window.__xss=4>">',
    '<a href="javascript:window.__xss=5">x</a><b onclick="window.__xss=6">b</b>',
    '<details open ontoggle="window.__xss=7">d</details>'
  ];
  await openBoard(page, boardState(attacks.map((description, index) => ({ id: `t${index}`, title: `T${index}`, description, columnId: 'backlog' }))));
  for (let index = 0; index < attacks.length; index += 1) {
    await page.click(`[data-action=edit-task][data-id=t${index}]`);
    await page.click('#cancel-story');
  }
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const attributes = await page.$$eval('.ticket-description *', (elements) => elements
    .filter((element) => [...element.attributes].some((attribute) => !(element.tagName === 'FONT' && attribute.name === 'color')))
    .map((element) => element.outerHTML));
  expect(attributes).toEqual([]);
});

test('Ein fehlerhafter Eintrag löscht nicht mehr das ganze Board', async ({ page }) => {
  await openBoard(page, boardState([
    { id: 'a', title: 'Wichtig', description: '', columnId: 'backlog' },
    { id: 'b', title: 'Defekt', description: '', columnId: 'gibtsnicht' }
  ]));
  await expect(page.locator('.ticket')).toHaveCount(2);
  await expect(page.locator('.notice-warning')).toContainText('Ein Eintrag wurde korrigiert');
  await openSettings(page);
  await page.click('[data-language=en]');
  expect((await stored(page)).projects[0].tasks.map((task) => task.title)).toEqual(['Wichtig', 'Defekt']);
  expect(await page.evaluate((key) => localStorage.getItem(`${key}.backup`), KEY)).toContain('gibtsnicht');
});

test('Unlesbare Daten werden gesichert und lassen sich herunterladen', async ({ page }) => {
  await openBoard(page, '{kaputt');
  await expect(page.locator('.notice')).toContainText('could not be read');
  const downloadPromise = page.waitForEvent('download');
  await page.click('.notice-action');
  const download = await downloadPromise;
  expect(await readFile(await download.path(), 'utf8')).toBe('{kaputt');
  await createStory(page, 'Neu');
  expect(await page.evaluate((key) => localStorage.getItem(`${key}.backup`), KEY)).toBe('{kaputt');
});

test('Zwei offene Tabs überschreiben sich nicht mehr', async ({ page, context }) => {
  await openBoard(page);
  const second = await context.newPage();
  await second.goto(BOARD_URL);
  await createStory(page, 'Aus Tab A');
  await expect(second.locator('.ticket h3')).toHaveText(['Aus Tab A']);
  await expect(second.locator('.notice')).toContainText('changed in another tab');
  await createStory(second, 'Aus Tab B');
  await expect(page.locator('.ticket h3')).toHaveText(['Aus Tab A', 'Aus Tab B']);
  await page.reload();
  await expect(page.locator('.ticket h3')).toHaveText(['Aus Tab A', 'Aus Tab B']);
});

test('Projektwechsel in einem Tab verstellt den anderen Tab nicht', async ({ page, context }) => {
  await openBoard(page);
  const second = await context.newPage();
  await second.goto(BOARD_URL);
  await page.click('#create-project');
  await page.fill('#project-title', 'Website');
  await page.click('#project-form button[type=submit]');
  await expect(second.locator('.project-tab')).toHaveCount(2);
  await expect(second.locator('.project-tab[aria-selected=true]')).toContainText('General');
});

test('Gleichzeitige Änderung ohne Benachrichtigung wird als Konflikt erkannt', async ({ page }) => {
  await openBoard(page, boardState([]));
  // Ändert den Speicher, ohne dass dieser Tab davon erfährt.
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    data.revision = 1;
    data.projects[0].tasks.push({ id: 'x', title: 'Extern', description: '', priority: 'normal', columnId: 'backlog' });
    localStorage.setItem(key, JSON.stringify(data));
  }, KEY);
  await createStory(page, 'Lokal');
  await expect(page.locator('#story-error')).toContainText('in einem anderen Tab geändert');
  await expect(page.locator('#story-dialog')).toHaveJSProperty('open', true);
  await expect(page.locator('.ticket h3')).toHaveText(['Extern']);
  await page.click('#story-form button[type=submit]');
  await expect(page.locator('#story-dialog')).toHaveJSProperty('open', false);
  expect((await stored(page)).projects[0].tasks.map((task) => task.title)).toEqual(['Extern', 'Lokal']);
});

test('Speicherfehler wird gemeldet und erzeugt keine doppelten Einträge', async ({ page }) => {
  await openBoard(page, boardState([]));
  await page.evaluate(() => {
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('voll', 'QuotaExceededError'); };
  });
  await createStory(page, 'Q');
  await expect(page.locator('#story-error')).toContainText('Speichern fehlgeschlagen');
  await expect(page.locator('.ticket')).toHaveCount(0);
  await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
  await page.click('#story-form button[type=submit]');
  await expect(page.locator('.ticket h3')).toHaveText(['Q']);
  expect((await stored(page)).projects[0].tasks).toHaveLength(1);
});

test('Board bleibt ohne Browserspeicher bedienbar', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('gesperrt', 'SecurityError'); } });
  });
  await page.goto(BOARD_URL);
  await expect(page.locator('.notice-error')).toContainText('Browser storage is not available');
  await openSettings(page);
  await page.click('[data-language=de]');
  await page.click('#close-settings');
  await expect(page.locator('#create-story')).toHaveText('+ Neuer Eintrag');
  await createStory(page, 'X');
  await expect(page.locator('#story-error')).toContainText('Speichern fehlgeschlagen');
});

test('Spalte umbenennen behält Farbe, Erledigt-Markierung steuert die Zählung', async ({ page }) => {
  await openBoard(page, boardState([
    { id: 'a', title: 'Offen', description: '', columnId: 'backlog' },
    { id: 'b', title: 'Fertig', description: '', columnId: 'done' }
  ]));
  await expect(page.locator('.project-tab')).toHaveText('Allgemein (1)');
  await page.click('[data-action=edit-column][data-id=done]');
  await expect(page.locator('#column-color')).toHaveValue('#34835b');
  await expect(page.locator('#column-done')).toBeChecked();
  await page.fill('#column-title', 'Erledigt');
  await page.click('#column-form button[type=submit]');
  expect((await stored(page)).projects[0].columns[1]).toEqual({ id: 'done', title: 'Erledigt', color: '#34835b', done: true });
  await page.click('[data-action=edit-column][data-id=done]');
  await page.uncheck('#column-done');
  await page.click('#column-form button[type=submit]');
  await expect(page.locator('.project-tab')).toHaveText('Allgemein (2)');
});

test('Neue Spalte bekommt die nächste Farbe aus der Palette', async ({ page }) => {
  await openBoard(page, boardState([]));
  await page.click('#create-column');
  await expect(page.locator('#column-color')).toHaveValue('#c58b12');
  // The done checkbox only appears when editing an existing column.
  await expect(page.locator('#column-done')).toBeHidden();
  await page.fill('#column-title', 'Review');
  await page.click('#column-form button[type=submit]');
  expect((await stored(page)).projects[0].columns.at(-1).done).toBe(false);
  await page.click('[data-action=edit-column][data-id=done]');
  await expect(page.locator('#column-done')).toBeVisible();
});

test('Ungültige Priorität wird als Normal angezeigt', async ({ page }) => {
  await openBoard(page, boardState([{ id: 'a', title: 'P', description: '', columnId: 'backlog', priority: 'constructor' }]));
  await expect(page.locator('.priority-badge')).toHaveText('Normal');
});

test('Zu lange Beschreibung wird abgelehnt statt abgeschnitten', async ({ page }) => {
  await openBoard(page, boardState([]));
  await page.click('#create-story');
  await page.fill('#story-title', 'Lang');
  await page.evaluate(() => { document.querySelector('#story-description').textContent = 'x'.repeat(10001); });
  await page.click('#story-form button[type=submit]');
  await expect(page.locator('#story-error')).toContainText('10.001 von höchstens 10.000');
  await expect(page.locator('.ticket')).toHaveCount(0);
});

test('Eintragstyp: Standard ist Aufgabe, Typ wird mit Symbol angezeigt und lässt sich ändern', async ({ page }) => {
  await openBoard(page);
  await page.click('#create-story');
  await expect(page.locator('#story-type')).toHaveValue('task');
  await page.fill('#story-title', 'Link kaputt');
  await page.selectOption('#story-type', 'bug');
  await page.click('#story-form button[type=submit]');
  const ticket = page.locator('.ticket').first();
  await expect(ticket.locator('.type-label')).toHaveText('Bug');
  await expect(ticket.locator('.type-label svg path')).not.toHaveCount(0);
  await expect(ticket).toHaveAttribute('aria-label', 'Bug: Link kaputt, priority Normal');
  expect((await stored(page)).projects[0].tasks[0].type).toBe('bug');

  await ticket.locator('[data-action=edit-task]').click();
  await expect(page.locator('#story-type')).toHaveValue('bug');
  await page.selectOption('#story-type', 'idea');
  await page.click('#story-form button[type=submit]');
  await expect(ticket.locator('.type-label')).toHaveText('Idea');

  await openSettings(page);
  await page.click('[data-language=de]');
  await page.click('#close-settings');
  await expect(ticket.locator('.type-label')).toHaveText('Idee');
});

test('Eintragstyp: ältere Einträge ohne Typ erscheinen als Aufgabe ohne Fehlermeldung', async ({ page }) => {
  await openBoard(page, boardState([{ id: 'a', title: 'Alt', description: '', columnId: 'backlog' }]));
  await expect(page.locator('.type-label')).toHaveText('Aufgabe');
  await expect(page.locator('.notice')).toHaveCount(0);
});

function filterBoard() {
  const T = (id, type, columnId) => ({ id, type, title: `${type} ${id}`, description: '', priority: 'normal', columnId });
  return boardState([T('1', 'bug', 'backlog'), T('2', 'task', 'backlog'), T('3', 'bug', 'done'), T('4', 'idea', 'backlog'), T('5', 'story', 'done'), T('6', 'task', 'done')]);
}

const chip = (page, value) => page.locator(`.filter-chip[data-filter=${value}]`);

test('Filter: "Alle" vorne, kein Wort davor, Typen einzeln und kombiniert', async ({ page }) => {
  await openBoard(page, { ...filterBoard(), language: 'en' });
  await expect(page.locator('#filter-bar')).not.toContainText('Show');
  await expect(page.locator('.filter-chip').first()).toHaveText('All6');
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'bug')).toHaveText('Bug2');
  await expect(page.locator('.filter-status')).toHaveText('6 of 6 entries shown');

  await chip(page, 'bug').click();
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.ticket')).toHaveCount(2);
  await expect(page.locator('.filter-status')).toHaveText('2 of 6 entries shown');
  await expect(page.locator('.column').first().locator('.count')).toHaveText('1 / 3');

  await chip(page, 'task').click();
  await expect(page.locator('.ticket')).toHaveCount(4);
  await chip(page, 'task').click();
  await chip(page, 'bug').click();
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ticket')).toHaveCount(6);
  await expect(page.locator('.filter-status')).toHaveText('6 of 6 entries shown');

  await chip(page, 'idea').click();
  await expect(page.locator('.column').nth(1).locator('.empty-state')).toHaveText('No matching entries. 3 are hidden by the filter.');
  await chip(page, 'all').click();
  await expect(page.locator('.ticket')).toHaveCount(6);

  for (const type of ['task', 'story', 'bug', 'idea']) await chip(page, type).click();
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
});

test('Filter: wird je Projekt gespeichert und bleibt nach dem Neuladen erhalten', async ({ page }) => {
  await openBoard(page, filterBoard());
  await page.click('#create-project');
  await page.fill('#project-title', 'Zweites');
  await page.click('#project-form button[type=submit]');
  await chip(page, 'idea').click();
  await page.locator('.project-tab').first().click();
  await chip(page, 'bug').click();
  await page.reload();
  await expect(chip(page, 'bug')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ticket')).toHaveCount(2);
  await expect(chip(page, 'all')).toHaveText('Alle6');
  await page.locator('.project-tab').nth(1).click();
  await expect(chip(page, 'idea')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'bug')).toHaveAttribute('aria-pressed', 'false');
  const data = await stored(page);
  expect(data.projects.map((project) => project.filter.types)).toEqual([['bug'], ['idea']]);
});

test('Filter: neuer Eintrag eines ausgeblendeten Typs bleibt sichtbar', async ({ page }) => {
  await openBoard(page, filterBoard());
  await chip(page, 'bug').click();
  await createStory(page, 'Neue Aufgabe');
  await expect(page.locator('.ticket h3', { hasText: 'Neue Aufgabe' })).toBeVisible();
  await expect(chip(page, 'task')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'bug')).toHaveAttribute('aria-pressed', 'true');
});

test('Neuer Eintrag: geöffnetes Projekt ist vorausgewählt und wird verwendet', async ({ page }) => {
  await openBoard(page);
  await page.click('#create-project');
  await page.fill('#project-title', 'Website');
  await page.click('#project-form button[type=submit]');
  await page.click('#create-story');
  await expect(page.locator('#story-project option:checked')).toHaveText('Website');
  await page.fill('#story-title', 'Für Website');
  await page.click('#story-form button[type=submit]');
  const data = await stored(page);
  expect(data.projects[1].tasks.map((task) => task.title)).toEqual(['Für Website']);
  expect(data.projects[0].tasks).toEqual([]);
});

test('Escape schließt jeden Dialog, auch mit Eingaben', async ({ page }) => {
  await openBoard(page);
  for (const [opener, field] of [['#create-story', '#story-title'], ['#create-column', '#column-title'], ['#create-project', '#project-title'], ['#open-settings', null]]) {
    const dialog = page.locator('dialog[open]');
    await page.click(opener);
    await expect(dialog).toHaveCount(1);
    if (field) await page.fill(field, 'Entwurf');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  await page.click('#create-story');
  await page.click('#story-description');
  await page.keyboard.type('Text im Editor');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.ticket')).toHaveCount(0);
});

test('Projektreiter lassen sich mit den Pfeiltasten bedienen', async ({ page }) => {
  await openBoard(page);
  await page.click('#create-project');
  await page.fill('#project-title', 'Website');
  await page.click('#project-form button[type=submit]');
  await page.locator('.project-tab').first().click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.project-tab[aria-selected=true]')).toContainText('Website');
  await expect(page.locator('.project-tab[aria-selected=true]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('.project-tab[aria-selected=true]')).toContainText('General');
  await expect(page.locator('[role=tablist] [tabindex="0"]')).toHaveCount(1);
});

test('Export und Import stellen das Board wieder her', async ({ page }) => {
  await openBoard(page, boardState([{ id: 'a', title: 'Sichern', description: '<b>wichtig</b>', columnId: 'backlog', priority: 'high' }]));
  await openSettings(page);
  const downloadPromise = page.waitForEvent('download');
  await page.click('#export-board');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^arbeitsboard-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator('#settings-status')).toContainText('Export gestartet');
  const exported = await download.path();
  await page.click('#close-settings');

  await page.click('[data-action=delete-task][data-id=a]');
  await expect(page.locator('.ticket')).toHaveCount(0);

  await openSettings(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('#import-board');
  await (await chooserPromise).setFiles(exported);
  await expect(page.locator('#settings-status')).toContainText('importiert');
  await page.click('#close-settings');
  await expect(page.locator('.ticket h3')).toHaveText(['Sichern']);
  const backup = JSON.parse(await page.evaluate((key) => localStorage.getItem(`${key}.backup`), KEY));
  expect(backup.projects[0].tasks).toEqual([]);
});

test('Import einer ungültigen Datei wird abgelehnt', async ({ page }) => {
  await openBoard(page, boardState([{ id: 'a', title: 'Bleibt', description: '', columnId: 'backlog' }]));
  await openSettings(page);
  await page.setInputFiles('#import-file', { name: 'falsch.json', mimeType: 'application/json', buffer: Buffer.from('[1,2,3]') });
  await expect(page.locator('#settings-status.is-error')).toContainText('falsch.json');
  await page.click('#close-settings');
  await expect(page.locator('.ticket h3')).toHaveText(['Bleibt']);
});

async function openEditor(page) {
  await openBoard(page);
  await page.click('#create-story');
  await page.fill('#story-title', 'Format');
  await page.click('#story-description');
}

const savedDescription = async (page) => {
  await page.click('#story-form button[type=submit]');
  return (await stored(page)).projects[0].tasks[0].description;
};

test('Editor: Werkzeugleiste formatiert ohne execCommand', async ({ page }) => {
  await page.addInitScript(() => {
    Document.prototype.execCommand = () => { throw new Error('execCommand aufgerufen'); };
  });
  await openEditor(page);
  await page.keyboard.type('Hallo');
  await page.keyboard.press('ControlOrMeta+a');
  await page.click('[data-command=bold]');
  await page.click('[data-command=color][data-value="#b7352a"]');
  await page.click('[data-command=list]');
  expect(await savedDescription(page)).toBe('<ul><li><b><font color="#b7352a">Hallo</font></b></li></ul>');
});

test('Editor: Tastenkürzel, Weiterschreiben in Fett und Rückgängig', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('Hallo ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('Welt');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('!');
  await expect(page.locator('#story-description b')).toHaveText(/^\u200B?Welt$/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(page.locator('#story-description i')).not.toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#story-description i')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+u');
  // Browsers store a typed trailing space as &nbsp;, so both forms are fine.
  expect(await savedDescription(page)).toMatch(/^Hallo(&nbsp;| )<b>Welt<\/b>!$/);
});

test('Editor: Einfügen aus der Zwischenablage ergibt reinen Text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/html', '<img src=x onerror="window.__xss=1"><b>fett</b>');
    data.setData('text/plain', 'Zeile 1\nZeile 2');
    document.querySelector('#story-description').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await savedDescription(page)).toBe('Zeile 1<br>Zeile 2');
});

test('Hineingezogenes HTML landet im Editor nur als Text', async ({ page }) => {
  await openBoard(page);
  await page.click('#create-story');
  await page.evaluate(() => {
    const editor = document.querySelector('#story-description');
    const data = new DataTransfer();
    data.setData('text/html', '<img src=x onerror="window.__xss=1"><b>fett</b>');
    data.setData('text/plain', 'nur Text');
    const bounds = editor.getBoundingClientRect();
    editor.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: bounds.left + 10, clientY: bounds.top + 10 }));
  });
  await expect(page.locator('#story-description')).toHaveText('nur Text');
  expect(await page.locator('#story-description *').count()).toBe(0);
});

test('Tickets lassen sich per Drag and Drop verschieben', async ({ page }) => {
  await openBoard(page, boardState([{ id: 'a', title: 'Ziehen', description: '', columnId: 'backlog' }]));
  await page.dragAndDrop('.ticket[data-task-id=a]', '[data-task-list=done]');
  expect((await stored(page)).projects[0].tasks[0].columnId).toBe('done');
});
