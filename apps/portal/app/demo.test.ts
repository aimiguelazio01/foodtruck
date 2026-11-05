import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoLinks } from './lib';

test('the demonstration is offered only with two plain https site addresses', () => {
  const customer = 'https://foodtruck-cb53747eec00b971286297c9774cf4ad-customer.example.workers.dev';
  const management = 'https://foodtruck-cb53747eec00b971286297c9774cf4ad-management.example.workers.dev/';
  assert.deepEqual(demoLinks(customer, management), { customer, management: management.slice(0, -1) });
  assert.equal(demoLinks(undefined, management), null);
  assert.equal(demoLinks(customer, ''), null);
  assert.equal(demoLinks('http://demo.example.pt', management), null);
  assert.equal(demoLinks('https://demo.example.pt/path?x=1', management), null);
  assert.equal(demoLinks('javascript:alert(1)', management), null);
});
