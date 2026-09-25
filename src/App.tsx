import { useMemo, useReducer, useState } from 'react';
import { impositionToJson } from './imposition/imposition';
import {
  commitDraft,
  createInitialResult,
  DEFAULT_DRAFT,
  resultReducer,
  type Draft,
} from './imposition/state';
import SheetTable from './components/SheetTable';
import PageLookup from './components/PageLookup';

const MIN_STOCK_ROWS = 2;
const MAX_STOCK_ROWS = 4;

export default function App() {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [result, dispatch] = useReducer(resultReducer, undefined, createInitialResult);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    dispatch({ type: 'draftChanged' });
  };

  const updateInventoryRow = (
    index: number,
    patch: Partial<{ capacity: string; count: string }>,
  ) => {
    updateDraft({
      inventoryRows: draft.inventoryRows.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  };

  const addInventoryRow = () => {
    if (draft.inventoryRows.length >= MAX_STOCK_ROWS) return;
    updateDraft({
      inventoryRows: [...draft.inventoryRows, { capacity: '4', count: '1' }],
    });
  };

  const removeInventoryRow = (index: number) => {
    if (draft.inventoryRows.length <= MIN_STOCK_ROWS) return;
    updateDraft({
      inventoryRows: draft.inventoryRows.filter((_, i) => i !== index),
    });
  };

  const handleApply = () => {
    const outcome = commitDraft(draft);
    if (outcome.ok) {
      dispatch({ type: 'committed', imposition: outcome.imposition });
    } else {
      dispatch({ type: 'rejected', errors: outcome.errors });
    }
  };

  const handleDownload = () => {
    const { imposition: current } = result;
    // 两个分支分别命中 impositionToJson 的固定容量 / 库存重载；
    // 序列化都只读取同一个 Imposition 映射，不另行计算。
    const data =
      'signatureSize' in current
        ? impositionToJson(current)
        : impositionToJson(current);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      'signatureSize' in data
        ? `imposition-${data.bodyPages}p-s${data.signatureSize}-${data.binding}-${data.flip}.json`
        : `imposition-${data.bodyPages}p-stock-${data.signatureSizes.join('x')}-${data.binding}-${data.flip}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const { imposition } = result;
  const summary = useMemo(
    () =>
      `${imposition.bodyPages} 页正文 · ${imposition.signatureCount} 个签帖 · ` +
      `${imposition.sheetCount} 张实体纸 · 补白 ${imposition.blankCount} 页`,
    [imposition],
  );
  const sequenceSummary = useMemo(() => {
    if ('signatureSize' in imposition) {
      return `固定容量：每帖 ${imposition.signatureSize} 页`;
    }
    return `容量序列：${imposition.signatureSizes.join(' + ')}`;
  }, [imposition]);

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
          <legend>拼版流程</legend>
          <label>
            <input
              type="radio"
              name="mode"
              checked={draft.mode === 'fixed'}
              onChange={() => updateDraft({ mode: 'fixed' })}
            />
            固定容量
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={draft.mode === 'inventory'}
              onChange={() => updateDraft({ mode: 'inventory' })}
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
            onChange={(e) => updateDraft({ bodyPages: e.target.value })}
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
              onChange={(e) => updateDraft({ signatureSize: e.target.value })}
            />
          </label>
        )}
        {draft.mode === 'inventory' && (
          <fieldset className="stock-rows" aria-label="签帖库存">
            <legend>签帖库存（2–4 种，容量 4–32 且为 4 的倍数，册数 0–8）</legend>
            {draft.inventoryRows.map((row, i) => (
              <div className="stock-row" key={i}>
                <label>
                  容量 {i + 1}
                  <input
                    aria-label={`容量 ${i + 1}`}
                    type="number"
                    min={4}
                    max={32}
                    step={4}
                    value={row.capacity}
                    onChange={(e) =>
                      updateInventoryRow(i, { capacity: e.target.value })
                    }
                  />
                </label>
                <label>
                  册数 {i + 1}
                  <input
                    aria-label={`册数 ${i + 1}`}
                    type="number"
                    min={0}
                    max={8}
                    value={row.count}
                    onChange={(e) =>
                      updateInventoryRow(i, { count: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`删除第 ${i + 1} 种`}
                  disabled={draft.inventoryRows.length <= MIN_STOCK_ROWS}
                  onClick={() => removeInventoryRow(i)}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={draft.inventoryRows.length >= MAX_STOCK_ROWS}
              onClick={addInventoryRow}
            >
              添加一种签帖
            </button>
          </fieldset>
        )}
        <fieldset>
          <legend>装订方向</legend>
          <label>
            <input
              type="radio"
              name="binding"
              checked={draft.binding === 'left'}
              onChange={() => updateDraft({ binding: 'left' })}
            />
            左订（西式）
          </label>
          <label>
            <input
              type="radio"
              name="binding"
              checked={draft.binding === 'right'}
              onChange={() => updateDraft({ binding: 'right' })}
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
              onChange={() => updateDraft({ flip: 'long' })}
            />
            长边翻转
          </label>
          <label>
            <input
              type="radio"
              name="flip"
              checked={draft.flip === 'short'}
              onChange={() => updateDraft({ flip: 'short' })}
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
          <strong>参数非法，已保留上次合法拼版：</strong>
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
          模式：{imposition.binding === 'left' ? '左订' : '右订'} ·{' '}
          {imposition.flip === 'long' ? '长边翻转' : '短边翻转'} ·{' '}
          {sequenceSummary}
        </p>
      </section>

      <PageLookup imposition={imposition} />

      <SheetTable imposition={imposition} />
    </div>
  );
}
