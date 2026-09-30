import test from 'node:test';
import assert from 'node:assert/strict';
import { hostingConfig } from '../server/hosting.ts';

test('local default retains loopback and rejects other sites', () => {
  const config = hostingConfig({}, 3000);
  assert.equal(config.bindHost, '127.0.0.1');
  assert.ok(config.allowed('localhost:3000', 'http://localhost:3000', 'POST', '/api/check'));
  assert.ok(config.allowed('127.0.0.1:3000', undefined, 'GET', '/'));
  assert.equal(config.allowed('evil.example', undefined, 'GET', '/'), false);
  assert.equal(config.allowed('localhost:3000', 'https://evil.example', 'POST', '/api/check'), false);
});

test('Railway permits its exact public origin and healthcheck only', () => {
  const config = hostingConfig({ HOST: '0.0.0.0', RAILWAY_PUBLIC_DOMAIN: 'bank.up.railway.app', RAILWAY_ENVIRONMENT_ID: 'production' }, 3000);
  assert.equal(config.bindHost, '0.0.0.0');
  assert.ok(config.allowed('bank.up.railway.app', 'https://bank.up.railway.app', 'POST', '/api/check'));
  assert.ok(config.allowed('healthcheck.railway.app', undefined, 'GET', '/api/health'));
  assert.equal(config.allowed('healthcheck.railway.app', undefined, 'GET', '/api/reviews'), false);
  assert.equal(config.allowed('bank.up.railway.app.evil.example', undefined, 'GET', '/'), false);
  assert.equal(config.allowed('bank.up.railway.app', 'https://evil.example', 'POST', '/api/check'), false);
});

test('custom origins are validated and keep localhost working', () => {
  const config = hostingConfig({ APP_ORIGIN: 'https://bank.example' }, 3000);
  assert.ok(config.allowed('bank.example', 'https://bank.example', 'POST', '/api/check'));
  assert.ok(config.allowed('localhost:3000', undefined, 'GET', '/'));
  for (const value of ['https://bank.example/path', 'https://user:pass@bank.example', 'file:///tmp']) {
    assert.throws(() => hostingConfig({ APP_ORIGIN: value }, 3000));
  }
});
