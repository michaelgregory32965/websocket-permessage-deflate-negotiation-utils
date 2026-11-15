import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitExtensions,
  parseExtensions,
  serializeExtensions,
  parseOffer,
  buildExtensions,
  negotiate
} from '../src/index.js';

test('splitExtensions ignores commas inside quoted strings', () => {
  const parts = splitExtensions('a; x="1,2", b');
  assert.deepEqual(parts, ['a; x="1,2"', 'b']);
});

test('splitExtensions drops empty segments', () => {
  assert.deepEqual(splitExtensions(' , permessage-deflate , '), ['permessage-deflate']);
});

test('parseExtensions returns an empty array for empty input', () => {
  assert.deepEqual(parseExtensions(''), []);
  assert.deepEqual(parseExtensions(undefined), []);
  assert.deepEqual(parseExtensions(null), []);
});

test('parseExtensions marks valueless parameters as true', () => {
  const [entry] = parseExtensions('permessage-deflate; server_no_context_takeover');
  assert.equal(entry.name, 'permessage-deflate');
  assert.equal(entry.params.get('server_no_context_takeover'), true);
});

test('parseExtensions rejects duplicate parameters', () => {
  assert.throws(
    () => parseExtensions('permessage-deflate; a=1; a=2'),
    /duplicate parameter/
  );
});

test('parseExtensions rejects an unterminated quoted string', () => {
  assert.throws(
    () => parseExtensions('permessage-deflate; x="abc'),
    /unterminated quoted string/
  );
});

test('serializeExtensions quotes values that are not tokens', () => {
  const value = serializeExtensions([
    { name: 'permessage-deflate', params: new Map([['note', 'a b']]) }
  ]);
  assert.equal(value, 'permessage-deflate; note="a b"');
});

test('serializeExtensions round-trips a parsed offer', () => {
  const header = 'permessage-deflate; client_max_window_bits; server_no_context_takeover';
  const parsed = parseExtensions(header);
  assert.equal(serializeExtensions(parsed), header);
});

test('parseOffer returns null when the extension is absent', () => {
  assert.equal(parseOffer('x-foo'), null);
});

test('parseOffer normalizes window bits to numbers', () => {
  const offer = parseOffer('permessage-deflate; server_max_window_bits=10; client_max_window_bits');
  assert.equal(offer.serverMaxWindowBits, 10);
  assert.equal(offer.clientMaxWindowBits, true);
  assert.equal(offer.serverNoContextTakeover, false);
});

test('parseOffer rejects out-of-range window bits', () => {
  assert.throws(
    () => parseOffer('permessage-deflate; server_max_window_bits=7'),
    RangeError
  );
  assert.throws(
    () => parseOffer('permessage-deflate; server_max_window_bits=16'),
    RangeError
  );
});

test('buildExtensions omits parameters that are not set', () => {
  assert.equal(buildExtensions({}), 'permessage-deflate');
  assert.equal(
    buildExtensions({ serverNoContextTakeover: true, clientMaxWindowBits: 12 }),
    'permessage-deflate; server_no_context_takeover; client_max_window_bits=12'
  );
});

test('negotiate declines when the offer is absent', () => {
  assert.equal(negotiate('x-other'), null);
});

test('negotiate echoes a client-mandated no-context-takeover', () => {
  const response = negotiate('permessage-deflate; server_no_context_takeover');
  assert.equal(response, 'permessage-deflate; server_no_context_takeover');
});

test('negotiate replies with an explicit window when the client offered none', () => {
  const response = negotiate('permessage-deflate; client_max_window_bits');
  assert.equal(response, 'permessage-deflate; client_max_window_bits=15');
});

test('negotiate honours a concrete client window constraint', () => {
  const response = negotiate('permessage-deflate; client_max_window_bits=8');
  assert.equal(response, 'permessage-deflate; client_max_window_bits=8');
});

test('negotiate rejects a valueless server_max_window_bits', () => {
  assert.throws(
    () => negotiate('permessage-deflate; server_max_window_bits'),
    /server_max_window_bits requires a value/
  );
});
