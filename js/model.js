// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  const { sanitizeDescription } = ns.sanitize;

  const SCHEMA_VERSION = 8;
  const GENERAL_PROJECT_ID = 'general';
  const LIMITS = Object.freeze({ taskTitle: 120, columnTitle: 48, projectTitle: 48, description: 10000, id: 200, search: 100 });
  // Colour scheme: light (default), dark, or following the operating system.
  const THEMES = Object.freeze(['light', 'dark', 'system']);
  const DEFAULT_THEME = 'light';
  const PRIORITY_KEYS = Object.freeze(['low', 'normal', 'high', 'critical']);
  // Entry types. The first one is the default.
  const TYPE_KEYS = Object.freeze(['task', 'story', 'bug', 'idea']);
  const DEFAULT_TYPE = TYPE_KEYS[0];
  const COLUMN_COLORS = Object.freeze(['#d95d45', '#c58b12', '#34835b', '#176b87', '#b34d79', '#6e7e24']);
  const DEFAULT_COLUMNS = Object.freeze([
    Object.freeze({ id: 'backlog', title: 'Backlog', done: false }),
    Object.freeze({ id: 'in-work', title: 'In Work', done: false }),
    Object.freeze({ id: 'done', title: 'Done', done: true })
  ]);

  function isPriority(value) {
    return typeof value === 'string' && PRIORITY_KEYS.includes(value);
  }

  function isType(value) {
    return typeof value === 'string' && TYPE_KEYS.includes(value);
  }

  // A calendar date in the form YYYY-MM-DD that really exists (no 31 February).
  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  // Whole days from today (local time) until the date. Negative means overdue.
  function daysUntil(value, today = new Date()) {
    const [year, month, day] = value.split('-').map(Number);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((new Date(year, month - 1, day) - start) / 86400000);
  }

  function colorForIndex(index) {
    return COLUMN_COLORS[Math.abs(index) % COLUMN_COLORS.length];
  }

  function isColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  }

  function normalizeColor(value, index) {
    return isColor(value) ? value.toLowerCase() : colorForIndex(index);
  }

  // First palette colour that no column of the project uses yet.
  function nextColumnColor(columns) {
    const used = new Set(columns.map((column) => String(column.color).toLowerCase()));
    return COLUMN_COLORS.find((color) => !used.has(color)) || colorForIndex(columns.length);
  }

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function defaultBoard() {
    return { columns: DEFAULT_COLUMNS.map((column, index) => ({ ...column, color: colorForIndex(index) })), tasks: [], filter: { types: [], search: '' } };
  }

  // Filter of a project: entry types and search text.
  // An empty type list means "all types". A list with every type is the same
  // as "all" and is stored as an empty list.
  function normalizeFilter(raw) {
    const types = raw && Array.isArray(raw.types) ? TYPE_KEYS.filter((type) => raw.types.includes(type)) : [];
    const search = raw && typeof raw.search === 'string' ? raw.search.slice(0, LIMITS.search) : '';
    return { types: types.length === TYPE_KEYS.length ? [] : types, search };
  }

  function defaultState() {
    return {
      version: SCHEMA_VERSION,
      revision: 0,
      language: 'en',
      theme: DEFAULT_THEME,
      activeProjectId: GENERAL_PROJECT_ID,
      projects: [{ id: GENERAL_PROJECT_ID, title: 'General', ...defaultBoard() }]
    };
  }

  function cleanId(value) {
    return typeof value === 'string' && value.trim() !== '' && value.length <= LIMITS.id ? value : '';
  }

  // Returns the trimmed text, cut to the limit. Counts a repair when text had to be cut.
  function cleanTitle(value, limit, report) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (trimmed.length <= limit) return trimmed;
    report.repaired += 1;
    return trimmed.slice(0, limit).trim();
  }

  // Makes a title unique within a set (case insensitive) by appending " (2)", " (3)" and so on.
  function uniqueTitle(title, usedTitles, limit, report) {
    let candidate = title;
    let counter = 2;
    while (usedTitles.has(candidate.toLocaleLowerCase())) {
      const suffix = ` (${counter})`;
      candidate = `${title.slice(0, limit - suffix.length).trim()}${suffix}`;
      counter += 1;
    }
    if (candidate !== title) report.repaired += 1;
    usedTitles.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  function normalizeBoard(rawColumns, rawTasks, report) {
    const columns = [];
    const columnIds = new Set();
    const columnTitles = new Set();
    (Array.isArray(rawColumns) ? rawColumns : []).forEach((raw, index) => {
      const id = cleanId(raw && raw.id);
      const title = cleanTitle(raw && raw.title, LIMITS.columnTitle, report);
      if (!id || !title || columnIds.has(id)) {
        report.skipped += 1;
        return;
      }
      columnIds.add(id);
      columns.push({
        id,
        title: uniqueTitle(title, columnTitles, LIMITS.columnTitle, report),
        color: normalizeColor(raw.color, index),
        // Older data has no done flag. There the column with the id "done" counts as done.
        done: typeof raw.done === 'boolean' ? raw.done : id === 'done'
      });
    });
    if (columns.length === 0) {
      if (Array.isArray(rawColumns) && rawColumns.length > 0) report.repaired += 1;
      defaultBoard().columns.forEach((column) => {
        columns.push(column);
        columnIds.add(column.id);
      });
    }

    const tasks = [];
    const taskIds = new Set();
    (Array.isArray(rawTasks) ? rawTasks : []).forEach((raw) => {
      const id = cleanId(raw && raw.id);
      const title = cleanTitle(raw && raw.title, LIMITS.taskTitle, report);
      if (!id || !title || taskIds.has(id)) {
        report.skipped += 1;
        return;
      }
      taskIds.add(id);
      let columnId = raw.columnId;
      if (!columnIds.has(columnId)) {
        report.repaired += 1;
        columnId = columns[0].id;
      }
      let description = '';
      if (typeof raw.description === 'string') {
        description = sanitizeDescription(raw.description);
      } else if (raw.description !== undefined && raw.description !== null) {
        report.repaired += 1;
      }
      let priority = 'normal';
      if (isPriority(raw.priority)) {
        priority = raw.priority;
      } else if (raw.priority !== undefined) {
        report.repaired += 1;
      }
      // Entries from before version 6 have no type and become tasks.
      let type = DEFAULT_TYPE;
      if (isType(raw.type)) {
        type = raw.type;
      } else if (raw.type !== undefined) {
        report.repaired += 1;
      }
      let due = '';
      if (isDate(raw.due)) {
        due = raw.due;
      } else if (raw.due !== undefined && raw.due !== '') {
        report.repaired += 1;
      }
      tasks.push({ id, type, title, description, priority, due, columnId });
    });
    if (rawTasks !== undefined && !Array.isArray(rawTasks)) report.repaired += 1;
    return { columns, tasks };
  }

  // Checks and repairs data from storage or from an import file.
  // Invalid entries are corrected where possible and skipped otherwise, so a
  // single broken entry never costs the rest of the board.
  // Returns null only if the input is not a board at all.
  function normalizeState(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const report = { repaired: 0, skipped: 0 };
    const projects = [];

    if (Array.isArray(candidate.projects)) {
      const projectIds = new Set();
      const projectTitles = new Set();
      candidate.projects.forEach((raw) => {
        const id = cleanId(raw && raw.id);
        const title = cleanTitle(raw && raw.title, LIMITS.projectTitle, report);
        if (!id || !title || projectIds.has(id)) {
          report.skipped += 1;
          return;
        }
        projectIds.add(id);
        projects.push({
          id,
          title: uniqueTitle(title, projectTitles, LIMITS.projectTitle, report),
          ...normalizeBoard(raw.columns, raw.tasks, report),
          filter: normalizeFilter(raw.filter)
        });
      });
    } else if (Array.isArray(candidate.tasks)) {
      // Format before projects existed (version 1 to 3): one board without projects.
      const columns = candidate.version === 1 ? DEFAULT_COLUMNS : candidate.columns;
      projects.push({ id: GENERAL_PROJECT_ID, title: 'General', ...normalizeBoard(columns, candidate.tasks, report), filter: normalizeFilter(null) });
    } else {
      return null;
    }

    const generalIndex = projects.findIndex((project) => project.id === GENERAL_PROJECT_ID);
    if (generalIndex < 0) {
      if (projects.length > 0) report.repaired += 1;
      projects.unshift({ id: GENERAL_PROJECT_ID, title: 'General', ...defaultBoard() });
    } else if (generalIndex > 0) {
      projects.unshift(...projects.splice(generalIndex, 1));
    }

    const projectIds = new Set(projects.map((project) => project.id));
    // Version 7 stored "system" as the default scheme. Since version 8 the default
    // is "light", so a "system" from version 7 or older becomes "light".
    const storedVersion = Number.isSafeInteger(candidate.version) ? candidate.version : 0;
    const theme = THEMES.includes(candidate.theme) && !(candidate.theme === 'system' && storedVersion < 8) ? candidate.theme : DEFAULT_THEME;
    const revision = Number.isSafeInteger(candidate.revision) && candidate.revision >= 0 ? candidate.revision : 0;
    return {
      state: {
        version: SCHEMA_VERSION,
        revision,
        // English is the default language.
        language: candidate.language === 'de' ? 'de' : 'en',
        theme,
        activeProjectId: projectIds.has(candidate.activeProjectId) ? candidate.activeProjectId : GENERAL_PROJECT_ID,
        projects
      },
      report
    };
  }

  function problemCount(report) {
    return report.repaired + report.skipped;
  }

  ns.model = Object.freeze({
    SCHEMA_VERSION, GENERAL_PROJECT_ID, LIMITS, PRIORITY_KEYS, TYPE_KEYS, DEFAULT_TYPE, THEMES, DEFAULT_THEME, COLUMN_COLORS, DEFAULT_COLUMNS,
    isPriority, isType, isDate, daysUntil, colorForIndex, isColor, normalizeColor, nextColumnColor, createId, defaultBoard, defaultState, normalizeFilter, normalizeState, problemCount
  });
})(window.Arbeitsboard = window.Arbeitsboard || {});
