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
  // Real mouse movements in several steps, as a person drags.
  const source = await page.locator('.ticket[data-task-id=a] h3').boundingBox();
  const target = await page.locator('[data-task-list=done]').boundingBox();
  await page.mouse.move(source.x + 20, source.y + 5);
  await page.mouse.down();
  await page.mouse.move(source.x + 60, source.y + 10, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2, target.y + 40, { steps: 10 });
  await page.mouse.up();
  expect((await stored(page)).projects[0].tasks[0].columnId).toBe('done');
});

// --- Fälligkeitsdatum, Suche, Anlegen in einer Spalte, Farbschema -------------

function isoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test('Fälligkeit: steht im Kopf der Karte, heute, morgen, überfällig und später unterschiedlich', async ({ page }) => {
  const T = (id, due, columnId = 'backlog') => ({ id, title: `T${id}`, description: '', columnId, due });
  await openBoard(page, { ...boardState([T('a', isoDate(0)), T('b', isoDate(1)), T('c', isoDate(-3)), T('d', '2030-01-15'), T('e', isoDate(-3), 'done')]), language: 'en' });
  const due = (id) => page.locator(`.ticket[data-task-id=${id}] .ticket-meta .ticket-due`);
  await expect(due('a')).toHaveText('Today');
  await expect(due('a')).toHaveClass(/is-soon/);
  await expect(due('b')).toHaveText('Tomorrow');
  await expect(due('c')).toHaveClass(/is-overdue/);
  await expect(due('c')).toHaveAttribute('title', /^Overdue since /);
  await expect(due('d')).toHaveText('15 Jan 2030');
  await expect(due('d')).toHaveAttribute('title', 'Due 15 Jan 2030');
  await expect(due('d')).not.toHaveClass(/is-soon|is-overdue/);
  // In a done column nothing is highlighted any more.
  await expect(due('e')).not.toHaveClass(/is-overdue/);
  // No word in front of the date on the card.
  expect(await page.locator('.ticket-due').allTextContents()).not.toContainEqual(expect.stringMatching(/Due|Overdue/));
  await expect(page.locator('.ticket[data-task-id=c]')).toHaveAttribute('aria-label', /Overdue since/);
});

test('Fälligkeit: Datum im Dialog setzen, auf Deutsch anzeigen und wieder entfernen', async ({ page }) => {
  await openBoard(page, boardState([]));
  await page.click('#create-story');
  await page.fill('#story-title', 'Mit Termin');
  await page.fill('#story-due', '2030-01-15');
  await page.click('#story-form button[type=submit]');
  await expect(page.locator('.ticket-meta .ticket-due')).toHaveText('15. Jan. 2030');
  expect((await stored(page)).projects[0].tasks[0].due).toBe('2030-01-15');
  await page.click('[data-action=edit-task]');
  await expect(page.locator('#story-due')).toHaveValue('2030-01-15');
  await page.fill('#story-due', '');
  await page.click('#story-form button[type=submit]');
  await expect(page.locator('.ticket-due')).toHaveCount(0);
  expect((await stored(page)).projects[0].tasks[0].due).toBe('');
});

function searchBoard() {
  const T = (id, type, title, description = '') => ({ id, type, title, description, columnId: 'backlog' });
  return {
    ...boardState([
      T('1', 'bug', 'Login schlägt fehl', 'Nur in <b>Safari</b>'),
      T('2', 'task', 'Domain einrichten'),
      T('3', 'task', 'Login-Seite gestalten'),
      T('4', 'idea', 'Dunkles Farbschema', 'Kontrast für Safari prüfen')
    ]),
    language: 'en'
  };
}

test('Suche: findet Titel und Beschreibung, kombiniert mit Typfilter, Escape leert', async ({ page }) => {
  await openBoard(page, searchBoard());
  await page.fill('#search-input', 'login');
  await expect(page.locator('.ticket h3')).toHaveText(['Login schlägt fehl', 'Login-Seite gestalten']);
  await expect(page.locator('#filter-status')).toHaveText('2 of 4 entries shown');
  await expect(page.locator('.column').first().locator('.count')).toHaveText('2 / 4');

  await page.fill('#search-input', 'safari');
  await expect(page.locator('.ticket h3')).toHaveText(['Login schlägt fehl', 'Dunkles Farbschema']);
  await page.fill('#search-input', 'safari login');
  await expect(page.locator('.ticket h3')).toHaveText(['Login schlägt fehl']);

  await page.fill('#search-input', 'login');
  await chip(page, 'task').click();
  await expect(page.locator('.ticket h3')).toHaveText(['Login-Seite gestalten']);
  await chip(page, 'all').click();

  await page.focus('#search-input');
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('.ticket')).toHaveCount(4);
});

