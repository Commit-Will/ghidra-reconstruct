import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { vc8FormSpec, vc8formBodyHash } from '../codegen/vc8form-spec.js';

describe('vc8-form opas ordering', () => {
  it('runs a measured arithmetic update after fold and before decl regardless of tag order', () => {
    const decompiled = 'int f() { return 0; }';
    const dh = vc8formBodyHash(decompiled);
    const records = ['decl(x,y)', 'opas(v,+,1)', 'fold(tmp)'].map(form => ({
      type: 'vc8form', data: `${form};ev=0123456789;bh=16-00000000;dh=${dh}`,
    }));
    for (const tags of [records, [...records].reverse()]) {
      const spec = vc8FormSpec({ tags, size: 16, decompiled });
      assert.deepEqual(spec?.stale, []);
      assert.deepEqual(spec?.forms.map(entry => entry.form.op), ['fold', 'opas', 'decl']);
    }
  });
  it('keeps two independent shifts in their measured ord even when tags arrive reversed', () => {
    const decompiled = 'void f() {}';
    const dh = vc8formBodyHash(decompiled);
    const tags = ['opas(x,>>,3)', 'opas(y,>>,5)'].map((form, i) => ({ type: 'vc8form',
      data: `${form};ev=0123456789;bh=16-00000000;dh=${dh};ord=${i + 1}` }));
    const spec = vc8FormSpec({ tags: tags.reverse(), size: 16, decompiled });
    assert.deepEqual(spec?.forms.map(x => x.form), [
      { op: 'opas', updates: [{ name: 'x', operator: '>>', constant: '3' }] },
      { op: 'opas', updates: [{ name: 'y', operator: '>>', constant: '5' }] },
    ]);
  });
});
