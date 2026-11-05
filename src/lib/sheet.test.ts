import { describe, expect, it } from 'vitest';
import { sheetDragOffset, sheetRelease } from './sheet.ts';

describe('sheet gesture', () => {
  it('collapses an expanded sheet after a long drag or a downward flick', () => {
    expect(sheetRelease({ offset: 150, velocity: 0, height: 420, collapsed: false })).toBe('collapse');
    expect(sheetRelease({ offset: 100, velocity: 0, height: 300, collapsed: false })).toBe('collapse');
    expect(sheetRelease({ offset: 30, velocity: 0.8, height: 420, collapsed: false })).toBe('collapse');
  });
  it('springs back after a short drag, an upward flick or a tap-sized movement', () => {
    expect(sheetRelease({ offset: 60, velocity: 0.1, height: 420, collapsed: false })).toBe('stay');
    expect(sheetRelease({ offset: 200, velocity: -0.5, height: 420, collapsed: false })).toBe('stay');
    expect(sheetRelease({ offset: 8, velocity: 0.9, height: 420, collapsed: false })).toBe('stay');
  });
  it('expands a collapsed sheet when lifted', () => {
    expect(sheetRelease({ offset: -30, velocity: 0, height: 80, collapsed: true })).toBe('expand');
    expect(sheetRelease({ offset: -10, velocity: -0.6, height: 80, collapsed: true })).toBe('expand');
    expect(sheetRelease({ offset: -10, velocity: 0, height: 80, collapsed: true })).toBe('stay');
    expect(sheetRelease({ offset: 20, velocity: 0.9, height: 80, collapsed: true })).toBe('stay');
  });
  it('follows the finger where the sheet can move and resists elsewhere', () => {
    expect(sheetDragOffset(120, false)).toBe(120);
    expect(sheetDragOffset(-200, false)).toBe(-28);
    expect(sheetDragOffset(-40, false)).toBe(-10);
    expect(sheetDragOffset(-50, true)).toBe(-30);
    expect(sheetDragOffset(-500, true)).toBe(-90);
    expect(sheetDragOffset(40, true)).toBe(10);
  });
});
