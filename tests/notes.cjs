const assert = require('node:assert/strict');
const {test} = require('node:test');
const Backup = require('../static/backup.js');
const KEY = 'quiz_question_notes_v1';
const storage = () => {
  const map = new Map();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  };
};
const snapshot = notes => {
  const local = storage();
  local.setItem(KEY, JSON.stringify(notes));
  return Backup.capture(local);
};

test('notes survive export/import without credentials and stay isolated by bank', () => {
  const local = storage();
  local.setItem(KEY, JSON.stringify({one: {'001': {text: '<b>note</b>\nsecond line', updatedAt: 1}},
    two: {'001': {text: 'another bank', updatedAt: 2}}}));
  local.setItem('quiz_gist_sync_cfg_v1', JSON.stringify({token: 'secret'}));
  const backup = Backup.capture(local);
  const other = storage();
  Backup.restore(other, JSON.parse(JSON.stringify(backup)));
  assert.equal(other.getItem(KEY), local.getItem(KEY));
  assert(!JSON.stringify(backup).includes('secret'));
});

test('latest edit wins in either sync direction, including a cleared note', () => {
  const old = snapshot({one: {'001': {text: 'old note', updatedAt: 1}}});
  const edited = snapshot({one: {'001': {text: 'new note', updatedAt: 2}}});
  const cleared = snapshot({one: {'001': {text: '', updatedAt: 3}}});
  for (const [a, b, expected] of [[old, edited, 'new note'], [edited, old, 'new note'],
    [edited, cleared, ''], [cleared, old, '']]) {
    assert.equal(Backup.merge(a, b).data[KEY].one['001'].text, expected);
  }
});

test('legacy backups without notes still import and keep local notes', () => {
  const current = snapshot({one: {'001': {text: 'keep me', updatedAt: 1}}});
  const legacy = snapshot({});
  delete legacy.data[KEY];
  assert.equal(Backup.merge(current, legacy).data[KEY].one['001'].text, 'keep me');
});

test('malformed note records are rejected and rescue keeps valid notes', () => {
  const backup = snapshot({one: {'001': {text: 'valid', updatedAt: 1}}});
  backup.data[KEY].one.bad = {text: 7, updatedAt: -1};
  assert.throws(() => Backup.validate(backup));
  const local = storage();
  local.setItem(KEY, JSON.stringify(backup.data[KEY]));
  const rescued = Backup.rescue(local);
  Backup.validate(rescued);
  assert.equal(rescued.data[KEY].one['001'].text, 'valid');
  assert(!('bad' in rescued.data[KEY].one));
});
