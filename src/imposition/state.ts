import { impose, ImpositionError } from './imposition';
import {
  imposeInventory,
  InventoryShortageError,
  NO_IMPOSITION,
} from './inventory';
import type {
  AnyImposition,
  Binding,
  Flip,
  InventoryStockItem,
} from './types';

/** 拼版流程：固定容量（旧入口）或库存拼版。 */
export type Mode = 'fixed' | 'inventory';

/** 库存拼版的一行草稿：数字以字符串保存，提交时统一解析校验。 */
export interface InventoryRowDraft {
  capacity: string;
  count: string;
}

/** 表单草稿：数字以字符串保存，提交时统一解析校验。 */
export interface Draft {
  mode: Mode;
  bodyPages: string;
  signatureSize: string;
  binding: Binding;
  flip: Flip;
  /** 库存拼版的 2–4 行库存草稿（仅 mode = 'inventory' 时生效）。 */
  inventoryRows: InventoryRowDraft[];
}

export const DEFAULT_DRAFT: Draft = {
  mode: 'fixed',
  bodyPages: '8',
  signatureSize: '8',
  binding: 'left',
  flip: 'long',
  inventoryRows: [
    { capacity: '8', count: '2' },
    { capacity: '16', count: '1' },
  ],
};

/**
 * 提交结果：
 * - 合法 → ok，带新拼版；
 * - 非法（含库存不足 NO_IMPOSITION）→ 错误列表，
 *   调用方必须保留上次合法拼版，不得覆盖。
 */
export type CommitOutcome =
  | { ok: true; imposition: AnyImposition }
  | { ok: false; errors: string[] };

/** 固定容量旧入口：行为与校验顺序保持原样。 */
export function commitParams(draft: Draft): CommitOutcome {
  const bodyPages = Number(draft.bodyPages);
  const signatureSize = Number(draft.signatureSize);
  const errors: string[] = [];

  if (draft.bodyPages.trim() === '' || !Number.isInteger(bodyPages)) {
    errors.push('正文页数必须是整数');
  }
  if (
    draft.signatureSize.trim() === '' ||
    !Number.isInteger(signatureSize)
  ) {
    errors.push('signatureSize 必须是整数');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  try {
    return {
      ok: true,
      imposition: impose({
        bodyPages,
        signatureSize,
        binding: draft.binding,
        flip: draft.flip,
      }),
    };
  } catch (err) {
    if (err instanceof ImpositionError) {
      return { ok: false, errors: err.errors };
    }
    throw err;
  }
}

/** 库存拼版入口：库存不足时返回以 NO_IMPOSITION 开头的错误，不产生部分纸张。 */
export function commitInventoryParams(draft: Draft): CommitOutcome {
  const bodyPages = Number(draft.bodyPages);
  const errors: string[] = [];

  if (draft.bodyPages.trim() === '' || !Number.isInteger(bodyPages)) {
    errors.push('正文页数必须是整数');
  }

  const stock: InventoryStockItem[] = [];
  draft.inventoryRows.forEach((row, i) => {
    const capacity = Number(row.capacity);
    const count = Number(row.count);
    if (row.capacity.trim() === '' || !Number.isInteger(capacity)) {
      errors.push(`第 ${i + 1} 种签帖容量必须是整数`);
    }
    if (row.count.trim() === '' || !Number.isInteger(count)) {
      errors.push(`第 ${i + 1} 种签帖可用册数必须是整数`);
    }
    stock.push({ capacity, count });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  try {
    return {
      ok: true,
      imposition: imposeInventory({
        bodyPages,
        binding: draft.binding,
        flip: draft.flip,
        stock,
      }),
    };
  } catch (err) {
    if (err instanceof ImpositionError) {
      return { ok: false, errors: err.errors };
    }
    if (err instanceof InventoryShortageError) {
      return {
        ok: false,
        errors: [`${NO_IMPOSITION}：现有库存不足以装订 ${bodyPages} 页正文`],
      };
    }
    throw err;
  }
}

/** 按当前模式分发到固定容量或库存拼版入口。 */
export function commitDraft(draft: Draft): CommitOutcome {
  return draft.mode === 'inventory'
    ? commitInventoryParams(draft)
    : commitParams(draft);
}

/** 当前已确认的拼版状态（与表单草稿分离）。 */
export interface ResultState {
  /** 上次合法拼版；非法提交永远不会覆盖它。 */
  imposition: AnyImposition;
  errors: string[];
  /** 草稿自上次成功提交后被改动过（或上次提交失败）。 */
  stale: boolean;
}

export type ResultAction =
  | { type: 'committed'; imposition: AnyImposition }
  | { type: 'rejected'; errors: string[] }
  | { type: 'draftChanged' };

/**
 * 纯 reducer：rejected 分支刻意保留 state.imposition，
 * 保证任何非法参数组合（含库存不足）都不会覆盖上次合法拼版。
 */
export function resultReducer(state: ResultState, action: ResultAction): ResultState {
  switch (action.type) {
    case 'committed':
      return { imposition: action.imposition, errors: [], stale: false };
    case 'rejected':
      return { ...state, errors: action.errors, stale: true };
    case 'draftChanged':
      return { ...state, stale: true };
  }
}

export function createInitialResult(): ResultState {
  const outcome = commitParams(DEFAULT_DRAFT);
  if (!outcome.ok) {
    throw new Error('默认参数必须合法');
  }
  return { imposition: outcome.imposition, errors: [], stale: false };
}
