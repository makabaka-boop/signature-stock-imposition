import { impose, imposeInventory, ImpositionError } from './imposition';
import { NoImpositionError } from './inventory';
import type {
  Binding,
  Flip,
  Imposition,
  InventoryItem,
} from './types';

/** 固定容量表单草稿：数字以字符串保存，提交时统一解析校验。 */
export interface FixedDraft {
  mode: 'fixed';
  bodyPages: string;
  signatureSize: string;
  binding: Binding;
  flip: Flip;
}

/** 库存拼版表单草稿：各容量册数以字符串保存，提交时统一解析校验。 */
export interface InventoryDraft {
  mode: 'inventory';
  bodyPages: string;
  binding: Binding;
  flip: Flip;
  /** 2～4 行库存（容量 + 可用册数）。 */
  rows: Array<{ size: string; count: string }>;
}

export type Draft = FixedDraft | InventoryDraft;

export const DEFAULT_DRAFT: Draft = {
  mode: 'fixed',
  bodyPages: '8',
  signatureSize: '8',
  binding: 'left',
  flip: 'long',
};

/** 库存模式新建一行空库存（切换到库存模式时的初始行）。 */
export function emptyInventoryRow(): { size: string; count: string } {
  return { size: '', count: '' };
}

/**
 * 提交结果：
 * - 合法 → ok，带新拼版；
 * - 非法 / 库存不足 → 错误列表；库存不足时 noImposition 为 true。
 * 调用方必须保留上次合法拼版，不得覆盖，也不得生成部分纸张。
 */
export type CommitOutcome =
  | { ok: true; imposition: Imposition }
  | { ok: false; errors: string[]; noImposition: boolean };

function commitFixed(draft: FixedDraft): CommitOutcome {
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
    return { ok: false, errors, noImposition: false };
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
      return { ok: false, errors: err.errors, noImposition: false };
    }
    throw err;
  }
}

function commitInventory(draft: InventoryDraft): CommitOutcome {
  const bodyPages = Number(draft.bodyPages);

  if (draft.bodyPages.trim() === '' || !Number.isInteger(bodyPages)) {
    return { ok: false, errors: ['正文页数必须是整数'], noImposition: false };
  }

  // 库存行字符串 → 数字；非整数先在表单层拦下，其余越界交给核心校验。
  let parseOk = true;
  const rows: InventoryItem[] = draft.rows.map((row) => {
    const size = Number(row.size);
    const count = Number(row.count);
    if (
      row.size.trim() === '' ||
      !Number.isInteger(size) ||
      row.count.trim() === '' ||
      !Number.isInteger(count)
    ) {
      parseOk = false;
    }
    return { size, count };
  });
  if (!parseOk) {
    return {
      ok: false,
      errors: ['签帖容量与可用册数必须都是整数（容量 4–32 的 4 的倍数，册数 0–8）'],
      noImposition: false,
    };
  }

  try {
    return {
      ok: true,
      imposition: imposeInventory({
        bodyPages,
        inventory: rows,
        binding: draft.binding,
        flip: draft.flip,
      }),
    };
  } catch (err) {
    if (err instanceof NoImpositionError) {
      return { ok: false, errors: [err.message], noImposition: true };
    }
    if (err instanceof ImpositionError) {
      return { ok: false, errors: err.errors, noImposition: false };
    }
    throw err;
  }
}

export function commitParams(draft: Draft): CommitOutcome {
  return draft.mode === 'fixed' ? commitFixed(draft) : commitInventory(draft);
}

/** 当前已确认的拼版状态（与表单草稿分离）。 */
export interface ResultState {
  /** 上次合法拼版；非法提交或 NO_IMPOSITION 永远不会覆盖它。 */
  imposition: Imposition;
  errors: string[];
  /** 上次失败是否为库存不足（NO_IMPOSITION）。 */
  noImposition: boolean;
  /** 草稿自上次成功提交后被改动过（或上次提交失败）。 */
  stale: boolean;
}

export type ResultAction =
  | { type: 'committed'; imposition: Imposition }
  | { type: 'rejected'; errors: string[]; noImposition: boolean }
  | { type: 'draftChanged' };

/**
 * 纯 reducer：rejected 分支刻意保留 state.imposition，
 * 保证任何非法参数组合或库存不足都不会覆盖上次合法拼版。
 */
export function resultReducer(state: ResultState, action: ResultAction): ResultState {
  switch (action.type) {
    case 'committed':
      return {
        imposition: action.imposition,
        errors: [],
        noImposition: false,
        stale: false,
      };
    case 'rejected':
      return {
        ...state,
        errors: action.errors,
        noImposition: action.noImposition,
        stale: true,
      };
    case 'draftChanged':
      return { ...state, stale: true };
  }
}

export function createInitialResult(): ResultState {
  const outcome = commitParams(DEFAULT_DRAFT);
  if (!outcome.ok) {
    throw new Error('默认参数必须合法');
  }
  return {
    imposition: outcome.imposition,
    errors: [],
    noImposition: false,
    stale: false,
  };
}
