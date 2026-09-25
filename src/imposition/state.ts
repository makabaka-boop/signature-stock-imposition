import { impose, ImpositionError } from './imposition';
import type { Binding, Flip, Imposition } from './types';

/** 表单草稿：数字以字符串保存，提交时统一解析校验。 */
export interface Draft {
  bodyPages: string;
  signatureSize: string;
  binding: Binding;
  flip: Flip;
}

export const DEFAULT_DRAFT: Draft = {
  bodyPages: '8',
  signatureSize: '8',
  binding: 'left',
  flip: 'long',
};

/**
 * 提交结果：
 * - 合法 → ok，带新拼版；
 * - 非法 → 错误列表，调用方必须保留上次合法拼版，不得覆盖。
 */
export type CommitOutcome =
  | { ok: true; imposition: Imposition }
  | { ok: false; errors: string[] };

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

/** 当前已确认的拼版状态（与表单草稿分离）。 */
export interface ResultState {
  /** 上次合法拼版；非法提交永远不会覆盖它。 */
  imposition: Imposition;
  errors: string[];
  /** 草稿自上次成功提交后被改动过（或上次提交失败）。 */
  stale: boolean;
}

export type ResultAction =
  | { type: 'committed'; imposition: Imposition }
  | { type: 'rejected'; errors: string[] }
  | { type: 'draftChanged' };

/**
 * 纯 reducer：rejected 分支刻意保留 state.imposition，
 * 保证任何非法参数组合都不会覆盖上次合法拼版。
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
