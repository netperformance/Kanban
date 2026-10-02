// Copyright (c) 2026 Aaron Kreis (https://aaron.de). Licensed under the MIT License, see LICENSE.
(function (ns) {
  'use strict';

  // Only these HTML elements survive. Every attribute is removed, except the
  // colour of <font>, and only for the two colours the editor offers.
  const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'FONT']);
  // These elements are removed together with their content. All other
  // elements are unwrapped: the element goes, its text stays.
  const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'TEMPLATE']);
  const ALLOWED_COLORS = new Set(['#20251f', '#b7352a']);
  const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  const INLINE_TAGS = 'b, strong, i, em, font';
  // Invisible placeholder the editor uses to keep the caret inside an empty format.
  const PLACEHOLDER = /\u200B/g;

  function removeComments(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((comment) => comment.remove());
  }

  function sanitizeDescription(value) {
    // The content of a <template> is inert: scripts do not run, images do not
    // load and styles are not applied, so parsing cannot trigger anything.
    const template = document.createElement('template');
    template.innerHTML = String(value ?? '');
    const root = template.content;
    removeComments(root);
    root.querySelectorAll('*').forEach((element) => {
      const tag = element.tagName.toUpperCase();
      if (DROPPED_TAGS.has(tag)) {
        element.remove();
        return;
      }
      if (element.namespaceURI !== HTML_NAMESPACE || !ALLOWED_TAGS.has(tag)) {
        element.replaceWith(...element.childNodes);
        return;
      }
      const color = tag === 'FONT' ? (element.getAttribute('color') || '').toLowerCase() : '';
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (ALLOWED_COLORS.has(color)) element.setAttribute('color', color);
    });
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) textWalker.currentNode.data = textWalker.currentNode.data.replace(PLACEHOLDER, '');
    [...root.querySelectorAll(INLINE_TAGS)].reverse().forEach((element) => {
      if (element.textContent === '' && !element.querySelector('br')) element.remove();
    });
    const hasContent = root.textContent.trim() !== '' || root.querySelector('li') !== null;
    return hasContent ? template.innerHTML.trim() : '';
  }

  ns.sanitize = Object.freeze({ sanitizeDescription, ALLOWED_COLORS });
})(window.Arbeitsboard = window.Arbeitsboard || {});
