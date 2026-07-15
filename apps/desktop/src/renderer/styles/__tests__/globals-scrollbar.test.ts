import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalsCss = readFileSync('src/renderer/styles/globals.css', 'utf8');

describe('global scrollbar styles', () => {
  it('keeps native scrollbars hidden until a scroll container is active', () => {
    expect(globalsCss).toContain('--lynavo-scrollbar-thumb: transparent');
    expect(globalsCss).toContain('--lynavo-scrollbar-thumb-active');
    expect(globalsCss).toContain('scrollbar-color: var(--lynavo-scrollbar-thumb) transparent');
    expect(globalsCss).toContain('.lynavo-scrollbar-active');
    expect(globalsCss).toContain('::-webkit-scrollbar-thumb');
    expect(globalsCss).toContain('background-color: var(--lynavo-scrollbar-thumb)');
    expect(globalsCss).toContain('background-color: var(--lynavo-scrollbar-thumb-active)');
  });
});

describe('global text selection styles', () => {
  it('disables incidental UI text selection while keeping copyable content selectable', () => {
    expect(globalsCss).toContain('user-select: none');
    expect(globalsCss).toContain('input,');
    expect(globalsCss).toContain('textarea,');
    expect(globalsCss).toContain("[contenteditable='true'],");
    expect(globalsCss).toContain('code,');
    expect(globalsCss).toContain('pre,');
    expect(globalsCss).toContain('.lynavo-selectable-text');
    expect(globalsCss).toContain('user-select: text');
  });
});
