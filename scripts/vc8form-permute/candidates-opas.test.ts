import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { singles } from './candidates.js';

function forms(text: string) {
  const [result] = singles([{ id: 'f', text }], 4);
  assert.equal(result.error, undefined);
  return result.candidates.map(x => x.form).filter(x => x.startsWith('opas('));
}

describe('opas collector candidates', () => {
  it('discovers guarded integer and byte updates', () => {
    assert.deepEqual(forms('void f() { int32_t v = Get(); if (v != -1) { g(v+1); h(v+1); } }'), ['opas(v,+,1)']);
    assert.deepEqual(forms('void f() { uint8_t v = Get(); if (v) { g((uint8_t)(v-1)); h((uint8_t)(v-1)); } }'), ['opas(v,-,1)']);
  });

  it('discovers a single shift and filters jumps, calls and old reads', () => {
    assert.deepEqual(forms('int f(int v) { return v >> 7; }'), ['opas(v,>>,7)']);
    assert.deepEqual(forms('void f() { int32_t v = Get(); again: m(); if (v != -1) { g(v+1); h(v+1); } if (k()) goto again; }'), []);
    assert.deepEqual(forms('int f(int v) { Use(v >> 7); return v; }'), []);
  });

  it('finds both independent shifts via --ops opas using snapshot field facts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc8-opas-'));
    try {
      const text = 'void f(Out* dst, int x, int y) { Convert(&x,&y); dst->a = (short)(x >> 3); dst->b = (short)(y >> 5); }';
      writeFileSync(join(dir, 'in.json'), JSON.stringify([{ id: 'f', text }]));
      writeFileSync(join(dir, 'dataTypes.ndjson'), JSON.stringify({ kind: 'STRUCTURE', name: 'Out', size: 4,
        fields: [{ name: 'a', dataType: 'short', offset: 0, size: 2 }, { name: 'b', dataType: 'short', offset: 2, size: 2 }] }) + '\n');
      writeFileSync(join(dir, 'functions.ndjson'), '');
      const root = fileURLToPath(new URL('../../', import.meta.url));
      const result = spawnSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'),
        fileURLToPath(new URL('./candidates.ts', import.meta.url)), 'singles', join(dir, 'in.json'), join(dir, 'out.json'),
        '--types', join(dir, 'dataTypes.ndjson'), '--ops', 'opas'], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const [row] = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
      assert.equal(row.error, undefined);
      assert.deepEqual(row.candidates.map((x: { form: string }) => x.form), ['opas(x,>>,3)', 'opas(y,>>,5)']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
