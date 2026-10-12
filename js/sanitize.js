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

  // Web addresses in a description become clickable links, but only for
  // display on the card and in the read view. The stored description keeps
  // plain text, so the sanitizer still allows no <a> element at all.
  // Only http and https are linked; an address that starts with www. gets
  // https://. Links open in a new tab without access to this page.
  const ADDRESS_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
  // Punctuation at the end usually ends the sentence, not the address.
  const TRAILING_PUNCTUATION = /[.,;:!?'\u00AB\u00BB\u201C\u201D\u201E\u2018\u2019]+$/;

  function count(text, character) {
    return text.split(character).length - 1;
  }

  // Removes trailing punctuation and a closing bracket that has no opening
  // one in the address, as in "(see https://example.com)".
  function trimAddress(text) {
    let address = text;
    let previous;
    do {
      previous = address;
      address = address.replace(TRAILING_PUNCTUATION, '');
      if (address.endsWith(')') && count(address, ')') > count(address, '(')) address = address.slice(0, -1);
    } while (address !== previous);
    return address;
  }

  function toHref(address) {
    try {
      const url = new URL(/^www\./i.test(address) ? `https://${address}` : address);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
    } catch {
      return null;
    }
  }

  function createLink(href, text) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    // Dragging that starts on a link moves the card, not the address.
    link.draggable = false;
    link.textContent = text;
    return link;
  }

  // Expects sanitized HTML. Adds nothing but <a> elements built here.
  function linkify(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html ?? '');
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.data;
      const parts = [];
      let last = 0;
      let match;
      ADDRESS_PATTERN.lastIndex = 0;
      while ((match = ADDRESS_PATTERN.exec(text))) {
        const address = trimAddress(match[0]);
        const href = toHref(address);
        if (!href) continue;
        if (match.index > last) parts.push(document.createTextNode(text.slice(last, match.index)));
        parts.push(createLink(href, address));
        last = match.index + address.length;
        ADDRESS_PATTERN.lastIndex = last;
      }
      if (parts.length === 0) return;
      if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
      node.replaceWith(...parts);
    });
    return template.innerHTML;
  }

  ns.sanitize = Object.freeze({ sanitizeDescription, linkify, ALLOWED_COLORS });
})(window.Arbeitsboard = window.Arbeitsboard || {});
