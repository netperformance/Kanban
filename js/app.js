// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  const { translate } = ns.i18n;
  const { sanitizeDescription } = ns.sanitize;
  const model = ns.model;
  // Keep in step with "version" in package.json.
  const APP_VERSION = '0.0.9';
  const STORAGE_KEY = 'personal-kanban-board.v1';
  const MAX_IMPORT_MEGABYTES = 5;
  const INFO_NOTICE_MILLISECONDS = 6000;
  const store = ns.storage.createStore(STORAGE_KEY);

  const $ = (selector) => document.querySelector(selector);
  const board = $('.board');
  const projectTabs = $('#project-tabs');
  const projectActions = $('#project-actions');
  const filterChips = $('#filter-chips');
  const priorityChips = $('#priority-chips');
  const dueChips = $('#due-chips');
  const filterStatus = $('#filter-status');
  const searchInput = $('#search-input');
  const searchClear = $('#search-clear');
  const sortSelect = $('#sort-select');
  const noticeArea = $('#notice-area');
  const importInput = $('#import-file');
  const settingsDialog = $('#settings-dialog');
  const settingsStatus = $('#settings-status');
  const closeSettingsButton = $('#close-settings');
  const boardNameInput = $('#board-name-input');
  const settingsVersion = $('#settings-version');
  const viewDialog = $('#view-dialog');
  const storyDialog = $('#story-dialog');
  const storyForm = $('#story-form');
  const storyIdInput = $('#task-id');
  const storyTitleInput = $('#story-title');
  const storyDescriptionInput = $('#story-description');
  const editorToolbar = $('#editor-toolbar');
  const storyPriorityInput = $('#story-priority');
  const storyTypeInput = $('#story-type');
  const storyProjectInput = $('#story-project');
  const storyColumnInput = $('#story-column');
  const storyDueInput = $('#story-due');
  const storyDialogTitle = $('#story-dialog-title');
  const storyError = $('#story-error');
  const columnDialog = $('#column-dialog');
  const columnForm = $('#column-form');
  const columnIdInput = $('#column-id');
  const columnTitleInput = $('#column-title');
  const columnColorInput = $('#column-color');
  const columnDoneInput = $('#column-done');
  const columnDoneRow = $('#column-done-row');
  const columnPositionInput = $('#column-position');
  const columnPositionRow = $('#column-position-row');
  const columnDialogTitle = $('#column-dialog-title');
  const columnError = $('#column-error');
  const projectDialog = $('#project-dialog');
  const projectForm = $('#project-form');
  const projectIdInput = $('#project-id');
  const projectTitleInput = $('#project-title');
  const projectError = $('#project-error');
  const projectDialogTitle = $('#project-dialog-title');
  const saveProjectButton = $('#save-project');

  const descriptionEditor = ns.editor.createEditor(storyDescriptionInput);
  let draggedTaskId = null;
  let savedEditorRange = null;
  const initialLoad = store.load();
  let state = initialLoad.state;

  function t(key, values = {}) {
    return translate(state.language, key, values);
  }

  // Picks the singular ("...One") or zero ("...Zero") text if one exists.
  function tCount(key, count, values = {}) {
    const variant = count === 1 ? `${key}One` : count === 0 ? `${key}Zero` : key;
    const text = t(variant, { ...values, count });
    return text === variant ? t(key, { ...values, count }) : text;
  }

  function findProject(source, projectId) {
    return source.projects.find((project) => project.id === projectId) || null;
  }

  function getProject(projectId = state.activeProjectId) {
    return findProject(state, projectId) || findProject(state, model.GENERAL_PROJECT_ID);
  }

  function projectTitle(project) {
    return project.id === model.GENERAL_PROJECT_ID ? t('generalProject') : project.title;
  }

  function entryColumnId(project) {
    const backlog = project.columns.find((column) => column.id === 'backlog');
    return (backlog || project.columns[0]).id;
  }

  // ---------------------------------------------------------------------------
  // Notices

  function showNotice({ key = '', type = 'info', message, action = null }) {
    if (key) {
      noticeArea.querySelectorAll('[data-notice-key]').forEach((item) => {
        if (item.dataset.noticeKey === key) item.remove();
      });
    }
    const notice = document.createElement('div');
    notice.className = `notice notice-${type}`;
    notice.setAttribute('role', type === 'info' ? 'status' : 'alert');
    if (key) notice.dataset.noticeKey = key;
    const text = document.createElement('p');
    text.className = 'notice-text';
    text.textContent = message;
    notice.append(text);
    if (action) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'notice-action';
      actionButton.textContent = action.label;
      actionButton.addEventListener('click', action.run);
      notice.append(actionButton);
    }
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'notice-close';
    closeButton.setAttribute('aria-label', t('closeNotice'));
    closeButton.title = t('closeNotice');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => notice.remove());
    notice.append(closeButton);
    noticeArea.append(notice);
    if (type === 'info') setTimeout(() => notice.remove(), INFO_NOTICE_MILLISECONDS);
  }

  function todayStamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function downloadText(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reportLoadProblem(problem) {
    if (problem.kind === 'unavailable') {
      showNotice({ key: 'load', type: 'error', message: t('storageUnavailable') });
      return;
    }
    const message = (problem.kind === 'repaired' ? tCount('dataRepaired', problem.count) : t('dataUnreadable')) +
      (problem.backupStored ? t('backupStored') : t('backupFailed'));
    showNotice({
      key: 'load',
      type: problem.backupStored ? 'warning' : 'error',
      message,
      action: { label: t('downloadBackup'), run: () => downloadText(`arbeitsboard-sicherung-${todayStamp()}.json`, problem.raw) }
    });
  }

  // ---------------------------------------------------------------------------
  // Changing and saving the board

  // Reads the board again from storage. The language is a setting for all
  // tabs and is taken over; the open project stays as it is in this tab.
  // Returns true if the board content has changed.
  function reloadFromStorage() {
    const loaded = store.load();
    if (loaded.problem && loaded.problem.kind === 'unavailable') return false;
    // Filters and search are view settings; changing them is no change of the board content.
    const content = (source) => JSON.stringify(source.projects.map(({ id, title, columns, tasks }) => ({ id, title, columns, tasks })));
    const before = content(state);
    const { activeProjectId } = state;
    state = loaded.state;
    if (findProject(state, activeProjectId)) state.activeProjectId = activeProjectId;
    if (loaded.problem) reportLoadProblem(loaded.problem);
    applyLanguage();
    applyTheme();
    render();
    return before !== content(state);
  }

  // Every change to the board goes through commit(). The change is made on a
  // copy. Only if the copy was saved does it replace the current state, so a
  // failed save never leaves the screen and the storage out of step.
  // errorTarget: element for the error message (inside an open dialog);
  // without it the message appears as a notice.
  function commit(mutate, errorTarget = null) {
    const draft = structuredClone(state);
    mutate(draft);
    draft.revision = state.revision + 1;
    const result = store.save(draft, state.revision);
    if (result.ok) {
      state = draft;
      render();
      return true;
    }
    let message = t('saveFailed');
    if (result.reason === 'conflict') {
      reloadFromStorage();
      message = t('saveConflict');
    }
    if (errorTarget) {
      errorTarget.textContent = message;
    } else {
      showNotice({ key: 'save', type: 'error', message });
    }
    return false;
  }

  // Language, open project and the filters are view settings. They are
  // stored like the board, but they change on the screen even if they cannot
  // be stored, so the board stays usable without storage.
  function setView(mutate) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const draft = structuredClone(state);
      mutate(draft);
      draft.revision = state.revision + 1;
      const result = store.save(draft, state.revision);
      if (result.ok) {
        state = draft;
        return;
      }
      if (result.reason !== 'conflict') break;
      reloadFromStorage();
    }
    const draft = structuredClone(state);
    mutate(draft);
    state = draft;
  }

  // ---------------------------------------------------------------------------
  // Filter: entry types and search text, stored per project

  function typeOf(task) {
    return model.isType(task.type) ? task.type : model.DEFAULT_TYPE;
  }

  function projectFilter(project) {
    return model.normalizeFilter(project.filter);
  }

  function searchTerms(filter) {
    return filter.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  }

  // Plain text of a description, for the search. Cached, because the search
  // runs on every key press.
  const plainTextCache = new Map();
  function plainText(html) {
    if (!html) return '';
    if (!plainTextCache.has(html)) {
      if (plainTextCache.size > 1000) plainTextCache.clear();
      const template = document.createElement('template');
      template.innerHTML = html;
      plainTextCache.set(html, template.content.textContent);
    }
    return plainTextCache.get(html);
  }

  // Every search word must appear in the title or the description.
  function matchesSearch(task, terms) {
    if (terms.length === 0) return true;
    const text = `${task.title} ${plainText(task.description)}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  }

  function priorityOf(task) {
    return model.isPriority(task.priority) ? task.priority : 'normal';
  }

  // Due soon: overdue, due today or due tomorrow, and not in a done column.
  // These are exactly the entries whose date is highlighted on the card.
  function isDueSoon(project, task) {
    if (!model.isDate(task.due)) return false;
    const column = project.columns.find((item) => item.id === task.columnId);
    return !(column && column.done) && model.daysUntil(task.due) <= 1;
  }

  function isOverdue(project, task) {
    return isDueSoon(project, task) && model.daysUntil(task.due) < 0;
  }

  // Within a group (types, priorities) any selected value matches ("or"),
  // between the groups, the due filter and the search all must match ("and").
  function isShown(project, task, filter, terms) {
    return (filter.types.length === 0 || filter.types.includes(typeOf(task))) &&
      (filter.priorities.length === 0 || filter.priorities.includes(priorityOf(task))) &&
      (!filter.due || isDueSoon(project, task)) &&
      matchesSearch(task, terms);
  }

  function isFiltered(filter) {
    return filter.types.length > 0 || filter.priorities.length > 0 || filter.due || searchTerms(filter).length > 0;
  }

  function setFilter(projectId, changes) {
    setView((draft) => {
      const project = findProject(draft, projectId);
      if (project) project.filter = model.normalizeFilter({ ...project.filter, ...changes });
    });
    render();
  }

  function toggle(list, value) {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  // A new or changed entry must not disappear behind the filter right after
  // saving: its type and priority are added to the filter, and a search it
  // does not match is cleared.
  function keepVisible(project, task) {
    const filter = projectFilter(project);
    const extend = (list, value) => (list.length > 0 && !list.includes(value) ? [...list, value] : list);
    project.filter = model.normalizeFilter({
      types: extend(filter.types, typeOf(task)),
      priorities: extend(filter.priorities, priorityOf(task)),
      search: matchesSearch(task, searchTerms(filter)) ? filter.search : '',
      due: filter.due && isDueSoon(project, task),
      sort: filter.sort
    });
  }

  // Display order within a column. Sorting only changes what is shown; the
  // own order set by drag and drop stays stored. Entries that are equal keep
  // their own order (the sort is stable).
  function sortTasks(project, tasks) {
    const sort = projectFilter(project).sort;
    if (sort === 'due') {
      const key = (task) => (model.isDate(task.due) ? task.due : '9999-12-31');
      return [...tasks].sort((a, b) => key(a).localeCompare(key(b)));
    }
    if (sort === 'priority') {
      const rank = (task) => model.PRIORITY_FILTER_ORDER.indexOf(priorityOf(task));
      return [...tasks].sort((a, b) => rank(a) - rank(b));
    }
    return tasks;
  }

  function isManualOrder(project) {
    return projectFilter(project).sort === 'manual';
  }

  // ---------------------------------------------------------------------------
  // Due dates

  // Short date for the entry header. The year is left out if it is the current year.
  function formatDate(value, withYear = false) {
    const [year, month, day] = value.split('-').map(Number);
    const locale = state.language === 'de' ? 'de-DE' : 'en-GB';
    const options = { day: 'numeric', month: 'short' };
    if (withYear || year !== new Date().getFullYear()) options.year = 'numeric';
    return new Intl.DateTimeFormat(locale, options).format(new Date(year, month - 1, day));
  }

  // Due date of an entry: a short label for the header ("Today", "15 Jan") and
  // a full sentence for screen readers and the tooltip ("Overdue since 1 Oct 2026").
  // Entries in a done column are not highlighted.
  function dueInfo(project, task) {
    if (!model.isDate(task.due)) return null;
    const date = formatDate(task.due, true);
    const label = formatDate(task.due);
    const column = project.columns.find((item) => item.id === task.columnId);
    const days = model.daysUntil(task.due);
    if (column && column.done) return { label, text: t('dueOn', { date }), state: '' };
    if (days < 0) return { label, text: t('dueOverdue', { date }), state: 'is-overdue' };
    if (days === 0) return { label: t('dueShortToday'), text: t('dueToday'), state: 'is-soon' };
    if (days === 1) return { label: t('dueShortTomorrow'), text: t('dueTomorrow'), state: 'is-soon' };
    return { label, text: t('dueOn', { date }), state: '' };
  }

  // ---------------------------------------------------------------------------
  // Colour scheme

  function applyTheme() {
    if (state.theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = state.theme;
    }
    document.querySelectorAll('[data-theme-option]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeOption === state.theme)));
  }

  // ---------------------------------------------------------------------------
  // Rendering

  // The own board name applies to every language. Without one, the default
  // name of the current language is used.
  function applyBoardName() {
    const name = state.boardName || t('appName');
    document.querySelector('#board-name').textContent = name;
    document.title = name;
    boardNameInput.placeholder = t('appName');
    if (document.activeElement !== boardNameInput) boardNameInput.value = state.boardName;
  }

  function applyLanguage() {
    document.documentElement.lang = state.language;
    document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel)));
    document.querySelectorAll('[data-i18n-title]').forEach((element) => { element.title = t(element.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      // The description editor is no input field; its placeholder is shown via CSS from data-placeholder.
      if (element.isContentEditable) {
        element.dataset.placeholder = t(element.dataset.i18nPlaceholder);
      } else {
        element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
      }
    });
    document.querySelectorAll('[data-language]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.language === state.language)));
    settingsVersion.textContent = t('versionLabel', { version: APP_VERSION });
    applyBoardName();
  }

  // Line icons for the entry types and the due date, drawn on a 24 by 24 grid.
  const ICONS = Object.freeze({
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    calendar: ['M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7A2.5 2.5 0 0 1 6 4.5z', 'M3.5 9.5h17M8 2.5v4M16 2.5v4'],
    task: ['M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z', 'M8 12.5l3 3 5-6'],
    story: ['M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z'],
    bug: ['M12 7c2.8 0 5 2.9 5 6.5S14.8 20 12 20s-5-2.9-5-6.5S9.2 7 12 7z', 'M12 7v13M7 11H3.5M7 16H3.5M17 11h3.5M17 16h3.5M9.5 6L7.5 4M14.5 6l2-2'],
    idea: ['M9.5 18h5M10.5 21h3', 'M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z']
  });
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

  function createTypeLabel(type) {
    const label = document.createElement('span');
    label.className = `type-label type-${type}`;
    label.title = t(`type.${type}`);
    const text = document.createElement('span');
    text.className = 'type-text';
    text.textContent = t(`type.${type}`);
    label.append(createIcon(type), text);
    return label;
  }

  function createIcon(name) {
    const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
    icon.setAttribute('class', 'type-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    ICONS[name].forEach((data) => {
      const path = document.createElementNS(SVG_NAMESPACE, 'path');
      path.setAttribute('d', data);
      icon.append(path);
    });
    return icon;
  }

  function createFilterChip(value, text, count, pressed) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip';
    chip.dataset.filter = value;
    chip.setAttribute('aria-pressed', String(pressed));
    if (value !== 'all') chip.append(createIcon(value));
    const amount = document.createElement('span');
    amount.className = 'filter-count';
    amount.textContent = String(count);
    chip.append(document.createTextNode(text), amount);
    return chip;
  }

  // Priority chips carry the colours of the priority labels on the entries.
  // A selected chip gets a frame and a check mark.
  function createPriorityChip(priority, count, pressed) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `filter-chip priority-chip priority-chip-${priority}`;
    chip.dataset.priorityFilter = priority;
    chip.setAttribute('aria-pressed', String(pressed));
    if (pressed) chip.append(createIcon('check'));
    const amount = document.createElement('span');
    amount.className = 'filter-count';
    amount.textContent = String(count);
    chip.append(document.createTextNode(t(`priority.${priority}`)), amount);
    return chip;
  }

  // "Due" chip. Its number turns red as soon as an entry is overdue, so it
  // also works as a warning without being pressed.
  function createDueChip(project, pressed) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip due-chip';
    chip.dataset.dueFilter = 'due';
    chip.title = t('filterDueHint');
    chip.setAttribute('aria-pressed', String(pressed));
    const amount = document.createElement('span');
    amount.className = 'filter-count';
    amount.textContent = String(project.tasks.filter((task) => isDueSoon(project, task)).length);
    if (project.tasks.some((task) => isOverdue(project, task))) amount.classList.add('is-alert');
    chip.append(createIcon('calendar'), document.createTextNode(t('filterDue')), amount);
    return chip;
  }

  function renderFilterBar(project) {
    const filter = projectFilter(project);
    const terms = searchTerms(filter);
    const nothingSelected = filter.types.length === 0 && filter.priorities.length === 0 && !filter.due;
    const chips = [createFilterChip('all', t('filterAll'), project.tasks.length, nothingSelected)];
    model.TYPE_KEYS.forEach((type) => {
      const count = project.tasks.filter((task) => typeOf(task) === type).length;
      chips.push(createFilterChip(type, t(`type.${type}`), count, filter.types.includes(type)));
    });
    filterChips.replaceChildren(...chips);
    priorityChips.replaceChildren(...model.PRIORITY_FILTER_ORDER.map((priority) => {
      const count = project.tasks.filter((task) => priorityOf(task) === priority).length;
      return createPriorityChip(priority, count, filter.priorities.includes(priority));
    }));
    dueChips.replaceChildren(createDueChip(project, filter.due));
    // The number of shown entries is always visible, also when "All" is selected.
    const shown = project.tasks.filter((task) => isShown(project, task, filter, terms)).length;
    filterStatus.textContent = tCount('filterStatus', project.tasks.length, { shown, total: project.tasks.length });
    // While the user types, the field keeps what is typed.
    if (document.activeElement !== searchInput && searchInput.value !== filter.search) searchInput.value = filter.search;
    searchClear.hidden = searchInput.value === '';
    sortSelect.value = filter.sort;
    sortSelect.classList.toggle('is-active', filter.sort !== 'manual');
  }

  function createButton(label, text, action, id, className = 'icon-button', disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.dataset.id = id;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.disabled = disabled;
    button.textContent = text;
    return button;
  }

  function createTicket(project, task) {
    const priority = model.isPriority(task.priority) ? task.priority : 'normal';
    const type = model.isType(task.type) ? task.type : model.DEFAULT_TYPE;
    const due = dueInfo(project, task);
    const ticket = document.createElement('article');
    ticket.className = `ticket ${priority === 'critical' ? 'is-critical' : ''}`.trim();
    ticket.draggable = true;
    ticket.dataset.taskId = task.id;
    ticket.dataset.type = type;
    ticket.setAttribute('aria-label', t('taskPriority', { type: t(`type.${type}`), title: task.title, priority: t(`priority.${priority}`), due: due ? `, ${due.text}` : '' }));

    const main = document.createElement('div');
    main.className = 'ticket-main';
    const meta = document.createElement('div');
    meta.className = 'ticket-meta';
    const badge = document.createElement('span');
    badge.className = `priority-badge priority-${priority}`;
    badge.textContent = t(`priority.${priority}`);
    // Header: type on the left, due date and priority on the right.
    const metaEnd = document.createElement('div');
    metaEnd.className = 'ticket-meta-end';
    if (due) {
      const dueLabel = document.createElement('span');
      dueLabel.className = `ticket-due ${due.state}`.trim();
      dueLabel.title = due.text;
      const icon = createIcon('calendar');
      icon.setAttribute('class', 'type-icon');
      dueLabel.append(icon, document.createTextNode(due.label));
      metaEnd.append(dueLabel);
    }
    metaEnd.append(badge);
    meta.append(createTypeLabel(type), metaEnd);
    // Only the title opens the entry. The rest of the card stays free for dragging.
    // The title is the heading itself, not a button inside it: a button inside a
    // draggable card does not receive clicks reliably in every browser.
    const heading = document.createElement('h3');
    heading.className = 'ticket-title';
    heading.dataset.action = 'view-task';
    heading.dataset.id = task.id;
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    heading.title = t('openEntry');
    heading.textContent = task.title;
    main.append(meta, heading);
    if (task.description) {
      const description = document.createElement('div');
      description.className = 'ticket-description';
      // The only place where HTML is inserted. It is sanitized again right here.
      description.innerHTML = sanitizeDescription(task.description);
      main.append(description);
    }

    const footer = document.createElement('footer');
    footer.className = 'ticket-actions';
    const currentIndex = project.columns.findIndex((column) => column.id === task.columnId);
    const moveActions = document.createElement('div');
    moveActions.className = 'move-actions';
    moveActions.append(
      createButton(t('moveTaskLeft'), '<', 'move-task-left', task.id, 'icon-button', currentIndex === 0),
      createButton(t('moveTaskRight'), '>', 'move-task-right', task.id, 'icon-button', currentIndex === project.columns.length - 1)
    );
    const editActions = document.createElement('div');
    editActions.className = 'move-actions';
    editActions.append(
      createButton(t('editStory'), t('edit'), 'edit-task', task.id, 'ticket-text-button'),
      createButton(t('deleteTaskConfirm', { title: task.title }), t('delete'), 'delete-task', task.id, 'ticket-text-button delete-button')
    );
    footer.append(moveActions, editActions);
    ticket.append(main, footer);
    return ticket;
  }

  function createColumn(project, column, index) {
    const section = document.createElement('section');
    section.className = 'column';
    section.style.setProperty('--column-color', model.normalizeColor(column.color, index));
    // Ids from storage may contain any character, so the element id uses the position.
    const titleId = `column-heading-${index}`;
    section.setAttribute('aria-labelledby', titleId);

    const header = document.createElement('header');
    header.className = 'column-header';
    const headingGroup = document.createElement('div');
    headingGroup.className = 'column-heading';
    const heading = document.createElement('h2');
    heading.id = titleId;
    heading.textContent = column.title;
    const count = document.createElement('span');
    count.className = 'count';
    const tasks = project.tasks.filter((task) => task.columnId === column.id);
    const filter = projectFilter(project);
    const terms = searchTerms(filter);
    const filtered = isFiltered(filter);
    const shownTasks = sortTasks(project, tasks.filter((task) => isShown(project, task, filter, terms)));
    count.textContent = filtered ? `${shownTasks.length} / ${tasks.length}` : String(tasks.length);
    count.classList.toggle('is-filtered', filtered);
    headingGroup.append(heading, count);
    header.append(headingGroup, createButton(t('newEntryIn', { title: column.title }), '+', 'add-task', column.id, 'icon-button column-add'));

    const list = document.createElement('div');
    list.className = 'task-list';
    list.dataset.taskList = column.id;
    list.setAttribute('aria-label', t('ticketsLabel', { title: column.title }));
    if (shownTasks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = tasks.length === 0 ? t('emptyColumn') : tCount('emptyFiltered', tasks.length);
      list.append(empty);
    } else {
      shownTasks.forEach((task) => list.append(createTicket(project, task)));
    }

    const footer = document.createElement('footer');
    footer.className = 'column-footer';
    const orderActions = document.createElement('div');
    orderActions.className = 'move-actions';
    orderActions.append(
      createButton(t('moveColumnLeft'), '<', 'move-column-left', column.id, 'icon-button', index === 0),
      createButton(t('moveColumnRight'), '>', 'move-column-right', column.id, 'icon-button', index === project.columns.length - 1)
    );
    const columnActions = document.createElement('div');
    columnActions.className = 'column-actions';
    columnActions.append(
      createButton(t('editColumn'), t('edit'), 'edit-column', column.id, 'ticket-text-button'),
      createButton(t('clearColumnLabel', { title: column.title }), t('clearColumn'), 'clear-column', column.id, 'ticket-text-button delete-button', tasks.length === 0),
      createButton(t('deleteColumnConfirm', { title: column.title }), t('delete'), 'delete-column', column.id, 'ticket-text-button delete-button', project.columns.length === 1)
    );
    footer.append(orderActions, columnActions);
    section.append(header, list, footer);
    return section;
  }

  function openTaskCount(project) {
    const doneColumns = new Set(project.columns.filter((column) => column.done).map((column) => column.id));
    return project.tasks.filter((task) => !doneColumns.has(task.columnId)).length;
  }

  function render() {
    const project = getProject();
    projectTabs.replaceChildren(...state.projects.map((item) => {
      const selected = item.id === project.id;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'project-tab';
      tab.id = `project-tab-${state.projects.indexOf(item)}`;
      tab.dataset.projectId = item.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('aria-controls', 'board');
      tab.tabIndex = selected ? 0 : -1;
      tab.textContent = `${projectTitle(item)} (${openTaskCount(item)})`;
      return tab;
    }));
    board.setAttribute('aria-labelledby', `project-tab-${state.projects.indexOf(project)}`);
    projectActions.hidden = project.id === model.GENERAL_PROJECT_ID;
    renderFilterBar(project);
    board.replaceChildren(...project.columns.map((column, index) => createColumn(project, column, index)));
    compactEntryHeaders();
  }

  // An entry header holds type, due date and priority. If they do not fit into
  // one line, the type is shown as icon only, instead of breaking the line.
  // A divider before a filter group only makes sense next to another group.
  // A group that starts a new line in the filter bar is shown without it.
  function markWrappedFilterGroups() {
    [priorityChips, dueChips].forEach((group) => {
      group.classList.remove('is-line-start');
      const previous = group.previousElementSibling;
      if (previous && group.offsetTop > previous.offsetTop + previous.offsetHeight / 2) group.classList.add('is-line-start');
    });
  }

  function compactEntryHeaders() {
    markWrappedFilterGroups();
    board.querySelectorAll('.ticket-meta').forEach((meta) => {
      meta.classList.remove('is-compact');
      const end = meta.querySelector('.ticket-meta-end');
      if (end && end.offsetTop > meta.firstElementChild.offsetTop) meta.classList.add('is-compact');
    });
    // A description that does not fit fades out at the bottom, so it is clear there is more.
    board.querySelectorAll('.ticket-description').forEach((description) => {
      description.classList.toggle('is-truncated', description.scrollHeight > description.clientHeight + 1);
    });
  }

  // ---------------------------------------------------------------------------
  // Read view of an entry

  function openViewDialog(task) {
    const project = getProject();
    const column = project.columns.find((item) => item.id === task.columnId);
    const priority = priorityOf(task);
    const due = dueInfo(project, task);
    const end = document.createElement('div');
    end.className = 'ticket-meta-end';
    if (due) {
      const dueLabel = document.createElement('span');
      dueLabel.className = `ticket-due ${due.state}`.trim();
      const icon = createIcon('calendar');
      icon.setAttribute('class', 'type-icon');
      dueLabel.append(icon, document.createTextNode(due.text));
      end.append(dueLabel);
    }
    const badge = document.createElement('span');
    badge.className = `priority-badge priority-${priority}`;
    badge.textContent = t(`priority.${priority}`);
    end.append(badge);
    $('#view-meta').replaceChildren(createTypeLabel(typeOf(task)), end);
    $('#view-title').textContent = task.title;
    $('#view-location').textContent = t('entryLocation', { project: projectTitle(project), column: column ? column.title : '' });
    const description = $('#view-description');
    if (task.description) {
      description.innerHTML = sanitizeDescription(task.description);
      description.classList.remove('is-empty');
    } else {
      description.textContent = t('noDescription');
      description.classList.add('is-empty');
    }
    viewDialog.dataset.taskId = task.id;
    showDialog(viewDialog, $('#view-close'));
  }

  // Browsers send no click after a real drag. As an extra safety, a click right
  // after the end of a drag is ignored as well.
  let lastDragEnd = 0;
  function isDeliberateTitleClick() {
    return Date.now() - lastDragEnd > 300;
  }

  function openTaskFromTitle(title) {
    const task = getProject().tasks.find((item) => item.id === title.dataset.id);
    if (task) openViewDialog(task);
  }

  board.addEventListener('keydown', (event) => {
    const title = event.target.closest('.ticket-title');
    if (!title || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openTaskFromTitle(title);
  });

  let compactFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(compactFrame);
    compactFrame = requestAnimationFrame(compactEntryHeaders);
  }).observe(board);

  // ---------------------------------------------------------------------------
  // Dialogs

  // Escape closes every dialog (browser default for modal dialogs).
  function showDialog(dialog, focusTarget) {
    dialog.showModal();
    focusTarget.focus();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  // Fills the column selection with the columns of a project. Keeps the
  // preferred column if the project has it, otherwise the entry column.
  function fillColumnSelect(projectId, preferredColumnId) {
    const project = getProject(projectId);
    storyColumnInput.replaceChildren(...project.columns.map((column) => {
      const option = document.createElement('option');
      option.value = column.id;
      option.textContent = column.title;
      return option;
    }));
    storyColumnInput.value = project.columns.some((column) => column.id === preferredColumnId) ? preferredColumnId : entryColumnId(project);
  }

  // columnId: column for a new entry, from the "+" button of a column.
  function openStoryDialog(task = null, columnId = null) {
    const project = getProject();
    storyError.textContent = '';
    storyForm.reset();
    savedEditorRange = null;
    storyDialog.dataset.sourceProjectId = project.id;
    storyDialogTitle.textContent = task ? t('editStory') : t('newStory');
    storyIdInput.value = task ? task.id : '';
    storyTitleInput.value = task ? task.title : '';
    storyDescriptionInput.innerHTML = task ? sanitizeDescription(task.description) : '';
    descriptionEditor.reset();
    storyPriorityInput.value = task && model.isPriority(task.priority) ? task.priority : 'normal';
    storyTypeInput.value = task && model.isType(task.type) ? task.type : model.DEFAULT_TYPE;
    storyDueInput.value = task && model.isDate(task.due) ? task.due : '';
    storyProjectInput.replaceChildren(...state.projects.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = projectTitle(item);
      return option;
    }));
    // New entries go into the project that is open.
    storyProjectInput.value = project.id;
    fillColumnSelect(project.id, task ? task.columnId : columnId);
    showDialog(storyDialog, storyTitleInput);
  }

  function openColumnDialog(column = null) {
    const project = getProject();
    columnError.textContent = '';
    columnForm.reset();
    columnDialog.dataset.projectId = project.id;
    columnIdInput.value = column ? column.id : '';
    columnDialogTitle.textContent = column ? t('editColumn') : t('newColumn');
    columnPositionRow.hidden = Boolean(column);
    // A new column never counts as done. Only an existing column can be marked as done.
    columnDoneRow.hidden = !column;
    columnTitleInput.value = column ? column.title : '';
    columnColorInput.value = column
      ? model.normalizeColor(column.color, project.columns.indexOf(column))
      : model.nextColumnColor(project.columns);
    columnDoneInput.checked = Boolean(column && column.done);
    columnPositionInput.replaceChildren();
    if (!column) {
      const endOption = document.createElement('option');
      endOption.value = 'end';
      endOption.textContent = t('end');
      columnPositionInput.append(endOption);
      project.columns.forEach((item) => {
        const option = document.createElement('option');
        option.value = `before:${item.id}`;
        option.textContent = t('before', { title: item.title });
        columnPositionInput.append(option);
      });
    }
    showDialog(columnDialog, columnTitleInput);
  }

  function openProjectDialog(project = null) {
    projectError.textContent = '';
    projectForm.reset();
    projectIdInput.value = project ? project.id : '';
    projectTitleInput.value = project ? project.title : '';
    projectDialogTitle.textContent = project ? t('editProject') : t('newProject');
    saveProjectButton.textContent = project ? t('save') : t('createProject');
    showDialog(projectDialog, projectTitleInput);
  }

  // ---------------------------------------------------------------------------
  // Board actions

  function deleteProject() {
    const project = getProject();
    if (project.id === model.GENERAL_PROJECT_ID) return;
    if (!confirm(tCount('deleteProjectConfirm', project.tasks.length, { title: project.title }))) return;
    commit((draft) => {
      draft.projects = draft.projects.filter((item) => item.id !== project.id);
      draft.activeProjectId = model.GENERAL_PROJECT_ID;
    });
  }

  function moveColumn(columnId, offset) {
    const project = getProject();
    const index = project.columns.findIndex((column) => column.id === columnId);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= project.columns.length) return;
    commit((draft) => {
      const columns = findProject(draft, project.id).columns;
      const [column] = columns.splice(index, 1);
      columns.splice(targetIndex, 0, column);
    });
  }

  function moveTask(taskId, offset) {
    const project = getProject();
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const index = project.columns.findIndex((column) => column.id === task.columnId);
    const target = project.columns[index + offset];
    if (!target) return;
    commit((draft) => {
      findProject(draft, project.id).tasks.find((item) => item.id === taskId).columnId = target.id;
    });
  }

  // Deletes every entry of a column, also entries hidden by the filter.
  // Works the same for every column; the column itself stays.
  function clearColumn(columnId) {
    const project = getProject();
    const column = project.columns.find((item) => item.id === columnId);
    const count = project.tasks.filter((task) => task.columnId === columnId).length;
    if (!column || count === 0) return;
    if (!confirm(tCount('clearColumnConfirm', count, { title: column.title }))) return;
    commit((draft) => {
      const draftProject = findProject(draft, project.id);
      draftProject.tasks = draftProject.tasks.filter((task) => task.columnId !== columnId);
    });
  }

  function deleteColumn(columnId) {
    const project = getProject();
    const index = project.columns.findIndex((column) => column.id === columnId);
    if (index < 0 || project.columns.length === 1) return;
    const column = project.columns[index];
    const target = project.columns[index + 1] || project.columns[index - 1];
    const taskCount = project.tasks.filter((task) => task.columnId === columnId).length;
    const detail = taskCount ? tCount('deleteColumnDetail', taskCount, { target: target.title }) : '';
    if (!confirm(`${t('deleteColumnConfirm', { title: column.title })}${detail}`)) return;
    commit((draft) => {
      const draftProject = findProject(draft, project.id);
      draftProject.tasks.forEach((task) => {
        if (task.columnId === columnId) task.columnId = target.id;
      });
      draftProject.columns.splice(index, 1);
    });
  }

  function deleteTask(taskId) {
    const project = getProject();
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task || !confirm(t('deleteTaskConfirm', { title: task.title }))) return;
    commit((draft) => {
      const draftProject = findProject(draft, project.id);
      draftProject.tasks = draftProject.tasks.filter((item) => item.id !== taskId);
    });
  }

  function placeTaskAtDropPosition(taskId, targetColumnId, targetTaskId) {
    const project = getProject();
    if (!project.tasks.some((item) => item.id === taskId) || targetTaskId === taskId) return;
    if (!project.columns.some((column) => column.id === targetColumnId)) return;
    commit((draft) => {
      const draftProject = findProject(draft, project.id);
      const task = draftProject.tasks.find((item) => item.id === taskId);
      const remainingTasks = draftProject.tasks.filter((item) => item.id !== taskId);
      const targetIndex = targetTaskId ? remainingTasks.findIndex((item) => item.id === targetTaskId) : -1;
      let insertIndex = remainingTasks.length;
      if (targetIndex >= 0) {
        insertIndex = targetIndex;
      } else {
        const lastInColumn = remainingTasks.map((item, index) => ({ item, index })).filter(({ item }) => item.columnId === targetColumnId).at(-1);
        if (lastInColumn) insertIndex = lastInColumn.index + 1;
      }
      task.columnId = targetColumnId;
      remainingTasks.splice(insertIndex, 0, task);
      draftProject.tasks = remainingTasks;
    });
  }

  function activateProject(projectId, moveFocus = false) {
    if (!findProject(state, projectId)) return;
    if (projectId !== state.activeProjectId) {
      setView((draft) => { draft.activeProjectId = projectId; });
      render();
    }
    if (moveFocus) {
      const tab = [...projectTabs.querySelectorAll('[role="tab"]')].find((item) => item.dataset.projectId === projectId);
      if (tab) tab.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Export and import

  // Feedback appears inside the settings dialog, because notices on the page
  // are hidden behind the open dialog.
  function setSettingsStatus(type, message) {
    settingsStatus.className = `settings-status is-${type}`;
    settingsStatus.textContent = message;
  }

  function openSettings() {
    setSettingsStatus('info', '');
    settingsDialog.showModal();
    const current = settingsDialog.querySelector('[data-language][aria-pressed="true"]');
    (current || closeSettingsButton).focus();
  }

  function exportBoard() {
    const filename = `arbeitsboard-${todayStamp()}.json`;
    downloadText(filename, JSON.stringify(state, null, 2));
    setSettingsStatus('info', t('exportDone', { file: filename }));
  }

  async function importBoard(file) {
    if (file.size > MAX_IMPORT_MEGABYTES * 1024 * 1024) {
      setSettingsStatus('error', t('importTooLarge', { file: file.name, max: MAX_IMPORT_MEGABYTES }));
      return;
    }
    let result = null;
    try {
      result = model.normalizeState(JSON.parse(await file.text()));
    } catch {
      result = null;
    }
    if (!result) {
      setSettingsStatus('error', t('importInvalid', { file: file.name }));
      return;
    }
    if (!confirm(t('importConfirm', { file: file.name }))) return;
    if (!store.backupCurrent()) {
      setSettingsStatus('error', t('importBackupFailed'));
      return;
    }
    const imported = result.state;
    setSettingsStatus('error', '');
    const saved = commit((draft) => {
      draft.projects = imported.projects;
      draft.activeProjectId = imported.activeProjectId;
    }, settingsStatus);
    if (!saved) return;
    const count = model.problemCount(result.report);
    setSettingsStatus(count ? 'warning' : 'info', count ? tCount('importRepaired', count, { file: file.name }) : t('importDone', { file: file.name }));
  }

  // ---------------------------------------------------------------------------
  // Description editor

  function rememberEditorSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (storyDescriptionInput.contains(range.commonAncestorContainer)) savedEditorRange = range.cloneRange();
  }

  function restoreEditorSelection() {
    if (!savedEditorRange || !storyDescriptionInput.contains(savedEditorRange.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedEditorRange);
  }

  function caretRangeAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
    return null;
  }

  storyDescriptionInput.addEventListener('mouseup', rememberEditorSelection);
  storyDescriptionInput.addEventListener('keyup', rememberEditorSelection);
  storyDescriptionInput.addEventListener('input', rememberEditorSelection);
  editorToolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('button[data-command]')) event.preventDefault();
  });
  const EDITOR_COMMANDS = {
    bold: () => descriptionEditor.bold(),
    italic: () => descriptionEditor.italic(),
    list: () => descriptionEditor.toggleList(),
    color: (value) => {
      if (ns.sanitize.ALLOWED_COLORS.has(value)) descriptionEditor.setColor(value);
    }
  };

  function runEditorCommand(command, value) {
    if (!Object.hasOwn(EDITOR_COMMANDS, command)) return;
    EDITOR_COMMANDS[command](value);
    rememberEditorSelection();
  }

  editorToolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-command]');
    if (!button) return;
    storyDescriptionInput.focus();
    restoreEditorSelection();
    runEditorCommand(button.dataset.command, button.dataset.value);
  });

  // Keyboard shortcuts use the same functions as the toolbar.
  storyDescriptionInput.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'b' || key === 'i') {
      event.preventDefault();
      runEditorCommand(key === 'b' ? 'bold' : 'italic');
    } else if (key === 'u') {
      event.preventDefault();
    } else if (key === 'z' && !event.shiftKey && descriptionEditor.undo()) {
      event.preventDefault();
    }
  });

  // Formatting from browser menus (for example the context menu in Safari)
  // is routed to the editor as well, or blocked if the editor does not offer it.
  storyDescriptionInput.addEventListener('beforeinput', (event) => {
    if (!event.inputType.startsWith('format')) return;
    event.preventDefault();
    if (event.inputType === 'formatBold') runEditorCommand('bold');
    if (event.inputType === 'formatItalic') runEditorCommand('italic');
  });

  // Pasted and dropped content is inserted as plain text only.
  storyDescriptionInput.addEventListener('paste', (event) => {
    event.preventDefault();
    descriptionEditor.insertText(event.clipboardData.getData('text/plain'));
  });
  storyDescriptionInput.addEventListener('drop', (event) => {
    event.preventDefault();
    const text = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
    if (!text) return;
    const range = caretRangeAt(event.clientX, event.clientY);
    if (range && storyDescriptionInput.contains(range.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      storyDescriptionInput.focus();
      restoreEditorSelection();
    }
    descriptionEditor.insertText(text);
  });

  // ---------------------------------------------------------------------------
  // Form submits

  storyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    storyError.textContent = '';
    const title = storyTitleInput.value.trim();
    if (!title) {
      storyError.textContent = t('enterTitle');
      storyTitleInput.focus();
      return;
    }
    const description = sanitizeDescription(storyDescriptionInput.innerHTML);
    if (description.length > model.LIMITS.description) {
      const locale = state.language === 'en' ? 'en' : 'de';
      storyError.textContent = t('descriptionTooLong', { length: description.length.toLocaleString(locale), max: model.LIMITS.description.toLocaleString(locale) });
      storyDescriptionInput.focus();
      return;
    }
    const priority = model.isPriority(storyPriorityInput.value) ? storyPriorityInput.value : 'normal';
    const type = model.isType(storyTypeInput.value) ? storyTypeInput.value : model.DEFAULT_TYPE;
    const taskId = storyIdInput.value;
    const sourceProjectId = storyDialog.dataset.sourceProjectId;
    const destinationProjectId = storyProjectInput.value;
    const due = model.isDate(storyDueInput.value) ? storyDueInput.value : '';
    const destinationProject = findProject(state, destinationProjectId);
    if (!destinationProject) {
      storyError.textContent = t('projectMissing');
      return;
    }
    const columnId = storyColumnInput.value;
    if (!destinationProject.columns.some((column) => column.id === columnId)) {
      storyError.textContent = t('columnMissing');
      return;
    }
    if (taskId) {
      const sourceProject = findProject(state, sourceProjectId);
      if (!sourceProject || !sourceProject.tasks.some((item) => item.id === taskId)) {
        storyError.textContent = t('taskMissing');
        return;
      }
    }
    const saved = commit((draft) => {
      const destination = findProject(draft, destinationProjectId);
      let task;
      if (taskId) {
        const source = findProject(draft, sourceProjectId);
        task = source.tasks.find((item) => item.id === taskId);
        Object.assign(task, { type, title, description, priority, due });
        // Moved to another project or column: the entry goes to the end of the target column.
        if (destination.id !== source.id || task.columnId !== columnId) {
          source.tasks = source.tasks.filter((item) => item.id !== taskId);
          task.columnId = columnId;
          destination.tasks.push(task);
        }
      } else {
        task = { id: model.createId(), type, title, description, priority, due, columnId };
        destination.tasks.push(task);
      }
      keepVisible(destination, task);
    }, storyError);
    if (saved) closeDialog(storyDialog);
  });

  columnForm.addEventListener('submit', (event) => {
    event.preventDefault();
    columnError.textContent = '';
    const project = findProject(state, columnDialog.dataset.projectId);
    if (!project) {
      columnError.textContent = t('projectMissing');
      return;
    }
    const title = columnTitleInput.value.trim();
    if (!title) {
      columnError.textContent = t('enterName');
      columnTitleInput.focus();
      return;
    }
    const existingId = columnIdInput.value;
    if (existingId && !project.columns.some((column) => column.id === existingId)) {
      columnError.textContent = t('columnMissing');
      return;
    }
    const duplicate = project.columns.some((column) => column.id !== existingId && column.title.toLocaleLowerCase() === title.toLocaleLowerCase());
    if (duplicate) {
      columnError.textContent = t('duplicateColumn');
      columnTitleInput.focus();
      return;
    }
    const colorIndex = existingId ? project.columns.findIndex((item) => item.id === existingId) : project.columns.length;
    const color = model.normalizeColor(columnColorInput.value, colorIndex);
    const done = existingId ? columnDoneInput.checked : false;
    const position = columnPositionInput.value;
    const saved = commit((draft) => {
      const columns = findProject(draft, project.id).columns;
      if (existingId) {
        Object.assign(columns.find((item) => item.id === existingId), { title, color, done });
        return;
      }
      const beforeId = position.startsWith('before:') ? position.slice('before:'.length) : null;
      const index = columns.findIndex((item) => item.id === beforeId);
      columns.splice(index >= 0 ? index : columns.length, 0, { id: `column-${model.createId()}`, title, color, done });
    }, columnError);
    if (saved) closeDialog(columnDialog);
  });

  projectForm.addEventListener('submit', (event) => {
    event.preventDefault();
    projectError.textContent = '';
    const title = projectTitleInput.value.trim();
    const projectId = projectIdInput.value;
    if (!title) {
      projectError.textContent = t('enterName');
      projectTitleInput.focus();
      return;
    }
    const normalizedTitle = title.toLocaleLowerCase();
    const duplicate = state.projects.some((project) => project.id !== projectId &&
      (project.title.toLocaleLowerCase() === normalizedTitle ||
        (project.id === model.GENERAL_PROJECT_ID && ['general', 'allgemein'].includes(normalizedTitle))));
    if (duplicate) {
      projectError.textContent = t('duplicateProject');
      projectTitleInput.focus();
      return;
    }
    if (projectId && (projectId === model.GENERAL_PROJECT_ID || !findProject(state, projectId))) {
      projectError.textContent = t('projectMissing');
      return;
    }
    const saved = commit((draft) => {
      if (projectId) {
        findProject(draft, projectId).title = title;
        return;
      }
      const project = { id: `project-${model.createId()}`, title, ...model.defaultBoard() };
      draft.projects.push(project);
      draft.activeProjectId = project.id;
    }, projectError);
    if (saved) closeDialog(projectDialog);
  });

  // ---------------------------------------------------------------------------
  // Event wiring

  $('#create-story').addEventListener('click', () => openStoryDialog());
  $('#view-close').addEventListener('click', () => closeDialog(viewDialog));
  $('#view-edit').addEventListener('click', () => {
    const task = getProject().tasks.find((item) => item.id === viewDialog.dataset.taskId);
    closeDialog(viewDialog);
    if (task) openStoryDialog(task);
  });
  $('#cancel-story').addEventListener('click', () => closeDialog(storyDialog));
  $('#create-project').addEventListener('click', () => openProjectDialog());
  $('#cancel-project').addEventListener('click', () => closeDialog(projectDialog));
  $('#edit-project').addEventListener('click', () => openProjectDialog(getProject()));
  $('#delete-project').addEventListener('click', deleteProject);
  $('#create-column').addEventListener('click', () => openColumnDialog());
  $('#cancel-column').addEventListener('click', () => closeDialog(columnDialog));
  $('#open-settings').addEventListener('click', openSettings);
  closeSettingsButton.addEventListener('click', () => closeDialog(settingsDialog));
  $('#export-board').addEventListener('click', exportBoard);
  $('#import-board').addEventListener('click', () => {
    importInput.value = '';
    importInput.click();
  });
  importInput.addEventListener('change', () => {
    const [file] = importInput.files;
    if (file) importBoard(file);
  });

  document.querySelectorAll('[data-language]').forEach((button) => button.addEventListener('click', () => {
    const language = button.dataset.language;
    if (language === state.language || !ns.i18n.LANGUAGES.includes(language)) return;
    setView((draft) => { draft.language = language; });
    setSettingsStatus('info', '');
    applyLanguage();
    render();
  }));

  filterChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    const project = getProject();
    const value = chip.dataset.filter;
    // "All" resets types and priorities; the search stays.
    if (value === 'all') {
      setFilter(project.id, { types: [], priorities: [], due: false });
    } else {
      setFilter(project.id, { types: toggle(projectFilter(project).types, value) });
    }
    const again = [...filterChips.querySelectorAll('[data-filter]')].find((item) => item.dataset.filter === value);
    if (again) again.focus();
  });

  dueChips.addEventListener('click', (event) => {
    if (!event.target.closest('[data-due-filter]')) return;
    const project = getProject();
    setFilter(project.id, { due: !projectFilter(project).due });
    const again = dueChips.querySelector('[data-due-filter]');
    if (again) again.focus();
  });

  priorityChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-priority-filter]');
    if (!chip) return;
    const project = getProject();
    const value = chip.dataset.priorityFilter;
    setFilter(project.id, { priorities: toggle(projectFilter(project).priorities, value) });
    const again = [...priorityChips.querySelectorAll('[data-priority-filter]')].find((item) => item.dataset.priorityFilter === value);
    if (again) again.focus();
  });

  // The search filters while typing. It is stored shortly after the last key
  // press, so not every single key press is written to the storage.
  // The board name changes on the page while typing and is stored shortly
  // after the last key press.
  let boardNameSaveTimer = null;
  boardNameInput.addEventListener('input', () => {
    const boardName = model.normalizeBoardName(boardNameInput.value);
    state.boardName = boardName;
    applyBoardName();
    clearTimeout(boardNameSaveTimer);
    boardNameSaveTimer = setTimeout(() => setView((draft) => { draft.boardName = boardName; }), 400);
  });

  let searchSaveTimer = null;
  searchInput.addEventListener('input', () => {
    const project = getProject();
    const search = searchInput.value.slice(0, model.LIMITS.search);
    project.filter = model.normalizeFilter({ ...project.filter, search });
    render();
    clearTimeout(searchSaveTimer);
    searchSaveTimer = setTimeout(() => {
      setView((draft) => {
        const target = findProject(draft, project.id);
        if (target) target.filter = model.normalizeFilter({ ...target.filter, search });
      });
    }, 400);
  });

  sortSelect.addEventListener('change', () => {
    if (model.SORT_KEYS.includes(sortSelect.value)) setFilter(getProject().id, { sort: sortSelect.value });
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || searchInput.value === '') return;
    event.preventDefault();
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
  });

  // "/" jumps to the search field, unless the user is typing somewhere.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  });

  storyProjectInput.addEventListener('change', () => fillColumnSelect(storyProjectInput.value, storyColumnInput.value));

  document.querySelectorAll('[data-theme-option]').forEach((button) => button.addEventListener('click', () => {
    const theme = button.dataset.themeOption;
    if (theme === state.theme || !model.THEMES.includes(theme)) return;
    setView((draft) => { draft.theme = theme; });
    applyTheme();
  }));

  // Due dates are compared with today. When the page comes back into view
  // (for example the next morning), the highlighting is brought up to date.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });

  projectTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-project-id]');
    if (tab) activateProject(tab.dataset.projectId, true);
  });

  // Arrow keys, Home and End move between project tabs.
  projectTabs.addEventListener('keydown', (event) => {
    const tabs = [...projectTabs.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    const targets = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    activateProject(tabs[targets[event.key]].dataset.projectId, true);
  });

  board.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const project = getProject();
    const { action, id } = button.dataset;
    if (action === 'move-column-left') moveColumn(id, -1);
    if (action === 'move-column-right') moveColumn(id, 1);
    if (action === 'edit-column') {
      const column = project.columns.find((item) => item.id === id);
      if (column) openColumnDialog(column);
    }
    if (action === 'delete-column') deleteColumn(id);
    if (action === 'clear-column') clearColumn(id);
    if (action === 'move-task-left') moveTask(id, -1);
    if (action === 'move-task-right') moveTask(id, 1);
    if (action === 'edit-task') {
      const task = project.tasks.find((item) => item.id === id);
      if (task) openStoryDialog(task);
    }
    if (action === 'view-task' && isDeliberateTitleClick()) openTaskFromTitle(button);
    if (action === 'delete-task') deleteTask(id);
    if (action === 'add-task') openStoryDialog(null, id);
  });

  // Drag and drop of tickets within the board.
  function getDropTarget(list, pointerY) {
    return [...list.querySelectorAll('.ticket:not(.is-dragging)')].find((ticket) => {
      const bounds = ticket.getBoundingClientRect();
      return pointerY < bounds.top + bounds.height / 2;
    }) || null;
  }

  function clearDropIndicators() {
    document.querySelectorAll('.ticket.is-drop-before').forEach((ticket) => ticket.classList.remove('is-drop-before'));
  }

  board.addEventListener('dragstart', (event) => {
    const ticket = event.target.closest('.ticket');
    if (!ticket) return;
    // On touch screens the own finger drag above is used instead.
    if (touchDrag) {
      event.preventDefault();
      return;
    }
    draggedTaskId = ticket.dataset.taskId;
    ticket.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ticket.querySelector('h3').textContent);
  });

  board.addEventListener('dragend', (event) => {
    const ticket = event.target.closest('.ticket');
    if (ticket) ticket.classList.remove('is-dragging');
    document.querySelectorAll('.task-list.is-drag-over').forEach((list) => list.classList.remove('is-drag-over'));
    clearDropIndicators();
    draggedTaskId = null;
    lastDragEnd = Date.now();
  });

  board.addEventListener('dragover', (event) => {
    const list = event.target.closest('.task-list');
    if (!list || !draggedTaskId) return;
    event.preventDefault();
    list.classList.add('is-drag-over');
    clearDropIndicators();
    const target = getDropTarget(list, event.clientY);
    if (target) target.classList.add('is-drop-before');
  });

  board.addEventListener('dragleave', (event) => {
    const list = event.target.closest('.task-list');
    if (list && !list.contains(event.relatedTarget)) list.classList.remove('is-drag-over');
  });

  board.addEventListener('drop', (event) => {
    const list = event.target.closest('.task-list');
    // Only tickets dragged inside this board are accepted.
    if (!list || !draggedTaskId) return;
    event.preventDefault();
    list.classList.remove('is-drag-over');
    const taskId = draggedTaskId;
    const target = isManualOrder(getProject()) ? getDropTarget(list, event.clientY) : null;
    clearDropIndicators();
    placeTaskAtDropPosition(taskId, list.dataset.taskList, target ? target.dataset.taskId : null);
  });

  // ---------------------------------------------------------------------------
  // Dragging with a finger (touch screens)
  //
  // A long press on an entry starts the drag; a short touch, a tap or a swipe
  // behave as usual (scrolling, opening the title). A copy of the entry follows
  // the finger, the target column is highlighted, and near the top or bottom
  // edge of the screen the page scrolls along.

  const TOUCH_HOLD_MILLISECONDS = 450;
  const TOUCH_MOVE_TOLERANCE = 10;
  const TOUCH_EDGE = 70;
  let touchDrag = null;

  function touchListAt(x, y) {
    const element = document.elementFromPoint(x, y);
    return element ? element.closest('.task-list') : null;
  }

  function updateTouchIndicators() {
    document.querySelectorAll('.task-list.is-drag-over').forEach((list) => list.classList.remove('is-drag-over'));
    clearDropIndicators();
    const list = touchListAt(touchDrag.x, touchDrag.y);
    touchDrag.list = list;
    touchDrag.target = null;
    if (!list) return;
    list.classList.add('is-drag-over');
    if (isManualOrder(getProject())) {
      touchDrag.target = getDropTarget(list, touchDrag.y);
      if (touchDrag.target) touchDrag.target.classList.add('is-drop-before');
    }
  }

  function moveTouchGhost() {
    touchDrag.ghost.style.transform = `translate(${touchDrag.x - touchDrag.offsetX}px, ${touchDrag.y - touchDrag.offsetY}px)`;
  }

  function touchAutoScroll() {
    if (!touchDrag || !touchDrag.active) return;
    let step = 0;
    if (touchDrag.y < TOUCH_EDGE) step = -Math.ceil((TOUCH_EDGE - touchDrag.y) / 5);
    if (touchDrag.y > window.innerHeight - TOUCH_EDGE) step = Math.ceil((touchDrag.y - (window.innerHeight - TOUCH_EDGE)) / 5);
    if (step) {
      window.scrollBy(0, step);
      updateTouchIndicators();
    }
    touchDrag.frame = requestAnimationFrame(touchAutoScroll);
  }

  function startTouchDrag() {
    if (!touchDrag || !touchDrag.ticket.isConnected) return;
    const bounds = touchDrag.ticket.getBoundingClientRect();
    const ghost = touchDrag.ticket.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${bounds.width}px`;
    ghost.style.height = `${bounds.height}px`;
    document.body.append(ghost);
    Object.assign(touchDrag, { ghost, active: true, offsetX: touchDrag.x - bounds.left, offsetY: touchDrag.y - bounds.top });
    touchDrag.ticket.classList.add('is-dragging');
    moveTouchGhost();
    updateTouchIndicators();
    touchDrag.frame = requestAnimationFrame(touchAutoScroll);
  }

  function endTouchDrag() {
    if (!touchDrag) return;
    clearTimeout(touchDrag.timer);
    cancelAnimationFrame(touchDrag.frame);
    if (touchDrag.ghost) touchDrag.ghost.remove();
    touchDrag.ticket.classList.remove('is-dragging');
    document.querySelectorAll('.task-list.is-drag-over').forEach((list) => list.classList.remove('is-drag-over'));
    clearDropIndicators();
    touchDrag = null;
  }

  board.addEventListener('touchstart', (event) => {
    endTouchDrag();
    const ticket = event.target.closest('.ticket');
    if (event.touches.length !== 1 || !ticket || event.target.closest('button')) return;
    const touch = event.touches[0];
    touchDrag = { ticket, taskId: ticket.dataset.taskId, startX: touch.clientX, startY: touch.clientY, x: touch.clientX, y: touch.clientY, active: false };
    touchDrag.timer = setTimeout(startTouchDrag, TOUCH_HOLD_MILLISECONDS);
  }, { passive: true });

  board.addEventListener('touchmove', (event) => {
    if (!touchDrag) return;
    const touch = event.touches[0];
    touchDrag.x = touch.clientX;
    touchDrag.y = touch.clientY;
    if (!touchDrag.active) {
      // The finger moved before the long press was complete: this is scrolling.
      if (Math.hypot(touchDrag.x - touchDrag.startX, touchDrag.y - touchDrag.startY) > TOUCH_MOVE_TOLERANCE) endTouchDrag();
      return;
    }
    event.preventDefault();
    moveTouchGhost();
    updateTouchIndicators();
  }, { passive: false });

  board.addEventListener('touchend', (event) => {
    if (!touchDrag) return;
    if (!touchDrag.active) {
      endTouchDrag();
      return;
    }
    // A finished drag must not also count as a tap on the title.
    event.preventDefault();
    const { taskId, list, target } = touchDrag;
    endTouchDrag();
    lastDragEnd = Date.now();
    if (list) placeTaskAtDropPosition(taskId, list.dataset.taskList, target ? target.dataset.taskId : null);
  });

  board.addEventListener('touchcancel', endTouchDrag);

  // The long press must not open the browser's context menu on the entry.
  board.addEventListener('contextmenu', (event) => {
    if (touchDrag && event.target.closest('.ticket')) event.preventDefault();
  });

  store.onExternalChange(() => {
    if (reloadFromStorage()) showNotice({ key: 'sync', type: 'info', message: t('syncedFromOtherTab') });
  });

  applyLanguage();
  applyTheme();
  render();
  if (initialLoad.problem) reportLoadProblem(initialLoad.problem);
})(window.Arbeitsboard = window.Arbeitsboard || {});
