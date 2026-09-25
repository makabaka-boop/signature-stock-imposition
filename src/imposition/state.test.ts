import { describe, expect, it } from 'vitest';
import {
  commitParams,
  createInitialResult,
  DEFAULT_DRAFT,
  resultReducer,
  type Draft,
} from './state';

const draft = (patch: Partial<Draft>): Draft => ({ ...DEFAULT_DRAFT, ...patch });

describe('commitParams', () => {
  it('合法草稿生成拼版', () => {
    const outcome = commitParams(draft({ bodyPages: '12', signatureSize: '8' }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.imposition.bodyPages).toBe(12);
      expect(outcome.imposition.signatureSize).toBe(8);
    }
  });

  it.each([
    ['0', '8'],
    ['513', '8'],
    ['1.5', '8'],
    ['', '8'],
    ['abc', '8'],
    ['8', '3'],
    ['8', '33'],
    ['8', '6'],
    ['8', ''],
  ])('非法草稿 (%s, %s) 返回错误而不是拼版', (bodyPages, signatureSize) => {
    const outcome = commitParams(draft({ bodyPages, signatureSize }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('resultReducer：非法组合不得覆盖上次合法拼版', () => {
  it('rejected 保留 imposition，committed 才替换', () => {
    const initial = createInitialResult();
    expect(initial.imposition.bodyPages).toBe(8);

    // 非法提交：拼版不变，记录错误并标记 stale
    const rejected = resultReducer(initial, {
      type: 'rejected',
      errors: ['正文页数必须是 1 至 512 的整数'],
    });
    expect(rejected.imposition).toBe(initial.imposition);
    expect(rejected.errors).toHaveLength(1);
    expect(rejected.stale).toBe(true);

    // 合法提交：替换拼版并清空错误
    const next = commitParams(draft({ bodyPages: '16' }));
    if (!next.ok) throw new Error('应当合法');
    const committed = resultReducer(rejected, {
      type: 'committed',
      imposition: next.imposition,
    });
    expect(committed.imposition.bodyPages).toBe(16);
    expect(committed.errors).toEqual([]);
    expect(committed.stale).toBe(false);
  });

  it('连续多次非法提交后仍是同一份合法拼版', () => {
    let state = createInitialResult();
    for (let i = 0; i < 5; i += 1) {
      state = resultReducer(state, { type: 'rejected', errors: [`错误 ${i}`] });
    }
    expect(state.imposition.bodyPages).toBe(8);
    expect(state.errors).toEqual(['错误 4']);
  });
});