test('Suche: wird je Projekt gespeichert, "/" springt ins Suchfeld', async ({ page }) => {
  await openBoard(page, searchBoard());
  await page.locator('body').click();
  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.type('domain');
  await expect(page.locator('.ticket h3')).toHaveText(['Domain einrichten']);
  await expect.poll(async () => (await stored(page)).projects[0].filter?.search).toBe('domain');
  await page.reload();
  await expect(page.locator('#search-input')).toHaveValue('domain');
  await expect(page.locator('.ticket')).toHaveCount(1);

  await page.click('#create-project');
  await page.fill('#project-title', 'Zweites');
  await page.click('#project-form button[type=submit]');
  await expect(page.locator('#search-input')).toHaveValue('');
  await page.locator('.project-tab').first().click();
  await expect(page.locator('#search-input')).toHaveValue('domain');
});

test('Suche: neuer Eintrag, der nicht passt, hebt die Suche auf und bleibt sichtbar', async ({ page }) => {
  await openBoard(page, searchBoard());
  await page.fill('#search-input', 'login');
  await createStory(page, 'Ganz etwas anderes');
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('.ticket h3', { hasText: 'Ganz etwas anderes' })).toBeVisible();
});

test('Anlegen in einer Spalte: "+" setzt die Spalte vor, Spalte lässt sich im Dialog wechseln', async ({ page }) => {
  await openBoard(page, { ...boardState([]), language: 'en' });
  const add = page.locator('.column').nth(1).locator('[data-action=add-task]');
  await expect(add).toHaveAttribute('aria-label', 'New entry in Done');
  await add.click();
  await expect(page.locator('#story-column')).toHaveValue('done');
  await page.fill('#story-title', 'Schon erledigt');
  await page.click('#story-form button[type=submit]');
  expect((await stored(page)).projects[0].tasks[0].columnId).toBe('done');
  await expect(page.locator('.column').nth(1).locator('.ticket h3')).toHaveText(['Schon erledigt']);

  await page.click('[data-action=edit-task]');
  await page.selectOption('#story-column', 'backlog');
  await page.click('#story-form button[type=submit]');
  await expect(page.locator('.column').first().locator('.ticket h3')).toHaveText(['Schon erledigt']);
});

test('Anlegen in einer Spalte: Projektwechsel im Dialog lädt dessen Spalten', async ({ page }) => {
  await openBoard(page, { ...boardState([]), language: 'en' });
  await page.click('#create-project');
  await page.fill('#project-title', 'Zweites');
  await page.click('#project-form button[type=submit]');
  await page.locator('.project-tab').first().click();
  await page.click('#create-story');
  await expect(page.locator('#story-column option')).toHaveText(['Backlog', 'Done']);
  await page.selectOption('#story-project', { label: 'Zweites' });
  await expect(page.locator('#story-column option')).toHaveText(['Backlog', 'In Work', 'Done']);
  await expect(page.locator('#story-column')).toHaveValue('backlog');
});

const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('Farbschema: Hell ist Standard, auch wenn das Betriebssystem dunkel ist', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openBoard(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe('rgb(247, 244, 237)');
  await openSettings(page);
  await expect(page.locator('[data-theme-option=light]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.segmented').nth(1).locator('button')).toHaveText(['Light', 'Dark', 'System']);
});

test('Farbschema: Hell, Dunkel und Wie System, gespeichert über das Neuladen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoard(page, { ...boardState([{ id: 'a', title: 'Schwarz', description: '<font color="#20251f">Text</font>', columnId: 'backlog' }]), language: 'en' });
  const light = await background(page);
  await openSettings(page);
  await expect(page.locator('[data-theme-option=light]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-theme-option=dark]');
  await page.click('#close-settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await background(page);
  expect(dark).not.toBe(light);
  // Text stored as "black" stays readable on the dark background.
  expect(await page.locator('.ticket-description font').evaluate((element) => getComputedStyle(element).color)).toBe('rgb(233, 231, 224)');
  await page.reload();
  expect(await background(page)).toBe(dark);

  await openSettings(page);
  await page.click('[data-theme-option=system]');
  await page.click('#close-settings');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await background(page)).toBe(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await background(page)).toBe(dark);

  await openSettings(page);
  await page.click('[data-theme-option=light]');
  await page.click('#close-settings');
  expect(await background(page)).toBe(light);
});

// --- Prioritätsfilter --------------------------------------------------------

function priorityBoard() {
  const T = (id, type, priority) => ({ id, type, priority, title: `${type} ${priority} ${id}`, description: '', columnId: 'backlog' });
  return { ...boardState([T('1', 'bug', 'critical'), T('2', 'task', 'critical'), T('3', 'bug', 'high'), T('4', 'task', 'normal'), T('5', 'idea', 'low')]), language: 'en' };
}

const priorityChip = (page, value) => page.locator(`.priority-chip[data-priority-filter=${value}]`);

