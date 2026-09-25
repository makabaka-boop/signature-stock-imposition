import { useMemo, useReducer, useState } from 'react';
import { impositionToJson } from './imposition/imposition';
import {
  commitParams,
  createInitialResult,
  DEFAULT_DRAFT,
  emptyInventoryRow,
  resultReducer,
  type Draft,
  type InventoryDraft,
} from './imposition/state';
import type { Imposition } from './imposition/types';
import SheetTable from './components/SheetTable';
import PageLookup from './components/PageLookup';

/** 切到库存模式时给一份 2 行的初始库存草稿（保留正文页数与装订/翻纸设置）。 */
function toInventoryDraft(draft: Draft): InventoryDraft {
  const rows =
    draft.mode === 'inventory'
      ? draft.rows
      : [
          { size: '4', count: '2' },
          { size: '8', count: '2' },
        ];
  return {
    mode: 'inventory',
    bodyPages: draft.bodyPages,
    binding: draft.binding,
    flip: draft.flip,
    rows,
  };
}

function toFixedDraft(draft: Draft): Draft {
  if (draft.mode === 'fixed') return draft;
  return {
    mode: 'fixed',
    bodyPages: draft.bodyPages,
    signatureSize: '8',
    binding: draft.binding,
    flip: draft.flip,
  };
}

function summaryOf(imposition: Imposition): string {
  const base =
    `${imposition.bodyPages} 页正文 · ${imposition.signatureCount} 个签帖 · ` +
    `${imposition.sheetCount} 张实体纸 · 补白 ${imposition.blankCount} 页`;
  if (imposition.mode === 'inventory') {
    return `${base} · 容量序列 ${imposition.signatureSizes.join(' / ')}`;
  }
  return base;
}

function downloadName(data: ReturnType<typeof impositionToJson>): string {
  if ('mode' in data && data.mode === 'inventory') {
    return `imposition-${data.bodyPages}p-inv-${data.signatureSizes.join('-')}-${data.binding}-${data.flip}.json`;
  }
  return `imposition-${data.bodyPages}p-s${data.signatureSize}-${data.binding}-${data.flip}.json`;
}

