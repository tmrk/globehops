import { describe, expect, it } from 'vitest';
import { sheetDragOffset, sheetRelease } from './sheet.ts';

const release = (offset: number, velocity: number, height: number, detent: 'peek' | 'half' | 'full', canGrow = true) =>
  sheetRelease({ offset, velocity, height, detent, canGrow });

describe('sheet gesture', () => {
  it('collapses a half sheet after a long drag or a downward flick', () => {
    expect(release(150, 0, 420, 'half')).toBe('peek');
    expect(release(100, 0, 300, 'half')).toBe('peek');
    expect(release(30, 0.8, 420, 'half')).toBe('peek');
  });
  it('springs back after a short drag, a flick the other way or a tap-sized movement', () => {
    expect(release(60, 0.1, 420, 'half')).toBe('half');
    expect(release(200, -0.5, 420, 'half')).toBe('half');
    expect(release(8, 0.9, 420, 'half')).toBe('half');
    expect(release(-20, 0, 420, 'half')).toBe('half');
  });
  it('grows a half sheet whose content does not fit, and only then', () => {
    expect(release(-60, 0, 420, 'half')).toBe('full');
    expect(release(-12, -0.6, 420, 'half')).toBe('full');
    expect(release(-60, -0.6, 420, 'half', false)).toBe('half');
  });
  it('returns a full sheet to half, or to the peek bar after a very long drag', () => {
    expect(release(200, 0, 760, 'full')).toBe('half');
    expect(release(30, 0.8, 760, 'full')).toBe('half');
    expect(release(500, 0.2, 760, 'full')).toBe('peek');
    expect(release(100, 0, 760, 'full')).toBe('full');
    expect(release(240, -0.5, 760, 'full')).toBe('full');
  });
  it('expands a collapsed sheet when lifted', () => {
    expect(release(-30, 0, 80, 'peek')).toBe('half');
    expect(release(-10, -0.6, 80, 'peek')).toBe('half');
    expect(release(-10, 0, 80, 'peek')).toBe('peek');
    expect(release(20, 0.9, 80, 'peek')).toBe('peek');
  });
  it('follows the finger where the sheet can move and resists elsewhere', () => {
    expect(sheetDragOffset(120, 'half')).toBe(120);
    expect(sheetDragOffset(-200, 'half')).toBe(-28);
    expect(sheetDragOffset(-40, 'half')).toBe(-10);
    expect(sheetDragOffset(-100, 'half', true)).toBe(-85);
    expect(sheetDragOffset(-500, 'half', true)).toBe(-260);
    expect(sheetDragOffset(-100, 'full')).toBe(-25);
    expect(sheetDragOffset(90, 'full')).toBe(90);
    expect(sheetDragOffset(-50, 'peek')).toBe(-30);
    expect(sheetDragOffset(-500, 'peek')).toBe(-90);
    expect(sheetDragOffset(40, 'peek')).toBe(10);
  });
});
