# Work board

A personal Kanban board that runs entirely in your browser. No server, no account, no tracking. Open `board.html` and start working; your data never leaves your browser.

The interface is available in English and German (German name: *Arbeitsboard*).

![Work board with four columns and three projects](docs/screenshot.png)

## Features

### Board

- **Projects:** separate boards for different topics, shown as tabs. The project *General* always exists.
- **Columns:** create, rename, recolour, reorder and delete. Entries in a deleted column move to the neighbouring column.
- **Done columns:** mark any column as done. The tab of each project shows how many open entries it has.
- **Entries:** title, formatted description and one of four priorities (low, normal, high, critical). Critical entries get a red frame.
- **Entry types:** task (default), story, bug and idea. Each type has its own icon and label, while priorities use colour, so type and priority are never confused.
- **Drag and drop** to move entries between and within columns, plus buttons to move them one column left or right.
- **Move entries between projects** from the edit dialog.
- **Filter by type:** show all entries, a single type or any combination, for example only bugs or bugs and tasks. Each project keeps its own filter, and the filter is remembered for the next visit. The filter bar always says how many entries are shown, and while a filter is active the column counters read "shown / total".

### Description editor

- Bold, italic, bulleted lists and two text colours.
- Keyboard shortcuts: <kbd>Ctrl</kbd>+<kbd>B</kbd> for bold, <kbd>Ctrl</kbd>+<kbd>I</kbd> for italic and <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo the last formatting step. On a Mac, use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd>.
- Pasted or dropped content is inserted as plain text, so no foreign formatting or code ends up in an entry.
- Built on the standard Selection and Range APIs, without the deprecated `document.execCommand()`.

### Your data

- **Stored locally** in the browser (`localStorage`). Nothing is sent anywhere.
- **Export and import** the whole board as a JSON file under *Settings*. Before an import replaces the board, the current state is backed up in the browser.
- **Self-repairing storage:** if stored data is damaged, only the broken entries are corrected or skipped. The original data is kept as a backup and can be downloaded.
- **Several tabs at once:** open tabs stay in sync. If two tabs change the board at the same moment, the second change is rejected instead of silently overwriting the first.
- **Clear error messages** when the browser storage is full or blocked. The board stays usable in that case.

### Settings

- Language: English (default) or German.
- Export and import of the board.

### Security

- Strict Content Security Policy: only the app's own scripts and styles may run, no external requests.
- Descriptions pass an allowlist sanitizer: only the formatting the editor offers survives, every other element and attribute is removed.
- No runtime dependencies and no build step.

### Accessibility

- All functions work with the keyboard. Project tabs support the arrow keys, <kbd>Home</kbd> and <kbd>End</kbd>.
- <kbd>Esc</kbd> closes every dialog.
- Buttons and regions have accessible labels; reduced motion settings are respected.

## Getting started

1. Download or clone this repository.
2. Open `board.html` in your browser. A double-click is enough; no web server is needed.

You can also put the files on any static web host. Note that each browser and each address (for example `file://` versus `https://`) has its own storage, so a board created in one place does not appear in another. Use export and import to move it.

### Back up your board

The board lives only in the browser you use. Clearing your browser data deletes it. Export it regularly under *Settings*.

### Browser support

Current versions of Chrome, Edge, Firefox and Safari (Chrome and Edge 98 or later, Firefox 94 or later, Safari 15.4 or later). The automated tests run in Chromium.

## Development

The app is plain HTML, CSS and JavaScript without a build step. The scripts are loaded as classic scripts, so the board also works when opened directly from disk.

| Path | Content |
| --- | --- |
| `board.html` | Page structure and dialogs |
| `styles.css` | All styles |
| `js/i18n.js` | English and German texts |
| `js/sanitize.js` | Allowlist sanitizer for descriptions |
| `js/model.js` | Data model, validation and repair of stored data |
| `js/storage.js` | Reading and writing `localStorage`, backups, conflict detection |
| `js/editor.js` | Formatting in the description editor |
| `js/app.js` | User interface and event handling |
| `tests/unit.html` | Module tests that run in any browser |
| `tests/board.spec.mjs` | Browser tests with Playwright |

### Running the tests

Module tests: open `tests/unit.html` in a browser. No installation needed.

All tests, including the module tests, with [Playwright](https://playwright.dev) and Node.js:

```sh
npm install
npx playwright install chromium
npm test
```

## License

[MIT](LICENSE). Copyright (c) 2026 Aaron Kreis, [aaron.de](https://aaron.de).

You may use, change and share this project freely, as long as the copyright notice and the license text stay with it.
