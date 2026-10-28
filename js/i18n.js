// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  const TRANSLATIONS = {
    de: {
      documentTitle: 'Arbeitsboard', appName: 'Arbeitsboard', newProject: 'Neues Projekt', createProject: 'Projekt erstellen', editProject: 'Projekt bearbeiten', deleteProject: 'Projekt löschen', projectsLabel: 'Projekte', generalProject: 'Allgemein', newColumn: 'Neue Spalte', newEntry: '+ Neuer Eintrag', newEntryTitle: 'Neuer Eintrag ({keys})', ctrlKey: 'Strg', boardLabel: 'Kanban-Board',
      settings: 'Einstellungen', close: 'Schließen', boardNameSection: 'Name des Boards', boardNameHint: 'Erscheint oben auf der Seite und als Titel des Browser-Tabs, in jeder Sprache. Leer lassen für den Standardnamen.', versionLabel: 'Version {version}', languageSection: 'Sprache', dataSection: 'Datensicherung',
      dataHint: 'Dein Board ist nur in diesem Browser gespeichert. Exportiere es regelmäßig als Sicherung oder um es in einen anderen Browser zu übernehmen.',
      exportBoard: 'Exportieren', importBoard: 'Importieren', exportHint: 'Lädt das gesamte Board als JSON-Datei herunter.', importHint: 'Ersetzt das aktuelle Board durch den Inhalt einer JSON-Datei. Der aktuelle Stand wird vorher im Browser gesichert.', exportDone: 'Export gestartet: „{file}“.',
      titleLabel: 'Titel', descriptionLabel: 'Beschreibung', priorityLabel: 'Priorität', projectLabel: 'Projekt', projectNameLabel: 'Projektname', nameLabel: 'Name', colorLabel: 'Farbe', positionLabel: 'Position', doneColumnLabel: 'Einträge in dieser Spalte gelten als erledigt',
      formatText: 'Text formatieren', bold: 'Fett', italic: 'Kursiv', list: 'Liste', blackText: 'Normale Textfarbe', redText: 'Rote Textfarbe', descriptionPlaceholder: 'Beschreibung eingeben', columnPlaceholder: 'Zum Beispiel: Pending', projectPlaceholder: 'Zum Beispiel: Website-Relaunch',
      cancel: 'Abbrechen', save: 'Speichern', newStory: 'Neuer Eintrag', editStory: 'Eintrag bearbeiten', editColumn: 'Spalte bearbeiten', end: 'Am Ende', before: 'Vor {title}',
      ticketsLabel: 'Einträge in {title}', emptyColumn: 'Keine Einträge in dieser Spalte.', moveColumnLeft: 'Spalte nach links verschieben', moveColumnRight: 'Spalte nach rechts verschieben', moveTaskLeft: 'Eine Spalte nach links verschieben', moveTaskRight: 'Eine Spalte nach rechts verschieben', edit: 'Bearbeiten', delete: 'Löschen', taskPriority: '{type}: {title}, Priorität {priority}{due}',
      enterTitle: 'Bitte gib einen Titel ein.', enterName: 'Bitte gib einen Namen ein.', duplicateColumn: 'Eine Spalte mit diesem Namen existiert bereits.', duplicateProject: 'Ein Projekt mit diesem Namen existiert bereits.', deleteTaskConfirm: 'Eintrag "{title}" wirklich löschen?', deleteColumnConfirm: 'Spalte "{title}" wirklich löschen?', clearColumn: 'Leeren', clearColumnLabel: 'Alle Einträge in Spalte "{title}" löschen', clearColumnConfirm: 'Alle {count} Einträge in Spalte "{title}" endgültig löschen?', clearColumnConfirmOne: 'Den Eintrag in Spalte "{title}" endgültig löschen?', deleteColumnDetail: ' Die {count} enthaltenen Einträge werden nach {target} verschoben.', deleteProjectConfirm: 'Projekt "{title}" wirklich löschen? Alle {count} zugehörigen Einträge werden endgültig gelöscht.', deleteProjectConfirmOne: 'Projekt "{title}" wirklich löschen? Der zugehörige Eintrag wird endgültig gelöscht.', deleteProjectConfirmZero: 'Projekt "{title}" wirklich löschen?', deleteColumnDetailOne: ' Der enthaltene Eintrag wird nach {target} verschoben.',
      descriptionTooLong: 'Die Beschreibung ist zu lang: {length} von höchstens {max} Zeichen, Formatierung eingerechnet.',
      taskMissing: 'Diesen Eintrag gibt es nicht mehr. Er wurde vermutlich in einem anderen Tab gelöscht.',
      projectMissing: 'Dieses Projekt gibt es nicht mehr. Es wurde vermutlich in einem anderen Tab gelöscht.',
      columnMissing: 'Diese Spalte gibt es nicht mehr. Sie wurde vermutlich in einem anderen Tab gelöscht.',
      saveFailed: 'Speichern fehlgeschlagen. Die letzte Änderung wurde nicht übernommen. Vermutlich ist der Browserspeicher voll oder gesperrt.',
      saveConflict: 'Das Board wurde inzwischen in einem anderen Tab geändert. Deine letzte Änderung wurde nicht übernommen. Bitte führe sie noch einmal aus.',
      syncedFromOtherTab: 'Das Board wurde in einem anderen Tab geändert und neu geladen.',
      storageUnavailable: 'Der Browserspeicher ist nicht verfügbar. Änderungen gehen beim Schließen der Seite verloren. Sichere wichtige Daten unter „Einstellungen“ mit „Exportieren“.',
      dataRepaired: 'Die gespeicherten Daten waren teilweise fehlerhaft. {count} Einträge wurden korrigiert oder übersprungen.',
      dataRepairedOne: 'Die gespeicherten Daten waren teilweise fehlerhaft. Ein Eintrag wurde korrigiert oder übersprungen.',
      dataUnreadable: 'Die gespeicherten Daten konnten nicht gelesen werden. Es wurde ein leeres Board angelegt.',
      backupStored: ' Der ursprüngliche Stand liegt als Sicherungskopie im Browser.',
      backupFailed: ' Die Sicherungskopie konnte nicht im Browser abgelegt werden. Lade die ursprünglichen Daten jetzt herunter.',
      importBackupFailed: 'Der aktuelle Stand konnte nicht gesichert werden. Der Import wurde abgebrochen. Exportiere das Board zuerst.',
      downloadBackup: 'Ursprüngliche Daten herunterladen',
      importConfirm: 'Das aktuelle Board wird durch den Inhalt von „{file}“ ersetzt. Vorher wird der aktuelle Stand als Sicherungskopie im Browser abgelegt. Fortfahren?',
      importInvalid: 'Die Datei „{file}“ enthält kein gültiges Board.',
      importTooLarge: 'Die Datei „{file}“ ist zu groß. Erlaubt sind höchstens {max} MB.',
      importDone: 'Board aus „{file}“ importiert.',
      importRepaired: 'Board aus „{file}“ importiert. {count} fehlerhafte Einträge wurden korrigiert oder übersprungen.',
      importRepairedOne: 'Board aus „{file}“ importiert. Ein fehlerhafter Eintrag wurde korrigiert oder übersprungen.',
      closeNotice: 'Hinweis schließen',
      typeLabel: 'Typ', columnSelectLabel: 'Spalte', dueLabel: 'Fällig am', newEntryIn: 'Neuer Eintrag in {title}',
      dueOn: 'Fällig am {date}', dueToday: 'Heute fällig', dueTomorrow: 'Morgen fällig', dueOverdue: 'Überfällig seit {date}', dueShortToday: 'Heute', noDescription: 'Keine Beschreibung.', entryLocation: '{project} · {column}', dueShortTomorrow: 'Morgen',
      searchLabel: 'Einträge durchsuchen', clearSearch: 'Suche leeren', searchPlaceholder: 'Suchen …',
      appearanceSection: 'Darstellung', themeSystem: 'Wie System', themeLight: 'Hell', themeDark: 'Dunkel', filterLabel: 'Nach Typ filtern', filterPriorityLabel: 'Nach Priorität filtern', filterDue: 'Fällig', sortLabel: 'Sortierung', sortManual: 'Eigene Reihenfolge', sortDue: 'Nach Fälligkeit', sortPriority: 'Nach Priorität', filterDueHint: 'Nur überfällige sowie heute und morgen fällige Einträge', filterAll: 'Alle', filterStatus: '{shown} von {total} Einträgen angezeigt', filterStatusOne: '{shown} von 1 Eintrag angezeigt', filterStatusZero: 'Noch keine Einträge',
      emptyFiltered: 'Keine passenden Einträge. {count} sind durch den Filter ausgeblendet.', emptyFilteredOne: 'Keine passenden Einträge. Ein Eintrag ist durch den Filter ausgeblendet.',
      timeTrackingSection: 'Zeiterfassung', timeTrackingOff: 'Aus', timeTrackingOn: 'An',
      timeTrackingHint: 'Zeigt auf jedem Eintrag einen Timer, den du starten, anhalten und zurücksetzen kannst. Es läuft immer nur ein Timer: Startest du einen Timer, hält der bisher laufende an. Verschiebst du einen Eintrag in eine Spalte, deren Einträge als erledigt gelten, hält sein Timer ebenfalls an. Schaltest du die Zeiterfassung aus, verschwinden die Timer von den Einträgen und zählen nicht weiter. Die erfassten Zeiten werden dabei nicht gelöscht und erscheinen wieder, sobald du die Zeiterfassung einschaltest.',
      timeSpent: 'Erfasste Zeit', timerStart: 'Starten', timerPause: 'Anhalten', timerReset: 'Zurücksetzen',
      startTimer: 'Timer starten', pauseTimer: 'Timer anhalten', resetTimer: 'Timer zurücksetzen',
      resetTimerConfirm: 'Erfasste Zeit ({time}) von "{title}" wirklich auf 0 zurücksetzen?',
      type: { task: 'Aufgabe', story: 'Story', bug: 'Fehler', idea: 'Idee' },
      priority: { low: 'Niedrig', normal: 'Normal', high: 'Hoch', critical: 'Kritisch' }
    },
    en: {
      documentTitle: 'Work board', appName: 'Work board', newProject: 'New project', createProject: 'Create project', editProject: 'Edit project', deleteProject: 'Delete project', projectsLabel: 'Projects', generalProject: 'General', newColumn: 'New column', newEntry: '+ New entry', newEntryTitle: 'New entry ({keys})', ctrlKey: 'Ctrl', boardLabel: 'Kanban board',
      settings: 'Settings', close: 'Close', boardNameSection: 'Board name', boardNameHint: 'Shown at the top of the page and as the browser tab title, in every language. Leave it empty to use the default name.', versionLabel: 'Version {version}', languageSection: 'Language', dataSection: 'Backup',
      dataHint: 'Your board is stored only in this browser. Export it regularly as a backup or to move it to another browser.',
      exportBoard: 'Export', importBoard: 'Import', exportHint: 'Downloads the whole board as a JSON file.', importHint: 'Replaces the current board with the content of a JSON file. The current state is backed up in the browser first.', exportDone: 'Export started: "{file}".',
      titleLabel: 'Title', descriptionLabel: 'Description', priorityLabel: 'Priority', projectLabel: 'Project', projectNameLabel: 'Project name', nameLabel: 'Name', colorLabel: 'Color', positionLabel: 'Position', doneColumnLabel: 'Entries in this column count as done',
      formatText: 'Format text', bold: 'Bold', italic: 'Italic', list: 'List', blackText: 'Normal text color', redText: 'Red text color', descriptionPlaceholder: 'Enter a description', columnPlaceholder: 'For example: Pending', projectPlaceholder: 'For example: Website relaunch',
      cancel: 'Cancel', save: 'Save', newStory: 'New entry', editStory: 'Edit entry', editColumn: 'Edit column', end: 'At end', before: 'Before {title}',
      ticketsLabel: '{title} entries', emptyColumn: 'No entries in this column.', moveColumnLeft: 'Move column left', moveColumnRight: 'Move column right', moveTaskLeft: 'Move one column left', moveTaskRight: 'Move one column right', edit: 'Edit', delete: 'Delete', taskPriority: '{type}: {title}, priority {priority}{due}',
      enterTitle: 'Please enter a title.', enterName: 'Please enter a name.', duplicateColumn: 'A column with this name already exists.', duplicateProject: 'A project with this name already exists.', deleteTaskConfirm: 'Delete entry "{title}"?', deleteColumnConfirm: 'Delete column "{title}"?', clearColumn: 'Clear', clearColumnLabel: 'Delete all entries in column "{title}"', clearColumnConfirm: 'Permanently delete all {count} entries in column "{title}"?', clearColumnConfirmOne: 'Permanently delete the entry in column "{title}"?', deleteColumnDetail: ' Its {count} entries will be moved to {target}.', deleteProjectConfirm: 'Delete project "{title}"? All {count} associated entries will be permanently deleted.', deleteProjectConfirmOne: 'Delete project "{title}"? Its entry will be permanently deleted.', deleteProjectConfirmZero: 'Delete project "{title}"?', deleteColumnDetailOne: ' Its entry will be moved to {target}.',
      descriptionTooLong: 'The description is too long: {length} of at most {max} characters, formatting included.',
      taskMissing: 'This entry no longer exists. It was probably deleted in another tab.',
      projectMissing: 'This project no longer exists. It was probably deleted in another tab.',
      columnMissing: 'This column no longer exists. It was probably deleted in another tab.',
      saveFailed: 'Saving failed. Your last change was not applied. The browser storage is probably full or blocked.',
      saveConflict: 'The board was changed in another tab in the meantime. Your last change was not applied. Please do it again.',
      syncedFromOtherTab: 'The board was changed in another tab and has been reloaded.',
      storageUnavailable: 'Browser storage is not available. Changes will be lost when the page is closed. Keep important data with "Export" in the settings.',
      dataRepaired: 'The stored data was partly invalid. {count} entries were corrected or skipped.',
      dataRepairedOne: 'The stored data was partly invalid. One entry was corrected or skipped.',
      dataUnreadable: 'The stored data could not be read. An empty board was created.',
      backupStored: ' The original data is kept as a backup in the browser.',
      backupFailed: ' The backup could not be stored in the browser. Download the original data now.',
      importBackupFailed: 'The current data could not be backed up. The import was cancelled. Export the board first.',
      downloadBackup: 'Download original data',
      importConfirm: 'The current board will be replaced by the content of "{file}". The current data is stored as a backup in the browser first. Continue?',
      importInvalid: 'The file "{file}" does not contain a valid board.',
      importTooLarge: 'The file "{file}" is too large. At most {max} MB are allowed.',
      importDone: 'Board imported from "{file}".',
      importRepaired: 'Board imported from "{file}". {count} invalid entries were corrected or skipped.',
      importRepairedOne: 'Board imported from "{file}". One invalid entry was corrected or skipped.',
      closeNotice: 'Close notice',
      typeLabel: 'Type', columnSelectLabel: 'Column', dueLabel: 'Due date', newEntryIn: 'New entry in {title}',
      dueOn: 'Due {date}', dueToday: 'Due today', dueTomorrow: 'Due tomorrow', dueOverdue: 'Overdue since {date}', dueShortToday: 'Today', noDescription: 'No description.', entryLocation: '{project} · {column}', dueShortTomorrow: 'Tomorrow',
      searchLabel: 'Search entries', clearSearch: 'Clear search', searchPlaceholder: 'Search…',
      appearanceSection: 'Appearance', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', filterLabel: 'Filter by type', filterPriorityLabel: 'Filter by priority', filterDue: 'Due', sortLabel: 'Sort order', sortManual: 'Own order', sortDue: 'By due date', sortPriority: 'By priority', filterDueHint: 'Only entries that are overdue or due today or tomorrow', filterAll: 'All', filterStatus: '{shown} of {total} entries shown', filterStatusOne: '{shown} of 1 entry shown', filterStatusZero: 'No entries yet',
      emptyFiltered: 'No matching entries. {count} are hidden by the filter.', emptyFilteredOne: 'No matching entries. One entry is hidden by the filter.',
      timeTrackingSection: 'Time tracking', timeTrackingOff: 'Off', timeTrackingOn: 'On',
      timeTrackingHint: 'Adds a timer to every entry that you can start, pause and reset. Only one timer runs at a time: starting a timer pauses the one that was running. Moving an entry to a column whose entries count as done also pauses its timer. If you switch time tracking off, the timers disappear from the entries and stop counting. The recorded times are not deleted and appear again when you switch time tracking on.',
      timeSpent: 'Tracked time', timerStart: 'Start', timerPause: 'Pause', timerReset: 'Reset',
      startTimer: 'Start timer', pauseTimer: 'Pause timer', resetTimer: 'Reset timer',
      resetTimerConfirm: 'Reset the tracked time ({time}) of "{title}" to 0?',
      type: { task: 'Task', story: 'Story', bug: 'Bug', idea: 'Idea' },
      priority: { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' }
    }
  };

  const LANGUAGES = Object.keys(TRANSLATIONS);

  function translate(language, key, values = {}) {
    const dictionary = Object.hasOwn(TRANSLATIONS, language) ? TRANSLATIONS[language] : TRANSLATIONS.en;
    const value = String(key).split('.').reduce(
      (result, part) => (result && typeof result === 'object' && Object.hasOwn(result, part) ? result[part] : undefined),
      dictionary
    );
    const text = typeof value === 'string' ? value : String(key);
    return text.replace(/\{(\w+)\}/g, (_, name) => (Object.hasOwn(values, name) ? String(values[name]) : ''));
  }

  ns.i18n = Object.freeze({ TRANSLATIONS, LANGUAGES, translate });
})(window.Arbeitsboard = window.Arbeitsboard || {});
