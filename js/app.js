// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  const { translate } = ns.i18n;
  const { sanitizeDescription } = ns.sanitize;
  const model = ns.model;
  const STORAGE_KEY = 'personal-kanban-board.v1';
  const MAX_IMPORT_MEGABYTES = 5;
  const INFO_NOTICE_MILLISECONDS = 6000;
  const store = ns.storage.createStore(STORAGE_KEY);

  const $ = (selector) => document.querySelector(selector);
  const board = $('.board');
  const projectTabs = $('#project-tabs');
  const projectActions = $('#project-actions');
  const noticeArea = $('#notice-area');
  const importInput = $('#import-file');
  const settingsDialog = $('#settings-dialog');
  const settingsStatus = $('#settings-status');
  const closeSettingsButton = $('#close-settings');
  const storyDialog = $('#story-dialog');
  const storyForm = $('#story-form');
  const storyIdInput = $('#task-id');
  const storyTitleInput = $('#story-title');
  const storyDescriptionInput = $('#story-description');
  const editorToolbar = $('#editor-toolbar');
  const storyPriorityInput = $('#story-priority');
  const storyProjectInput = $('#story-project');
  const storyDialogTitle = $('#story-dialog-title');
  const storyError = $('#story-error');
  const columnDialog = $('#column-dialog');
  const columnForm = $('#column-form');
  const columnIdInput = $('#column-id');
  const columnTitleInput = $('#column-title');
  const columnColorInput = $('#column-color');
  const columnDoneInput = $('#column-done');
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
    const before = JSON.stringify(state.projects);
    const { activeProjectId } = state;
    state = loaded.state;
    if (findProject(state, activeProjectId)) state.activeProjectId = activeProjectId;
    if (loaded.problem) reportLoadProblem(loaded.problem);
    applyLanguage();
    render();
    return before !== JSON.stringify(state.projects);
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

  // Language and open project are view settings. They change on the screen
  // even if they cannot be stored, so the board stays usable without storage.
  function setView(changes) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const draft = { ...state, ...changes, revision: state.revision + 1 };
      const result = store.save(draft, state.revision);
      if (result.ok) {
        state = draft;
        return;
      }
      if (result.reason !== 'conflict') break;
      reloadFromStorage();
    }
    state = { ...state, ...changes };
  }

  // ---------------------------------------------------------------------------
  // Rendering

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
    const ticket = document.createElement('article');
    ticket.className = `ticket ${priority === 'critical' ? 'is-critical' : ''}`.trim();
    ticket.draggable = true;
    ticket.dataset.taskId = task.id;
    ticket.setAttribute('aria-label', t('taskPriority', { title: task.title, priority: t(`priority.${priority}`) }));

    const main = document.createElement('div');
    main.className = 'ticket-main';
    const meta = document.createElement('div');
    meta.className = 'ticket-meta';
    const badge = document.createElement('span');
    badge.className = `priority-badge priority-${priority}`;
    badge.textContent = t(`priority.${priority}`);
    meta.append(badge);
    const heading = document.createElement('h3');
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
    count.textContent = String(tasks.length);
    headingGroup.append(heading, count);
    header.append(headingGroup);

    const list = document.createElement('div');
    list.className = 'task-list';
    list.dataset.taskList = column.id;
    list.setAttribute('aria-label', t('ticketsLabel', { title: column.title }));
    if (tasks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = t('emptyColumn');
      list.append(empty);
    } else {
      tasks.forEach((task) => list.append(createTicket(project, task)));
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
    board.replaceChildren(...project.columns.map((column, index) => createColumn(project, column, index)));
  }

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

  function openStoryDialog(task = null) {
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
    storyProjectInput.replaceChildren(...state.projects.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = projectTitle(item);
      return option;
    }));
    // New entries go into the project that is open.
    storyProjectInput.value = project.id;
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
      setView({ activeProjectId: projectId });
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
    const taskId = storyIdInput.value;
    const sourceProjectId = storyDialog.dataset.sourceProjectId;
    const destinationProjectId = storyProjectInput.value;
    if (!findProject(state, destinationProjectId)) {
      storyError.textContent = t('projectMissing');
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
      if (!taskId) {
        destination.tasks.push({ id: model.createId(), title, description, priority, columnId: entryColumnId(destination) });
        return;
      }
      const source = findProject(draft, sourceProjectId);
      const task = source.tasks.find((item) => item.id === taskId);
      Object.assign(task, { title, description, priority });
      if (destination.id !== source.id) {
        source.tasks = source.tasks.filter((item) => item.id !== taskId);
        task.columnId = entryColumnId(destination);
        destination.tasks.push(task);
      }
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
    const done = columnDoneInput.checked;
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
    setView({ language });
    setSettingsStatus('info', '');
    applyLanguage();
    render();
  }));

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
    const button = event.target.closest('button[data-action]');
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
    if (action === 'move-task-left') moveTask(id, -1);
    if (action === 'move-task-right') moveTask(id, 1);
    if (action === 'edit-task') {
      const task = project.tasks.find((item) => item.id === id);
      if (task) openStoryDialog(task);
    }
    if (action === 'delete-task') deleteTask(id);
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
    const target = getDropTarget(list, event.clientY);
    clearDropIndicators();
    placeTaskAtDropPosition(taskId, list.dataset.taskList, target ? target.dataset.taskId : null);
  });

  store.onExternalChange(() => {
    if (reloadFromStorage()) showNotice({ key: 'sync', type: 'info', message: t('syncedFromOtherTab') });
  });

  applyLanguage();
  render();
  if (initialLoad.problem) reportLoadProblem(initialLoad.problem);
})(window.Arbeitsboard = window.Arbeitsboard || {});
