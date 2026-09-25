import { useMemo, useReducer, useState } from 'react';
import { impositionToJson } from './imposition/imposition';
import {
  commitParams,
  createInitialResult,
  DEFAULT_DRAFT,
  resultReducer,
  type Draft,
} from './imposition/state';
import SheetTable from './components/SheetTable';
import PageLookup from './components/PageLookup';

export default function App() {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [result, dispatch] = useReducer(resultReducer, undefined, createInitialResult);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    dispatch({ type: 'draftChanged' });
  };

  const handleApply = () => {
    const outcome = commitParams(draft);
    if (outcome.ok) {
      dispatch({ type: 'committed', imposition: outcome.imposition });
    } else {
      dispatch({ type: 'rejected', errors: outcome.errors });
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
    a.download = `imposition-${data.bodyPages}p-s${data.signatureSize}-${data.binding}-${data.flip}.json`;
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

  return (
    <div className="app">
      <header>
        <h1>骑马订拼版检查台</h1>
        <p className="subtitle">
          小批量手册印前核对：每一页正文落在哪张实体纸、哪一面、哪个槽位。
        </p>
      </header>

      <section className="panel controls" aria-label="拼版参数">
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
          {imposition.flip === 'long' ? '长边翻转' : '短边翻转'}
        </p>
      </section>

      <PageLookup imposition={imposition} />

      <SheetTable imposition={imposition} />
    </div>
  );
}
