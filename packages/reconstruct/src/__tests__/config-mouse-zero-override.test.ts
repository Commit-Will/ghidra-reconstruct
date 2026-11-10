import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateFunctionImplementation } from '../codegen/impl.js';
import { applyPatches, createOverrideRegistry, loadBuiltinOverrides } from '../overrides/index.js';
import type { ExtractedFunction, ReconstructOptions } from '../types.js';

// Current public Win Ghidra body for 004a5e60: the native function clears seven
// distinct dwords at 004a5ee2..004a5f06, but array-fill-collapse prints memset.
const decompiled = `
void __cdecl D2Client::UI::ui::UI_ConfigHandleMouseClick(int32_t nMouseX,int32_t nMouseY)
{
  uint32_t bCellClickable;
  int32_t nTabIndex;
  int nActiveButton;
  if (((gaControlConfigRegionMouseState[0] != 0) &&
      (bCellClickable = D2Client::UI::ui::UI_IsControlConfigCellClickable(nMouseY,nMouseX),
      bCellClickable != 0)) && (gpStatDescriptorTable[g_ControlConfigUIState].nCmdIndex != 0x39)) {
    D2Client::UI::ui::UI_ConfigKeyBindModeEnable();
    D2Client::Sound::SOUND_PlaySound(SOUND_CURSOR_SELECT,(D2UnitStrc *)0x0,0,0,0);
  }
  nActiveButton = gnUICtrlConfigActiveButton;
  if (((gaControlConfigRegionMouseState[6] != 0) && (gnUICtrlConfigActiveButton != 3)) &&
     (nTabIndex = D2Client::UI::ui::UI_GetControlConfigTabIndex(nMouseX,nMouseY),
     nTabIndex == nActiveButton)) {
    (*g_UIConfigTabTable[nActiveButton].pfnAction)();
    D2Client::Sound::SOUND_PlaySound(SOUND_CURSOR_SELECT,(D2UnitStrc *)0x0,0,0,0);
  }
  gnUICtrlConfigButton3State = 0;
  gaControlConfigRegionMouseState[0] = 0;
  gaControlConfigRegionMouseState[1] = 0;
  gaControlConfigRegionMouseState[2] = 0;
  gaControlConfigRegionMouseState[3] = 0;
  gaControlConfigRegionMouseState[4] = 0;
  gaControlConfigRegionMouseState[5] = 0;
  gaControlConfigRegionMouseState[6] = 0;
  return;
}
`;

const options: ReconstructOptions = {
  outputDir: './out', format: 'cpp', organization: 'namespace', generateCMake: false,
  generateSourceMaps: false, transformPreset: 'full', includeAddressComments: false, promoteStaticGlobals: false,
};

function func(address = '004a5e60'): ExtractedFunction {
  return {
    name: 'UI_ConfigHandleMouseClick', address,
    signature: 'void UI_ConfigHandleMouseClick(int32_t nMouseX, int32_t nMouseY)', returnType: 'void',
    parameters: [
      { name: 'nMouseX', dataType: 'int32_t', size: 4, ordinal: 0, storage: 'EBX' },
      { name: 'nMouseY', dataType: 'int32_t', size: 4, ordinal: 1, storage: 'EAX' },
    ],
    localVariables: [], callingConvention: '__cdecl', size: 175, isThunk: false,
    isExternal: false, hasVarArgs: false, decompiled,
  };
}

describe('config mouse zero-store persistence', () => {
  it('keeps seven dword stores only for the registered native site', () => {
    const before = generateFunctionImplementation(func(), undefined, options);
    assert.match(before, /memset\(gaControlConfigRegionMouseState, 0, 7 \* sizeof\(gaControlConfigRegionMouseState\[0\]\)\);/);

    const registry = createOverrideRegistry(undefined, '.');
    assert.ok(registry);
    const out = generateFunctionImplementation(func(), undefined, options, { overrides: registry } as never);
    assert.doesNotMatch(out, /memset\(gaControlConfigRegionMouseState/);
    const stores = Array.from({ length: 7 }, (_, i) =>
      `gaControlConfigRegionMouseState[${i}] = 0;`).join('\n    ');
    assert.ok(out.includes(stores), 'seven stores stay adjacent and in native order');

    const other = generateFunctionImplementation(func('004a5e61'), undefined, options, { overrides: registry } as never);
    assert.match(other, /memset\(gaControlConfigRegionMouseState/);
  });

  it('fails closed when the exact emitted run is absent or repeated', () => {
    const entry = loadBuiltinOverrides().find(e => e.address === '004a5e60');
    assert.ok(entry && entry.action === 'patch' && entry.preserveFacts);
    const anchor = entry.patches?.[0]?.find;
    assert.ok(anchor);
    assert.throws(() => applyPatches('different form', entry.patches!), /matched 0 times/);
    assert.throws(() => applyPatches(`${anchor}\n${anchor}`, entry.patches!), /matched 2 times/);
  });
});
