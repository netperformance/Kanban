// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  // Formatting for the description field without the deprecated
  // document.execCommand(). All changes use the standard Selection and Range
  // interfaces and produce only elements the sanitizer keeps:
  // <b>, <i>, <font color>, <ul>/<li>, <div> and <br>.

  const FORMAT_TAGS = Object.freeze({ bold: ['B', 'STRONG'], italic: ['I', 'EM'], color: ['FONT'] });
  const NEW_TAG = Object.freeze({ bold: 'b', italic: 'i' });
  const BLOCK_TAGS = new Set(['DIV', 'P', 'UL', 'OL']);
  const LIST_TAGS = ['UL', 'OL'];
  const INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'FONT']);
  // Placeholder character for a format chosen without selected text. It lets
  // the caret sit inside an empty <b> so the next typed text is bold. The
  // sanitizer removes it when the description is saved.
  const PLACEHOLDER = '\u200B';
  const HISTORY_LIMIT = 50;

  function createEditor(root) {
    const history = [];

    function isElement(node, tags) {
      return node && node.nodeType === Node.ELEMENT_NODE && tags.includes(node.tagName);
    }

    // Closest element with one of the tags, from node up to (not including) root.
    function closestWithin(node, tags) {
      for (let current = node; current && current !== root; current = current.parentNode) {
        if (isElement(current, tags)) return current;
      }
      return null;
    }

    function currentRange() {
      const selection = window.getSelection();
      if (!selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      return root.contains(range.commonAncestorContainer) ? range : null;
    }

    function rangeAtEnd() {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      return range;
    }

    function select(range) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function placeCaret(node, offset) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      select(range);
    }

    function removeEmptyInlineElements() {
      [...root.querySelectorAll('b, strong, i, em, font')].reverse().forEach((element) => {
        if (element.textContent === '' && !element.querySelector('br')) element.remove();
      });
    }

    // Runs a change and records it for undo.
    function change(apply) {
      const before = root.innerHTML;
      apply();
      removeEmptyInlineElements();
      root.normalize();
      const after = root.innerHTML;
      if (before === after) return;
      history.push({ before, after });
      if (history.length > HISTORY_LIMIT) history.shift();
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function hasContent(node) {
      return node.textContent !== '' || Boolean(node.querySelector && node.querySelector('br'));
    }

    // Splits the text nodes at both ends of the range, so that the range
    // covers whole text nodes only.
    function splitBoundaries(range) {
      let { startContainer, startOffset, endContainer, endOffset } = range;
      if (endContainer.nodeType === Node.TEXT_NODE && endOffset > 0 && endOffset < endContainer.length) {
        endContainer.splitText(endOffset);
      }
      if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0 && startOffset < startContainer.length) {
        const second = startContainer.splitText(startOffset);
        if (endContainer === startContainer) {
          endContainer = second;
          endOffset -= startOffset;
        }
        startContainer = second;
        startOffset = 0;
      }
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);
    }

    // Text nodes the range really covers. visibleOnly skips pure whitespace.
    function textNodesIn(range, visibleOnly) {
      const container = range.commonAncestorContainer;
      const candidates = [];
      if (container.nodeType === Node.TEXT_NODE) {
        candidates.push(container);
      } else {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) candidates.push(walker.currentNode);
      }
      return candidates.filter((node) => {
        if (!range.intersectsNode(node)) return false;
        if (node === range.startContainer && range.startOffset >= node.length) return false;
        if (node === range.endContainer && range.endOffset === 0) return false;
        const text = node.data.replaceAll(PLACEHOLDER, '');
        return visibleOnly ? text.trim() !== '' : text !== '';
      });
    }

    function isFormatted(range, tags) {
      if (range.collapsed) return Boolean(closestWithin(range.startContainer, tags));
      const nodes = textNodesIn(range, true);
      return nodes.length > 0 && nodes.every((node) => closestWithin(node, tags));
    }

    function wrap(node, createWrapper) {
      const wrapper = createWrapper();
      node.before(wrapper);
      wrapper.append(node);
    }

    // Takes a node out of every surrounding element with one of the tags.
    // The parts before and after the node keep their format.
    function isolate(node, tags) {
      let ancestor = closestWithin(node.parentNode, tags);
      while (ancestor) {
        const head = document.createRange();
        head.setStart(ancestor, 0);
        head.setEndBefore(node);
        const tail = document.createRange();
        tail.setStartAfter(node);
        tail.setEnd(ancestor, ancestor.childNodes.length);
        const headContent = head.extractContents();
        const tailContent = tail.extractContents();
        if (hasContent(headContent)) {
          const copy = ancestor.cloneNode(false);
          copy.append(headContent);
          ancestor.before(copy);
        }
        if (hasContent(tailContent)) {
          const copy = ancestor.cloneNode(false);
          copy.append(tailContent);
          ancestor.after(copy);
        }
        ancestor.replaceWith(...ancestor.childNodes);
        ancestor = closestWithin(node.parentNode, tags);
      }
    }

    // Applies (createWrapper given) or removes (createWrapper null) an inline
    // format. replace: remove the same format first (used for colours, so a
    // new colour replaces the old one instead of being nested inside it).
    function applyInline(tags, createWrapper, replace = false) {
      const range = currentRange();
      if (!range) return;
      change(() => {
        if (range.collapsed) {
          const placeholder = document.createTextNode(PLACEHOLDER);
          range.insertNode(placeholder);
          if (!createWrapper || replace) isolate(placeholder, tags);
          if (createWrapper) wrap(placeholder, createWrapper);
          placeCaret(placeholder, placeholder.length);
          return;
        }
        splitBoundaries(range);
        const nodes = textNodesIn(range, false);
        if (nodes.length === 0) return;
        nodes.forEach((node) => {
          if (!createWrapper || replace) isolate(node, tags);
          if (createWrapper && !closestWithin(node.parentNode, tags)) wrap(node, createWrapper);
        });
        const selection = document.createRange();
        selection.setStart(nodes[0], 0);
        const last = nodes[nodes.length - 1];
        selection.setEnd(last, last.length);
        select(selection);
      });
    }

    function toggleInline(format) {
      const range = currentRange();
      if (!range) return;
      const tags = FORMAT_TAGS[format];
      applyInline(tags, isFormatted(range, tags) ? null : () => document.createElement(NEW_TAG[format]));
    }

    function setColor(color) {
      applyInline(FORMAT_TAGS.color, () => {
        const font = document.createElement('font');
        font.setAttribute('color', color);
        return font;
      }, true);
    }

    // Lines on the top level of the editor: block elements are one line each,
    // inline content runs up to and including the next <br>.
    function topLevelLines() {
      const lines = [];
      let current = [];
      const flush = () => {
        if (current.length) lines.push(current);
        current = [];
      };
      [...root.childNodes].forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)) {
          flush();
          lines.push([node]);
          return;
        }
        current.push(node);
        if (isElement(node, ['BR'])) flush();
      });
      flush();
      return lines;
    }

    function linesInRange(range, lines) {
      const touched = lines.filter((line) => line.some((node) => range.intersectsNode(node)));
      if (touched.length) return touched;
      // Caret between two top-level nodes: take the line before it.
      if (range.startContainer === root) {
        const node = root.childNodes[Math.max(0, range.startOffset - 1)];
        const line = lines.find((item) => item.includes(node));
        if (line) return [line];
      }
      return lines.length ? [lines[lines.length - 1]] : [];
    }

    function unlist(list) {
      const blocks = [...list.children].filter((item) => item.tagName === 'LI').map((item) => {
        const block = document.createElement('div');
        block.append(...item.childNodes);
        if (!block.childNodes.length) block.append(document.createElement('br'));
        return block;
      });
      list.replaceWith(...blocks);
      if (blocks.length) {
        const range = document.createRange();
        range.setStart(blocks[0], 0);
        range.setEnd(blocks[blocks.length - 1], blocks[blocks.length - 1].childNodes.length);
        select(range);
      }
    }

    function listify(range) {
      const list = document.createElement('ul');
      const lines = linesInRange(range, topLevelLines());
      if (lines.length === 0) {
        const item = document.createElement('li');
        item.append(document.createElement('br'));
        list.append(item);
        root.append(list);
        placeCaret(item, 0);
        return;
      }
      lines[0][0].before(list);
      lines.forEach((line) => {
        if (line.length === 1 && isElement(line[0], LIST_TAGS)) {
          list.append(...line[0].children);
          line[0].remove();
          return;
        }
        const item = document.createElement('li');
        line.forEach((node) => {
          if (isElement(node, ['DIV', 'P'])) {
            item.append(...node.childNodes);
            node.remove();
          } else if (isElement(node, ['BR'])) {
            node.remove();
          } else {
            item.append(node);
          }
        });
        if (!item.childNodes.length) item.append(document.createElement('br'));
        list.append(item);
      });
      const range2 = document.createRange();
      range2.setStart(list.firstElementChild, 0);
      range2.setEnd(list.lastElementChild, list.lastElementChild.childNodes.length);
      select(range2);
    }

    function toggleList() {
      const range = currentRange() || rangeAtEnd();
      change(() => {
        const item = closestWithin(range.startContainer, ['LI']);
        const list = item && closestWithin(item, LIST_TAGS);
        if (list) {
          unlist(list);
        } else {
          listify(range);
        }
      });
    }

    // Inserts plain text at the caret. Line breaks become <br>.
    function insertText(text) {
      const range = currentRange() || rangeAtEnd();
      change(() => {
        range.deleteContents();
        const fragment = document.createDocumentFragment();
        let last = null;
        String(text).replace(/\r\n?/g, '\n').split('\n').forEach((part, index) => {
          if (index > 0) {
            last = document.createElement('br');
            fragment.append(last);
          }
          if (part) {
            last = document.createTextNode(part);
            fragment.append(last);
          }
        });
        if (!last) return;
        range.insertNode(fragment);
        const caret = document.createRange();
        caret.setStartAfter(last);
        caret.collapse(true);
        select(caret);
      });
    }

    // Undoes the last formatting step, as long as nothing was typed after it.
    // Returns false if there is nothing of its own to undo, so the browser's
    // own undo for typed text can take over.
    function undo() {
      const last = history[history.length - 1];
      if (!last || root.innerHTML !== last.after) return false;
      history.pop();
      root.innerHTML = last.before;
      select(rangeAtEnd());
      root.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    function reset() {
      history.length = 0;
    }

    return Object.freeze({
      bold: () => toggleInline('bold'),
      italic: () => toggleInline('italic'),
      setColor,
      toggleList,
      insertText,
      undo,
      reset
    });
  }

  ns.editor = Object.freeze({ createEditor, PLACEHOLDER, INLINE_TAGS });
})(window.Arbeitsboard = window.Arbeitsboard || {});