test('Prioritätsfilter: nur kritische, kombiniert mit Typ, "Alle" setzt beides zurück', async ({ page }) => {
  await openBoard(page, priorityBoard());
  await expect(page.locator('.priority-chip')).toHaveText(['Critical2', 'High1', 'Normal1', 'Low1']);
  await priorityChip(page, 'critical').click();
  await expect(priorityChip(page, 'critical')).toHaveAttribute('aria-pressed', 'true');
  await expect(priorityChip(page, 'critical').locator('svg')).toHaveCount(1);
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.ticket')).toHaveCount(2);
  await expect(page.locator('#filter-status')).toHaveText('2 of 5 entries shown');

  await priorityChip(page, 'high').click();
  await expect(page.locator('.ticket')).toHaveCount(3);
  await chip(page, 'bug').click();
  await expect(page.locator('.ticket h3')).toHaveText(['bug critical 1', 'bug high 3']);

  await chip(page, 'all').click();
  await expect(page.locator('.ticket')).toHaveCount(5);
  await expect(page.locator('.priority-chip[aria-pressed=true]')).toHaveCount(0);
  await expect(chip(page, 'all')).toHaveAttribute('aria-pressed', 'true');
});

test('Prioritätsfilter: bleibt nach dem Neuladen, neuer Eintrag anderer Priorität bleibt sichtbar', async ({ page }) => {
  await openBoard(page, priorityBoard());
  await priorityChip(page, 'critical').click();
  await page.reload();
  await expect(priorityChip(page, 'critical')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ticket')).toHaveCount(2);
  expect((await stored(page)).projects[0].filter.priorities).toEqual(['critical']);
  await createStory(page, 'Normale Priorität');
  await expect(page.locator('.ticket h3', { hasText: 'Normale Priorität' })).toBeVisible();
  await expect(priorityChip(page, 'normal')).toHaveAttribute('aria-pressed', 'true');
});

// --- Name des Boards und Version ---------------------------------------------

test('Boardname: gilt für beide Sprachen, bleibt nach dem Neuladen, leer ergibt den Standardnamen', async ({ page }) => {
  await openBoard(page);
  await expect(page.locator('h1')).toHaveText('Work board');
  await expect(page.locator('h1')).not.toContainText('v0.');
  await openSettings(page);
  await expect(page.locator('#settings-version')).toHaveText(/^Version \d+\.\d+\.\d+$/);
  await expect(page.locator('#board-name-input')).toHaveAttribute('placeholder', 'Work board');
  await page.fill('#board-name-input', 'Team Alpha');
  await expect(page.locator('h1')).toHaveText('Team Alpha');
  await expect(page).toHaveTitle('Team Alpha');
  await page.click('[data-language=de]');
  await expect(page.locator('h1')).toHaveText('Team Alpha');
  await expect(page.locator('#settings-version')).toHaveText(/^Version /);
  await page.click('#close-settings');
  await expect.poll(async () => (await stored(page)).boardName).toBe('Team Alpha');
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Team Alpha');
  await expect(page).toHaveTitle('Team Alpha');

  await openSettings(page);
  await expect(page.locator('#board-name-input')).toHaveValue('Team Alpha');
  await page.fill('#board-name-input', '');
  await expect(page.locator('h1')).toHaveText('Arbeitsboard');
  await page.click('[data-language=en]');
  await expect(page.locator('h1')).toHaveText('Work board');
  await expect(page).toHaveTitle('Work board');
  await page.click('#close-settings');
  await expect.poll(async () => (await stored(page)).boardName).toBe('');
});

// --- Eintrag ansehen ----------------------------------------------------------

test('Ansehen: Klick auf den Titel zeigt den ganzen Eintrag, von dort geht es zum Bearbeiten', async ({ page }) => {
  const long = `<b>Anfang</b> ${'viel Text '.repeat(80)}<i>Ende</i>`;
  await openBoard(page, { ...boardState([{ id: 'a', type: 'bug', title: 'Langer Eintrag', description: long, priority: 'high', columnId: 'backlog', due: '2030-01-15' }]), language: 'en' });
  await expect(page.locator('.ticket-description')).toHaveClass(/is-truncated/);
  await page.click('.ticket-title');
  await expect(page.locator('#view-dialog')).toHaveJSProperty('open', true);
  await expect(page.locator('#view-title')).toHaveText('Langer Eintrag');
  await expect(page.locator('#view-location')).toHaveText('General · Backlog');
  await expect(page.locator('#view-meta .type-label')).toHaveText('Bug');
  await expect(page.locator('#view-meta .ticket-due')).toHaveText('Due 15 Jan 2030');
  await expect(page.locator('#view-description i')).toHaveText('Ende');
  await page.click('#view-edit');
  await expect(page.locator('#view-dialog')).toHaveJSProperty('open', false);
  await expect(page.locator('#story-dialog')).toHaveJSProperty('open', true);
  await expect(page.locator('#story-title')).toHaveValue('Langer Eintrag');
  await page.keyboard.press('Escape');
  await page.focus('.ticket-title');
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-dialog')).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-dialog')).toHaveJSProperty('open', false);
});

test('Ansehen: Klick auf die übrige Karte und ein abgebrochener Zug am Titel öffnen nichts', async ({ page }) => {
  await openBoard(page, boardState([{ id: 'a', title: 'Ziehen', description: 'Text', columnId: 'backlog' }]));
  await page.click('.ticket-description');
  await page.click('.ticket-meta');
  const title = await page.locator('.ticket-title').boundingBox();
  await page.mouse.move(title.x + 5, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x + 25, title.y + 5);
  await page.mouse.up();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
