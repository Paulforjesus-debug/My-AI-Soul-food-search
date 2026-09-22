import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function regionTerms(');
const end = html.indexOf('function coordinatesClose(', start);
assert.ok(start >= 0 && end > start, 'registration search functions exist');

function searchContext({ query = '', region = '화성 남양', bounds = null, submissions = [] } = {}) {
  const context = {
    document: { querySelector: () => ({ value: query }) },
    resolvedLocationText: region,
    currentSearchBounds: bounds,
    window: { MiseNeon: { listSubmissions: async () => submissions } },
  };
  runInNewContext(html.slice(start, end), context);
  return context;
}

test('registered restaurant is found by name even if its road address omits the neighborhood', async () => {
  const item = { id: 7, name: '일품청국장', address: '경기도 화성시 역골중앙로 41번길 42', status: 'approved', latitude: null, longitude: null };
  const context = searchContext({ query: '일품청국장', submissions: [item] });
  const results = await context.searchMyRegistrations(37.2, 126.8, { radius: 12000 });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, '일품청국장');
  assert.equal(results[0].latitude, null);
  assert.equal(results[0].longitude, null);
});

test('registered restaurant can be searched by name without a region', async () => {
  const submissions = [
    { id: 7, name: '일품청국장', address: '경기도 화성시 역골중앙로 41번길 42', status: 'approved' },
    { id: 8, name: '다른 식당', address: '경기도 화성시 남양읍', status: 'approved' },
  ];
  const context = searchContext({ region: '', submissions });
  const results = await context.searchMyRegistrationsByName('일품청국장');
  assert.deepEqual(Array.from(results, place => place.name), ['일품청국장']);
});

test('region search excludes unrelated address without coordinates and rejected entries', async () => {
  const submissions = [
    { id: 7, name: '일품청국장', address: '경기도 화성시 역골중앙로 41번길 42', status: 'approved', latitude: null, longitude: null },
    { id: 8, name: '남양 맛집', address: '경기도 화성시 남양읍', status: 'rejected', latitude: null, longitude: null },
  ];
  const context = searchContext({ submissions });
  const results = await context.searchMyRegistrations(37.2, 126.8, { radius: 12000 });
  assert.equal(results.length, 0);
});
