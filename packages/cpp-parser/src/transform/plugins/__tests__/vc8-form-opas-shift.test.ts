import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../parser/index.js';
import { emit } from '../../../emit/index.js';
import type { AnyNode, TranslationUnit } from '../../../ast/nodes.js';
import { applyVc8Forms, parseVc8Form, type Vc8FormSite, type Vc8FormTables } from '../builtins/vc8-form.js';

const tables: Vc8FormTables = { structFields: { Output: { a: 'short', b: 'short' } } };
const source = 'void f(Output* dst, int32_t x, int32_t y) { Convert(&x, &y); dst->a = (short)(x >> 3); dst->b = (short)(y >> 5); }';
function run(text: string, forms: string[], context = tables) {
  const sites: Vc8FormSite[] = [];
  const parsed = forms.map(tag => { const form = parseVc8Form(tag); assert.ok(form); return { form, tag }; });
  const out = applyVc8Forms(parse(text) as TranslationUnit, parsed, s => sites.push(s), context);
  return { text: emit(out as AnyNode).replace(/\s+/g, ' ').trim(), sites };
}

describe('opas single-variable shifts', () => {
  it('applies each variable independently with arbitrary callee, fields and amounts', () => {
    const x = run(source, ['opas(x,>>,3)']);
    assert.equal(x.sites[0].applied, true, x.sites[0].why);
    assert.match(x.text, /Convert\(&x, &y\); x >>= 3; dst->a = \(short int\)x; dst->b = \(short int\)\(y >> 5\);/);
    const both = run(source, ['opas(x,>>,3)', 'opas(y,>>,5)']);
    assert.ok(both.sites.every(s => s.applied), JSON.stringify(both.sites));
    assert.match(both.text, /x >>= 3; y >>= 5; dst->a = \(short int\)x; dst->b = \(short int\)y;/);
  });

  it('keeps independently supplied update order', () => {
    const result = run(source, ['opas(y,>>,5)', 'opas(x,>>,3)']);
    assert.ok(result.sites.every(s => s.applied), JSON.stringify(result.sites));
    assert.match(result.text, /y >>= 5; x >>= 3; dst->a/);
  });

  it('supports an initialized local, repeated uses, and unsigned 32-bit shifts', () => {
    for (const text of [
      'int f(int p) { int x = p; int a = x >> 7; return a + (x >> 7); }',
      'uint32_t f(uint32_t x) { return x >> 7; }',
    ]) assert.equal(run(text, ['opas(x,>>,7)']).sites[0].applied, true, text);
  });
  it('keeps a preceding early-return guard before the update', () => {
    const result = run('int f(int x) { if (!x) return -1; return x >> 3; }', ['opas(x,>>,3)']);
    assert.equal(result.sites[0].applied, true, result.sites[0].why);
    assert.match(result.text, /if \(!x\) return -1; x >>= 3; return x;/);
  });

  it('refuses control flow, old-value reads, alias reads, calls and unknown field types', () => {
    for (const [text, context] of [
      [source.replace('dst->b =', 'if (y) return; dst->b ='), tables],
      [source.replace('dst->b = (short)(y >> 5);', 'dst->b = (short)x;'), tables],
      [source.replace('dst->b = (short)(y >> 5);', 'dst->b = Load();'), tables],
      [source.replace('dst->b = (short)(y >> 5);', 'dst->b = *gpAlias;'), tables],
      [source, {}],
      [source, { structFields: { Output: { a: 'volatile short', b: 'short' } } }],
      [source.replace('int32_t x', 'uint16_t x'), tables],
      [source.replace('int32_t x', 'const int32_t x'), tables],
      [source.replace('dst->a =', 'Escape(&dst); dst->a ='), tables],
      [source.replace('dst->a =', 'int& alias = x; dst->a ='), tables],
      ['int f() { int x = x >> 3; return x; }', tables],
    ] as Array<[string, Vc8FormTables]>) {
      const result = run(text, ['opas(x,>>,3)'], context);
      assert.equal(result.sites[0].applied, false, text);
      assert.equal(result.text, run(text, [], context).text, text);
    }
  });

  it('refuses counts outside the 32-bit operand width and incompatible narrowing', () => {
    for (const amount of [0, 32, 64]) {
      const text = `int f(int x) { return x >> ${amount}; }`;
      if (amount === 0) assert.equal(parseVc8Form('opas(x,>>,0)'), undefined);
      else assert.equal(run(text, [`opas(x,>>,${amount})`]).sites[0].applied, false);
    }
    const result = run('void f(Output* dst, int x) { dst->a = (short)(x >> 3); dst->b = (short)(x >> 2); }', ['opas(x,>>,3)']);
    assert.equal(result.sites[0].applied, false);
  });
});
