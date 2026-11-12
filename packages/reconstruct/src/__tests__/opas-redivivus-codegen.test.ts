/**
 * Redivivus Windows 1.14d functions, read from Ghidra at the addresses below.
 * Live function facts refreshed on 2026-11-12. Exercise vc8form tags through generateProject, including the
 * decompile-hash gate, parser, transform, and emitted implementation.
 */
import { describe, it } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { generateProject } from '../codegen/index.js';
import { vc8formBodyHash } from '../codegen/vc8form-spec.js';
import type { ExtractedFunction, ExtractedNamespace, ExtractedStruct, ProgramInfo, ReconstructOptions } from '../types.js';

const options: ReconstructOptions = {
  outputDir: './out', format: 'cpp', organization: 'namespace',
  generateCMake: false, generateSourceMaps: false, transformPreset: 'full',
  includeAddressComments: false, promoteStaticGlobals: false,
};
const programInfo: ProgramInfo = {
  name: 'Game.exe', path: '/Redivivus/Game.exe', format: 'PE',
  architecture: 'x86', compiler: 'msvc', imageBase: '0x400000',
  languageId: 'x86:LE:32:default', endianness: 'little', pointerSize: 4,
};

type Case = {
  address: string; name: string; namespace: string; size: number;
  forms: string[];
};

const cases: Case[] = [
  {
    address: '00434700', name: 'StorePreferedRealmAgain', namespace: 'D2Launch::MainMenus', size: 90,
    forms: ['opas(nSelectedLine,+,1)'],
  },
  {
    address: '0054e090', name: 'MONSTER_SpawnMonsterGroup', namespace: 'D2Game::Monsters::Monsters::Spawn', size: 241,
    forms: ['opas(byMinGrp,-,1)'],
  },
  {
    address: '00648b00', name: 'SetSP1Shifted', namespace: 'D2Common::PATH::DynamicPath', size: 43,
    forms: ['opas(nX,>>,0xb)', 'opas(nY,>>,0xb)'],
  },
];

const live = JSON.parse(readFileSync(new URL('./fixtures/opas-live-20261112.json', import.meta.url), 'utf8')) as Record<string, ExtractedFunction>;

function extract(c: Case, tag: 'current' | 'stale' | 'none'): ExtractedFunction {
  const facts = live[c.address];
  const decompiled = facts.decompiled!;
  return {
    ...facts, address: c.address,
    decompiled, calledFunctions: [],
    tags: tag === 'none' ? [] : c.forms.map((form, index) => ({
      type: 'vc8form',
      // Evidence/byte tokens are fixture placeholders, never installable live tags.
      data: `${form};ev=0123456789;bh=${c.size}-00000000;dh=${tag === 'current' ? vc8formBodyHash(decompiled) : '00000000'}${c.forms.length > 1 ? `;ord=${index + 1}` : ''}`,
    })),
  };
}

function implementations(tag: 'current' | 'stale' | 'none'): Map<string, string> {
  const functions = cases.map(c => extract(c, tag));
  const namespaces: ExtractedNamespace[] = cases.map(c => ({
    name: c.namespace.split('::').at(-1)!, fullPath: c.namespace, functionCount: 1, isClass: false,
  }));
  const types: ExtractedStruct[] = [{ kind: 'STRUCTURE', name: 'D2DynamicPathStrc', category: '/', size: 512,
    fields: [{ name: 'nTargetX', dataType: 'short', offset: 16, size: 2 },
      { name: 'nTargetY', dataType: 'short', offset: 18, size: 2 }] }];
  const project = generateProject('opas-redivivus', functions, [], types, [], namespaces, options, programInfo);
  const byFunction = new Map<string, string>();
  for (const c of cases) {
    const file = [...project.files.values()].find(f => f.type === 'implementation' && f.content.includes(`${c.name}(`));
    assert.ok(file, `implementation for ${c.address} ${c.name}`);
    byFunction.set(c.name, file.content);
    if (process.env.OPAS_EMIT_DIR) writeFileSync(join(process.env.OPAS_EMIT_DIR, `${tag}-${c.address}.cpp`), file.content);
  }
  return byFunction;
}

describe('Redivivus opas codegen', () => {
  it('applies each measured tag through project emission', () => {
    const tagged = implementations('current');
    const plain = implementations('none');
    for (const c of cases) assert.notEqual(tagged.get(c.name), plain.get(c.name), c.name);
    assert.match(tagged.get('StorePreferedRealmAgain')!, /nSelectedLine \+= 1;[\s\S]*SetCurGateway\(pGatewayAccess, nSelectedLine\);[\s\S]*Realm\(pGatewayAccess, nSelectedLine\)/);
    assert.match(tagged.get('MONSTER_SpawnMonsterGroup')!, /byMinGrp -= 1;[\s\S]*\(uint8_t\)byMinGrp[\s\S]*\(uint8_t\)byMinGrp/);
    assert.match(tagged.get('SetSP1Shifted')!, /DRLG_WorldToScreenNoShift\(&nX, &nY\);[\s\S]*nX >>= 0xb;[\s\S]*nY >>= 0xb;[\s\S]*nTargetX = \(short int\)nX;[\s\S]*nTargetY = \(short int\)nY/);
  });

  it('leaves untagged and stale-tagged output identical', () => {
    const plain = implementations('none');
    const stale = implementations('stale');
    for (const c of cases) assert.equal(stale.get(c.name), plain.get(c.name), c.name);
  });
});
