import { describe, expect, it } from 'vitest';
import { NO_IMPOSITION } from './inventory';
import {
  commitDraft,
  commitInventoryParams,
  commitParams,
  createInitialResult,
  DEFAULT_DRAFT,
  resultReducer,
  type Draft,
} from './state';

const draft = (patch: Partial<Draft>): Draft => ({ ...DEFAULT_DRAFT, ...patch });

const inventoryDraft = (
  patch: Partial<Draft>,
  rows: Array<[string, string]>,
): Draft =>
  draft({
    mode: 'inventory',
    inventoryRows: rows.map(([capacity, count]) => ({ capacity, count })),
    ...patch,
  });

describe('commitParams', () => {
  it('合法草稿生成拼版', () => {
    const outcome = commitParams(draft({ bodyPages: '12', signatureSize: '8' }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok && 'signatureSize' in outcome.imposition) {
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

describe('commitInventoryParams', () => {
  it('合法库存草稿生成库存拼版', () => {
    const outcome = commitInventoryParams(
      inventoryDraft({ bodyPages: '12' }, [
        ['8', '1'],
        ['4', '1'],
      ]),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect('signatureSizes' in outcome.imposition).toBe(true);
      if ('signatureSizes' in outcome.imposition) {
        expect(outcome.imposition.signatureSizes).toEqual([4, 8]);
        expect(outcome.imposition.blankCount).toBe(0);
      }
    }
  });

  const badRows: Array<[string, string][]> = [
    [['8', '1'], ['8', '2']], // 容量重复
    [['6', '1'], ['8', '1']], // 容量非 4 的倍数
    [['4', '1'], ['8', '9']], // 册数越界
    [['4', '1'], ['8', '-1']], // 册数为负
    [['', '1'], ['8', '1']], // 容量为空
    [['4', ''], ['8', '1']], // 册数为空
    [['4', '1.5'], ['8', '1']], // 容量非整数
  ];
  badRows.forEach((rows) => {
    it(`非法库存草稿 ${JSON.stringify(rows)} 返回错误而不是拼版`, () => {
      const outcome = commitInventoryParams(inventoryDraft({}, rows));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.errors.length).toBeGreaterThan(0);
      }
    });
  });

  it('库存不足返回 NO_IMPOSITION 错误，不产生拼版', () => {
    const outcome = commitInventoryParams(
      inventoryDraft({ bodyPages: '100' }, [
        ['8', '2'],
        ['16', '1'],
      ]),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors[0]).toContain(NO_IMPOSITION);
    }
  });

  it('commitDraft 按模式分发：inventory 走库存入口，fixed 走旧入口', () => {
    const inv = commitDraft(
      inventoryDraft({ bodyPages: '12' }, [
        ['8', '1'],
        ['4', '1'],
      ]),
    );
    expect(inv.ok && 'signatureSizes' in inv.imposition).toBe(true);

    const fixed = commitDraft(draft({ bodyPages: '12', signatureSize: '8' }));
    expect(fixed.ok && 'signatureSize' in fixed.imposition).toBe(true);
  });
});

describe('resultReducer：库存拼版失败同样保留上次合法拼版', () => {
  it('库存不足（NO_IMPOSITION）不覆盖已确认的库存拼版', () => {
    const good = commitInventoryParams(
      inventoryDraft({ bodyPages: '12' }, [
        ['8', '1'],
        ['4', '1'],
      ]),
    );
    if (!good.ok) throw new Error('应当合法');
    let state = resultReducer(createInitialResult(), {
      type: 'committed',
      imposition: good.imposition,
    });

    const bad = commitInventoryParams(
      inventoryDraft({ bodyPages: '100' }, [
        ['8', '1'],
        ['4', '1'],
      ]),
    );
    if (bad.ok) throw new Error('应当库存不足');
    state = resultReducer(state, { type: 'rejected', errors: bad.errors });

    expect(state.imposition).toBe(good.imposition);
    expect(state.errors[0]).toContain(NO_IMPOSITION);
    expect(state.stale).toBe(true);
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