export default function App() {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [result, dispatch] = useReducer(
    resultReducer,
    undefined,
    createInitialResult,
  );

  const updateDraft = (next: Draft) => {
    setDraft(next);
    dispatch({ type: 'draftChanged' });
  };

  const switchMode = (mode: 'fixed' | 'inventory') => {
    if (mode === draft.mode) return;
    updateDraft(mode === 'inventory' ? toInventoryDraft(draft) : toFixedDraft(draft));
  };

  const updateInventoryRow = (
    index: number,
    patch: Partial<{ size: string; count: string }>,
  ) => {
    if (draft.mode !== 'inventory') return;
    const rows = draft.rows.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    updateDraft({ ...draft, rows });
  };

  const setRowCount = (count: number) => {
    if (draft.mode !== 'inventory') return;
    const rows = [...draft.rows];
    while (rows.length < count) rows.push(emptyInventoryRow());
    rows.length = count;
    updateDraft({ ...draft, rows });
  };

  const handleApply = () => {
    const outcome = commitParams(draft);
    if (outcome.ok) {
      dispatch({ type: 'committed', imposition: outcome.imposition });
    } else {
      dispatch({
        type: 'rejected',
        errors: outcome.errors,
        noImposition: outcome.noImposition,
      });
    }
  };

  const handleDownload = () => {
    const data = impositionToJson(result.imposition);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName(data);
    a.click();
    URL.revokeObjectURL(url);
  };

  const { imposition } = result;
  const summary = useMemo(() => summaryOf(imposition), [imposition]);

  return (
    <div className="app">
      <header>
        <h1>骑马订拼版检查台</h1>
        <p className="subtitle">
          小批量手册印前核对：每一页正文落在哪张实体纸、哪一面、哪个槽位。
        </p>
      </header>

      <section className="panel controls" aria-label="拼版参数">
        <fieldset>
          <legend>拼版入口</legend>
          <label>
            <input
              type="radio"
              name="mode"
              checked={draft.mode === 'fixed'}
              onChange={() => switchMode('fixed')}
            />
            固定容量
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={draft.mode === 'inventory'}
              onChange={() => switchMode('inventory')}
            />
            库存拼版
          </label>
        </fieldset>

        <label>
          正文页数（1–512）
          <input
            aria-label="正文页数"
            type="number"
            min={1}
            max={512}
            value={draft.bodyPages}
            onChange={(e) => updateDraft({ ...draft, bodyPages: e.target.value })}
          />
        </label>

        {draft.mode === 'fixed' && (
          <label>
            签帖容量 signatureSize（4–32，4 的倍数）
            <input
              aria-label="签帖容量"
              type="number"
              min={4}
              max={32}
              step={4}
              value={draft.signatureSize}
              onChange={(e) =>
                updateDraft({ ...draft, signatureSize: e.target.value })
              }
            />
          </label>
        )}

        {draft.mode === 'inventory' && (
          <fieldset className="inventory-fieldset">
            <legend>库存签帖（2～4 种，容量 4–32 的 4 的倍数，册数 0–8）</legend>
            <div className="inventory-rows">
              {draft.rows.map((row, i) => (
                <div className="inventory-row" key={i}>
                  <label>
                    容量
                    <input
                      aria-label={`库存签帖 ${i + 1} 容量`}
                      type="number"
                      min={4}
                      max={32}
                      step={4}
                      value={row.size}
                      onChange={(e) => updateInventoryRow(i, { size: e.target.value })}
                    />
                  </label>
                  <label>
                    册数
                    <input
                      aria-label={`库存签帖 ${i + 1} 册数`}
                      type="number"
                      min={0}
                      max={8}
                      value={row.count}
                      onChange={(e) => updateInventoryRow(i, { count: e.target.value })}
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="inventory-row-count">
              {[2, 3, 4].map((n) => (
                <label key={n}>
                  <input
                    type="radio"
                    name="inventory-row-count"
                    checked={draft.rows.length === n}
                    onChange={() => setRowCount(n)}
                  />
                  {n} 种
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>装订方向</legend>
          <label>
            <input
              type="radio"
              name="binding"
              checked={draft.binding === 'left'}
              onChange={() => updateDraft({ ...draft, binding: 'left' })}
            />
            左订（西式）
          </label>
          <label>
            <input
              type="radio"
              name="binding"
              checked={draft.binding === 'right'}
              onChange={() => updateDraft({ ...draft, binding: 'right' })}
            />
            右订（中式）
          </label>
        </fieldset>
        <fieldset>
          <legend>翻纸方式</legend>
          <label>
            <input
              type="radio"
              name="flip"
              checked={draft.flip === 'long'}
              onChange={() => updateDraft({ ...draft, flip: 'long' })}
            />
            长边翻转
          </label>
          <label>
            <input
              type="radio"
              name="flip"
              checked={draft.flip === 'short'}
              onChange={() => updateDraft({ ...draft, flip: 'short' })}
            />
            短边翻转
          </label>
        </fieldset>
        <button type="button" className="primary" onClick={handleApply}>
          生成拼版
        </button>
        <button type="button" onClick={handleDownload}>
          下载 JSON
        </button>
      </section>

      {result.errors.length > 0 && (
        <div className="panel error" role="alert">
          <strong>
            {result.noImposition
              ? '库存不足，NO_IMPOSITION，已保留上次合法拼版：'
              : '参数非法，已保留上次合法拼版：'}
          </strong>
          <ul>
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {result.stale && result.errors.length === 0 && (
        <div className="panel hint">参数已修改，点击「生成拼版」后生效。</div>
      )}

      <section className="panel">
        <h2>当前拼版</h2>
        <p className="summary">{summary}</p>
        <p className="summary">
          入口：{imposition.mode === 'fixed' ? '固定容量' : '库存拼版'} · 模式：
          {imposition.binding === 'left' ? '左订' : '右订'} ·{' '}
          {imposition.flip === 'long' ? '长边翻转' : '短边翻转'}
        </p>
        {imposition.mode === 'fixed' && (
          <p className="summary muted">固定容量 signatureSize = {imposition.signatureSize}</p>
        )}
      </section>

      <PageLookup imposition={imposition} />

      <SheetTable imposition={imposition} />
    </div>
  );
}
