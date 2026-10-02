// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  const { defaultState, normalizeState, problemCount } = ns.model;

  // Reads and writes the board in localStorage.
  //
  // Protection against data loss:
  // - Damaged data is repaired entry by entry. Before the repaired version can
  //   overwrite it, the original text is copied to a backup key.
  // - Every save increases a revision number. If another tab has saved in the
  //   meantime, the save is refused instead of overwriting that tab's changes.
  // - Errors (storage full or blocked) are returned to the caller instead of
  //   being thrown, so the interface can report them.
  function createStore(key) {
    const backupKey = `${key}.backup`;

    function storage() {
      return window.localStorage;
    }

    function writeBackup(raw) {
      try {
        storage().setItem(backupKey, raw);
        return true;
      } catch {
        return false;
      }
    }

    // Returns { state, problem } where problem is null or
    // { kind: 'unavailable' | 'unreadable' | 'repaired', count, raw, backupStored }.
    function load() {
      let raw;
      try {
        raw = storage().getItem(key);
      } catch {
        return { state: defaultState(), problem: { kind: 'unavailable' } };
      }
      if (raw === null) return { state: defaultState(), problem: null };
      let result = null;
      try {
        result = normalizeState(JSON.parse(raw));
      } catch {
        result = null;
      }
      if (!result) {
        // Keep the revision of the damaged data unknown (0), so the next save may replace it.
        return { state: defaultState(), problem: { kind: 'unreadable', raw, backupStored: writeBackup(raw) } };
      }
      const count = problemCount(result.report);
      if (count > 0) {
        return { state: result.state, problem: { kind: 'repaired', count, raw, backupStored: writeBackup(raw) } };
      }
      return { state: result.state, problem: null };
    }

    function storedRevision() {
      const raw = storage().getItem(key);
      if (raw === null) return 0;
      try {
        const revision = JSON.parse(raw).revision;
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
      } catch {
        return 0;
      }
    }

    // Saves nextState if the stored revision still equals baseRevision.
    // Returns { ok: true } or { ok: false, reason: 'conflict' | 'error', error }.
    function save(nextState, baseRevision) {
      try {
        if (storedRevision() !== baseRevision) return { ok: false, reason: 'conflict' };
        storage().setItem(key, JSON.stringify(nextState));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: 'error', error };
      }
    }

    function readBackup() {
      try {
        return storage().getItem(backupKey);
      } catch {
        return null;
      }
    }

    function backupCurrent() {
      try {
        const raw = storage().getItem(key);
        return raw === null ? true : writeBackup(raw);
      } catch {
        return false;
      }
    }

    function onExternalChange(callback) {
      window.addEventListener('storage', (event) => {
        if (event.storageArea !== null && event.storageArea !== undefined) {
          try {
            if (event.storageArea !== storage()) return;
          } catch {
            return;
          }
        }
        if (event.key === key || event.key === null) callback();
      });
    }

    return Object.freeze({ key, backupKey, load, save, readBackup, backupCurrent, onExternalChange });
  }

  ns.storage = Object.freeze({ createStore });
})(window.Arbeitsboard = window.Arbeitsboard || {});
