// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
// Module tests without any tool: open tests/unit.html in the browser.
(function (ns) {
  'use strict';

  const { sanitizeDescription } = ns.sanitize;
  const { translate } = ns.i18n;
  const model = ns.model;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Bedingung nicht erfüllt');
  }

  function equal(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${message} erwartet ${e}, erhalten ${a}`.trim());
  }

  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'FONT']);

  // Parses sanitized output and checks that only allowed elements without attributes remain.
  function assertClean(html, label) {
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    body.querySelectorAll('*').forEach((element) => {
      assert(ALLOWED.has(element.tagName), `${label}: Element ${element.tagName} nicht erlaubt in ${html}`);
      [...element.attributes].forEach((attribute) => {
        assert(element.tagName === 'FONT' && attribute.name === 'color', `${label}: Attribut ${attribute.name} nicht erlaubt in ${html}`);
      });
    });
  }

  const ATTACKS = [
    '<img src=x onerror="window.__xss=1">',
    '<svg><style><img src=x onerror="window.__xss=2"></style></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror="window.__xss=3">',
    '<noscript><p title="</noscript><img src=x onerror=window.__xss=4>">',
    '<form><math><mtext></form><form><mglyph><style></math><img src onerror=window.__xss=5>',
    '<a href="javascript:window.__xss=6">x</a><b onclick="window.__xss=7" style="color:red">b</b>',
    '<font color="red" face="x" onmouseover="window.__xss=8">f</font>',
    'text<!--<img src=x onerror=window.__xss=9>--><?xml x--><img src=x onerror=window.__xss=10>',
    '<xmp><img src=x onerror=window.__xss=11></xmp><textarea><img src=x onerror=window.__xss=12></textarea>',
    '<template><img src=x onerror=window.__xss=13></template><svg><foreignObject><div onload=x>z</div></foreignObject></svg>',
    '<iframe srcdoc="<script>parent.__xss=14</script>"></iframe><object data="x"></object><embed src="x">',
    '<base href="https://example.com/"><meta http-equiv="refresh" content="0;url=https://example.com"><link rel=stylesheet href=x>',
    '<details open ontoggle="window.__xss=15">d</details><video><source onerror="window.__xss=16"></video>',
    '<p style="background:url(javascript:alert(1))">p</p><div class="x" id="y" data-a="b">d</div>'
  ];

  // --- Sanitizer ------------------------------------------------------------

  test('Sanitizer: kein Angriffsmuster hinterlässt Elemente oder Attribute außerhalb der Erlaubnisliste', () => {
    ATTACKS.forEach((attack, index) => assertClean(sanitizeDescription(attack), `Muster ${index + 1}`));
  });

  test('Sanitizer: zweimaliges Bereinigen ändert nichts mehr (kein Umbau beim erneuten Einlesen)', () => {
    ATTACKS.forEach((attack, index) => {
      const once = sanitizeDescription(attack);
      equal(sanitizeDescription(once), once, `Muster ${index + 1}:`);
    });
  });

  test('Sanitizer: Formatierung aus dem Editor bleibt erhalten', () => {
    const html = '<b>fett</b> <i>kursiv</i><ul><li>eins</li><li>zwei</li></ul><div>Zeile<br>neu</div>';
    equal(sanitizeDescription(html), html);
  });

  test('Sanitizer: nur die beiden Editorfarben bleiben, Großschreibung wird vereinheitlicht', () => {
    equal(sanitizeDescription('<font color="#B7352A">rot</font><font color="#ff0000">x</font>'), '<font color="#b7352a">rot</font><font>x</font>');
  });

  test('Sanitizer: Kommentare werden entfernt', () => {
    equal(sanitizeDescription('a<!-- geheim -->b'), 'ab');
  });

  test('Sanitizer: leere Beschreibung bleibt leer', () => {
    equal(sanitizeDescription('<br>'), '');
    equal(sanitizeDescription('<div> </div>'), '');
    equal(sanitizeDescription(null), '');
  });

  test('Sanitizer: lange Texte werden nicht abgeschnitten', () => {
    const html = `<b>${'x'.repeat(20000)}</b>`;
    equal(sanitizeDescription(html), html);
  });

  // --- Übersetzung ------------------------------------------------------------

  test('Übersetzung: Platzhalter werden ersetzt', () => {
    equal(translate('de', 'before', { title: 'Done' }), 'Vor Done');
    equal(translate('en', 'before', { title: 'Done' }), 'Before Done');
  });

  test('Übersetzung: unbekannte Schlüssel und eingebaute Objekteigenschaften liefern den Schlüssel', () => {
    equal(translate('de', 'gibtsnicht'), 'gibtsnicht');
    equal(translate('de', 'priority.constructor'), 'priority.constructor');
    equal(translate('de', 'priority.__proto__'), 'priority.__proto__');
    equal(translate('xx', 'save'), 'Save');
  });

  // --- Datenmodell ------------------------------------------------------------

  function board(tasks, columns) {
    return {
      version: 5,
      projects: [{
        id: 'general',
        title: 'General',
        columns: columns || [{ id: 'backlog', title: 'Backlog', color: '#d95d45' }, { id: 'done', title: 'Done', color: '#34835b' }],
        tasks
      }]
    };
  }

  test('Modell: Standardsprache ist Englisch, gespeichertes Deutsch bleibt erhalten', () => {
    equal(model.defaultState().language, 'en');
    equal(model.normalizeState(board([])).state.language, 'en');
    equal(model.normalizeState({ ...board([]), language: 'de' }).state.language, 'de');
    equal(model.normalizeState({ ...board([]), language: 'fr' }).state.language, 'en');
  });

  test('Modell: Eingaben, die gar kein Board sind, werden abgelehnt', () => {
    [null, undefined, 'x', 42, [], {}].forEach((input) => equal(model.normalizeState(input), null, String(input)));
  });

  test('Modell: ein kaputter Eintrag kostet nicht das ganze Board', () => {
    const result = model.normalizeState(board([
      { id: 'a', title: 'Wichtig', description: '', columnId: 'backlog' },
      { id: 'b', title: '', description: '', columnId: 'backlog' },
      null,
      { id: 'a', title: 'Doppelt', columnId: 'backlog' }
    ]));
    equal(result.state.projects[0].tasks.map((task) => task.title), ['Wichtig']);
    equal(result.report, { repaired: 0, skipped: 3 });
  });

  test('Modell: Eintrag mit unbekannter Spalte landet in der ersten Spalte', () => {
    const result = model.normalizeState(board([{ id: 'a', title: 'T', columnId: 'gibtsnicht' }]));
    equal(result.state.projects[0].tasks[0].columnId, 'backlog');
    equal(result.report.repaired, 1);
  });

  test('Modell: ungültige Priorität wie "constructor" wird zu "normal"', () => {
    const result = model.normalizeState(board([{ id: 'a', title: 'T', columnId: 'backlog', priority: 'constructor' }]));
    equal(result.state.projects[0].tasks[0].priority, 'normal');
    equal(result.report.repaired, 1);
    assert(!model.isPriority('toString') && !model.isPriority('__proto__') && model.isPriority('critical'));
  });

  test('Modell: unbekannte Felder werden nicht übernommen', () => {
    const result = model.normalizeState(board([{ id: 'a', title: 'T', columnId: 'backlog', extra: 'x', __proto__: { y: 1 } }]));
    equal(Object.keys(result.state.projects[0].tasks[0]).sort(), ['columnId', 'description', 'id', 'priority', 'title']);
  });

  test('Modell: doppelte Spaltennamen werden eindeutig gemacht statt alles zu verwerfen', () => {
    const result = model.normalizeState(board([], [{ id: 'a', title: 'Offen' }, { id: 'b', title: 'offen' }]));
    equal(result.state.projects[0].columns.map((column) => column.title), ['Offen', 'offen (2)']);
  });

  test('Modell: zu lange Titel werden gekürzt und gemeldet', () => {
    const result = model.normalizeState(board([{ id: 'a', title: 'x'.repeat(200), columnId: 'backlog' }]));
    equal(result.state.projects[0].tasks[0].title.length, model.LIMITS.taskTitle);
    equal(result.report.repaired, 1);
  });

  test('Modell: Spalte "done" aus älteren Daten gilt als erledigt', () => {
    const result = model.normalizeState(board([]));
    equal(result.state.projects[0].columns.map((column) => column.done), [false, true]);
  });

  test('Modell: Format Version 1 ohne Spalten und ohne Projekte wird übernommen', () => {
    const result = model.normalizeState({ version: 1, tasks: [{ id: 'a', title: 'Alt', description: 'x', columnId: 'in-work' }] });
    equal(result.state.projects[0].id, 'general');
    equal(result.state.projects[0].columns.map((column) => column.id), ['backlog', 'in-work', 'done']);
    equal(result.state.projects[0].tasks[0].columnId, 'in-work');
  });

  test('Modell: fehlendes Projekt "Allgemein" wird ergänzt und steht vorne', () => {
    const result = model.normalizeState({ projects: [{ id: 'p', title: 'Website', columns: [], tasks: [] }] });
    equal(result.state.projects.map((project) => project.id), ['general', 'p']);
  });

  // --- Speicher ---------------------------------------------------------------

  const TEST_KEY = 'arbeitsboard-unit-test';

  function withStore(fn) {
    localStorage.removeItem(TEST_KEY);
    localStorage.removeItem(`${TEST_KEY}.backup`);
    try {
      fn(ns.storage.createStore(TEST_KEY));
    } finally {
      localStorage.removeItem(TEST_KEY);
      localStorage.removeItem(`${TEST_KEY}.backup`);
    }
  }

  test('Speicher: leerer Speicher liefert ein Standardboard ohne Problem', () => withStore((store) => {
    const loaded = store.load();
    equal(loaded.problem, null);
    equal(loaded.state.projects[0].columns.length, 3);
  }));

  test('Speicher: zweiter Speichervorgang auf altem Stand wird als Konflikt abgelehnt', () => withStore((store) => {
    const state = model.defaultState();
    equal(store.save({ ...state, revision: 1 }, 0), { ok: true });
    equal(store.save({ ...state, revision: 1 }, 0), { ok: false, reason: 'conflict' });
    equal(store.save({ ...state, revision: 2 }, 1), { ok: true });
  }));

  test('Speicher: unlesbare Daten werden gesichert, bevor sie ersetzt werden können', () => withStore((store) => {
    localStorage.setItem(TEST_KEY, '{kaputt');
    const loaded = store.load();
    equal(loaded.problem.kind, 'unreadable');
    equal(loaded.problem.backupStored, true);
    equal(store.readBackup(), '{kaputt');
  }));

  test('Speicher: reparierte Daten werden gemeldet und das Original gesichert', () => withStore((store) => {
    const raw = JSON.stringify(board([{ id: 'a', title: 'Gut', columnId: 'backlog' }, { id: 'b', title: 'Schlecht', columnId: 'x' }]));
    localStorage.setItem(TEST_KEY, raw);
    const loaded = store.load();
    equal(loaded.problem.kind, 'repaired');
    equal(loaded.problem.count, 1);
    equal(store.readBackup(), raw);
    equal(loaded.state.projects[0].tasks.length, 2);
  }));

  test('Speicher: ein voller Speicher führt zu einer Fehlermeldung statt zu einer Ausnahme', () => withStore((store) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('voll', 'QuotaExceededError'); };
    try {
      const result = store.save(model.defaultState(), 0);
      equal(result.ok, false);
      equal(result.reason, 'error');
    } finally {
      Storage.prototype.setItem = original;
    }
  }));

  // --- Editor -----------------------------------------------------------------

  // Creates an editor with the given content and selects the text from
  // startText to endText (both included). Without endText the caret is placed
  // before startText; with startText === '' at the end.
  function editorWith(html, startText, endText) {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    root.innerHTML = html;
    document.body.append(root);
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const full = nodes.map((node) => node.data).join('');
    const position = (index, isEnd) => {
      let rest = index;
      for (const node of nodes) {
        if (isEnd ? rest <= node.length : rest < node.length) return [node, rest];
        rest -= node.length;
      }
      return [root, root.childNodes.length];
    };
    const range = document.createRange();
    if (startText === '') {
      range.selectNodeContents(root);
      range.collapse(false);
    } else {
      const start = full.indexOf(startText);
      assert(start >= 0, `Text ${startText} nicht gefunden`);
      range.setStart(...position(start, false));
      if (endText === undefined) {
        range.collapse(true);
      } else {
        const end = full.indexOf(endText, start) + endText.length;
        range.setEnd(...position(end, true));
      }
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { root, editor: ns.editor.createEditor(root), done: () => root.remove() };
  }

  function editorTest(name, html, startText, endText, action, expected) {
    test(`Editor: ${name}`, () => {
      const { root, editor, done } = editorWith(html, startText, endText);
      try {
        action(editor);
        equal(root.innerHTML, expected);
      } finally {
        done();
      }
    });
  }

  editorTest('Fett auf einen Teil des Textes', 'Hallo Welt', 'Welt', 'Welt', (e) => e.bold(), 'Hallo <b>Welt</b>');
  editorTest('Fett wieder entfernen', '<b>Hallo Welt</b>', 'Welt', 'Welt', (e) => e.bold(), '<b>Hallo </b>Welt');
  editorTest('Fett in der Mitte entfernen', '<b>abc</b>', 'b', 'b', (e) => e.bold(), '<b>a</b>b<b>c</b>');
  editorTest('teilweise fetter Text wird ganz fett', 'a<b>b</b>c', 'a', 'c', (e) => e.bold(), '<b>a</b><b>b</b><b>c</b>');
  editorTest('Kursiv innerhalb von Fett', '<b>abc</b>', 'b', 'b', (e) => e.italic(), '<b>a<i>b</i>c</b>');
  editorTest('neue Farbe ersetzt die alte', '<font color="#b7352a">abc</font>', 'b', 'b', (e) => e.setColor('#20251f'),
    '<font color="#b7352a">a</font><font color="#20251f">b</font><font color="#b7352a">c</font>');
  editorTest('Liste aus Zeilen mit Zeilenumbruch', 'eins<br>zwei<br>drei', 'eins', 'zwei', (e) => e.toggleList(), '<ul><li>eins</li><li>zwei</li></ul>drei');
  editorTest('Liste aus Absätzen', '<div>eins</div><div>zwei</div>', 'zwei', undefined, (e) => e.toggleList(), '<div>eins</div><ul><li>zwei</li></ul>');
  editorTest('Liste wieder auflösen', '<ul><li>eins</li><li>zwei</li></ul>', 'eins', undefined, (e) => e.toggleList(), '<div>eins</div><div>zwei</div>');
  editorTest('Liste im leeren Feld', '', '', undefined, (e) => e.toggleList(), '<ul><li><br></li></ul>');
  editorTest('Text mit Zeilenumbruch einfügen', 'ab', 'b', undefined, (e) => e.insertText('x\ny'), 'ax<br>yb');
  editorTest('Einfügen ersetzt die Auswahl', 'abc', 'b', 'b', (e) => e.insertText('X'), 'aXc');

  test('Editor: Fett ohne Auswahl wirkt auf den nächsten Text, Platzhalter wird beim Speichern entfernt', () => {
    const { root, editor, done } = editorWith('ab', '');
    try {
      editor.bold();
      const selection = window.getSelection();
      const caret = selection.getRangeAt(0);
      caret.insertNode(document.createTextNode('cd'));
      equal(sanitizeDescription(root.innerHTML), 'ab<b>cd</b>');
      equal(sanitizeDescription('ab<b>\u200B</b>'), 'ab');
    } finally {
      done();
    }
  });

  test('Editor: Strg+Z nimmt den letzten Formatierungsschritt zurück', () => {
    const { root, editor, done } = editorWith('Hallo Welt', 'Welt', 'Welt');
    try {
      editor.bold();
      equal(root.innerHTML, 'Hallo <b>Welt</b>');
      equal(editor.undo(), true);
      equal(root.innerHTML, 'Hallo Welt');
      equal(editor.undo(), false);
    } finally {
      done();
    }
  });

  test('Editor: nach eigener Eingabe überlässt Strg+Z dem Browser das Rückgängigmachen', () => {
    const { root, editor, done } = editorWith('Hallo Welt', 'Welt', 'Welt');
    try {
      editor.bold();
      root.append(' getippt');
      equal(editor.undo(), false);
    } finally {
      done();
    }
  });

  // --- Ausführen --------------------------------------------------------------

  const list = document.querySelector('#results');
  const summary = document.querySelector('#summary');
  let failed = 0;
  tests.forEach(({ name, fn }) => {
    const item = document.createElement('li');
    try {
      fn();
      item.className = 'passed';
      item.textContent = name;
    } catch (error) {
      failed += 1;
      item.className = 'failed';
      item.textContent = name;
      const detail = document.createElement('pre');
      detail.textContent = error.message;
      item.append(detail);
    }
    list.append(item);
  });
  assert(window.__xss === undefined, 'Ein Angriffsmuster hat Code ausgeführt');
  summary.textContent = failed ? `${failed} von ${tests.length} Tests fehlgeschlagen` : `Alle ${tests.length} Tests bestanden`;
  summary.className = failed ? 'failed' : 'passed';
  window.unitTestResult = { total: tests.length, failed };
})(window.Arbeitsboard);
