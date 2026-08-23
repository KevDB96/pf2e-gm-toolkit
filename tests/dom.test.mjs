// Tests for the string half of the DOM helpers: node --test tests/
//
// esc() and rich() build HTML from data that includes player-typed names and AoN rules
// text, so they are worth pinning down even though the rest of src/dom.js needs a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brief, esc, rich, tip } from '../src/dom.js';

test('interpolated values cannot carry markup', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(esc('Rhea "the Wall" Elmheart'), 'Rhea &quot;the Wall&quot; Elmheart');
  assert.equal(esc(null), '');
});

test('a hover description is one attribute, or none at all', () => {
  assert.equal(tip('You push a creature away from you.'),
    ' data-tip="You push a creature away from you."');
  // Quotes in rules text would otherwise close the attribute early.
  assert.equal(tip('The "shove" trait'), ' data-tip="The &quot;shove&quot; trait"');
  // Too long to show: cut on a word boundary, well inside the limit.
  const long = tip('word '.repeat(80));
  assert.match(long, /^ data-tip="(word )+word…"$/);
  assert.ok(long.length < 170, long.length + ' is not brief');
  assert.equal(tip('  \n  '), '');
  assert.equal(tip(null), '');
});

test('rules text renders as paragraphs, headings and lists', () => {
  const text = [
    'Any shield you wield gains the shove trait.',
    '## Ever Ready',
    'You always gain a reaction.\nThe GM might still rule otherwise.',
    '- **Air** You can Step.\n- **Earth** Stone floats around you.'
  ].join('\n\n');

  assert.equal(rich(text), [
    '<p>Any shield you wield gains the shove trait.</p>',
    '<h4>Ever Ready</h4>',
    '<p>You always gain a reaction.<br>The GM might still rule otherwise.</p>',
    '<ul><li><b>Air</b> You can Step.</li><li><b>Earth</b> Stone floats around you.</li></ul>'
  ].join(''));
});

test('emphasis is put back but nothing else is', () => {
  assert.equal(rich('**Heightened (+1)** The damage increases by 2d6.'),
    '<p><b>Heightened (+1)</b> The damage increases by 2d6.</p>');
  assert.equal(rich('An _everlight crystal_ sheds light.'),
    '<p>An <i>everlight crystal</i> sheds light.</p>');
  // Escaping happens before the markdown goes back in, so text out of the codex cannot
  // smuggle a tag through either half.
  assert.equal(rich('<img src=x onerror=alert(1)> **bold**'),
    '<p>&lt;img src=x onerror=alert(1)&gt; <b>bold</b></p>');
  assert.equal(rich(''), '');
  assert.equal(rich(null), '');
});

test('a description keeps the mechanics and drops the scene setting', () => {
  // The Prone condition, as data/conditions.json words it: one sentence of where you are,
  // then what it does to you.
  assert.equal(
    brief("You're lying on the ground. You are off-guard and take a –2 circumstance " +
          'penalty to attack rolls.'),
    'You are off-guard and take a –2 circumstance penalty to attack rolls.');

  // Blinded opens on the mechanics, so nothing is dropped...
  assert.equal(
    brief("You can't see. All normal terrain is difficult terrain to you."),
    "You can't see. All normal terrain is difficult terrain to you.");

  // ...but the sentence the Archives cut off mid-way is left out once there is something.
  assert.equal(
    brief("You can't see. You automatically critically fail Perception checks that …"),
    "You can't see.");

  // Nothing mechanical in it at all: most spell and feat summaries are one plain sentence
  // of what the thing does, and dropping those would leave no description at all.
  assert.equal(brief('Transform into an aberration battle form.'),
    'Transform into an aberration battle form.');
  assert.equal(brief('You call down a shaft of light. It burns the wicked.'),
    'You call down a shaft of light. It burns the wicked.');

  assert.equal(brief(''), '');
  assert.equal(brief(null), '');
});

test('a description is capped, on a sentence where it can be', () => {
  const one = 'You take a –2 penalty to AC. ';
  // Whole sentences only: five fit inside 150 characters, the sixth would not.
  assert.equal(brief(one.repeat(6)).length, 5 * one.length - 1);
  // A single sentence longer than the cap is clipped at a word instead.
  const run = brief('You take a status penalty of ' + 'quite '.repeat(60) + 'a lot.');
  assert.ok(run.length <= 150);
  assert.ok(run.endsWith('…'));
  assert.doesNotMatch(run, /quit…$/);
  // A caller can ask for less room when it has something of its own to add.
  assert.equal(brief(one.repeat(6), 60).length, 2 * one.length - 1);
});
