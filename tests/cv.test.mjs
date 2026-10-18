import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cvLinkAttrs } from '../js/content.js';
test('fallback state', () => {
  assert.deepEqual(cvLinkAttrs(false, 'header'), { href: 'https://www.linkedin.com/in/julian-bharadwaja/', target: '_blank', rel: 'noopener', download: null, text: '[ CV ↗ ]' });
  assert.equal(cvLinkAttrs(false, 'hero').text, 'CV on LinkedIn ↗');
});
test('publish state', () => {
  assert.deepEqual(cvLinkAttrs(true, 'signoff'), { href: 'assets/cv/Julian_Bharadwaja_Resume.pdf', target: null, rel: null, download: 'Julian_Bharadwaja_Resume.pdf', text: 'Download CV' });
  assert.equal(cvLinkAttrs(true, 'header').text, '[ CV ↓ ]');
});

// applyCvState writes every a[data-cv] on the page from cvLinkAttrs.
import { applyCvState } from '../js/content.js';

/** Just enough of an <a data-cv> for applyCvState: attributes and text. */
function fakeLink(slot, attrs) {
  const attributes = { 'data-cv': slot, ...attrs };
  return {
    attributes,
    textContent: '',
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = String(value); },
    removeAttribute: (name) => { delete attributes[name]; },
  };
}
const LINKEDIN = { href: 'https://www.linkedin.com/in/julian-bharadwaja/', target: '_blank', rel: 'noopener' };
const fakeDoc = (links) => ({ querySelectorAll: (sel) => (sel === 'a[data-cv]' ? links : []) });

test('applyCvState(doc, true) turns the three links into downloads of the PDF', () => {
  const links = ['header', 'hero', 'signoff'].map((slot) => fakeLink(slot, LINKEDIN));
  applyCvState(fakeDoc(links), true);
  for (const link of links) {
    assert.equal(link.getAttribute('href'), 'assets/cv/Julian_Bharadwaja_Resume.pdf');
    assert.equal(link.getAttribute('download'), 'Julian_Bharadwaja_Resume.pdf');
    assert.equal(link.getAttribute('target'), null);
    assert.equal(link.getAttribute('rel'), null);
  }
  assert.deepEqual(links.map((l) => l.textContent), ['[ CV ↓ ]', 'Download CV', 'Download CV']);
});

test('applyCvState(doc, false) puts the LinkedIn fallback back, with no download attribute', () => {
  const links = ['header', 'signoff'].map((slot) => fakeLink(slot, { href: 'assets/cv/x.pdf', download: 'x.pdf' }));
  applyCvState(fakeDoc(links), false);
  for (const link of links) {
    const { 'data-cv': _, ...rest } = link.attributes;
    assert.deepEqual(rest, LINKEDIN);
  }
  assert.deepEqual(links.map((l) => l.textContent), ['[ CV ↗ ]', 'CV on LinkedIn ↗']);
});
