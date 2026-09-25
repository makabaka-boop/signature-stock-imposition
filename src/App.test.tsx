import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

// React 18 并发渲染测试环境标记
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderApp(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return { container, root };
}

function setNumberInput(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('App 冒烟', () => {
  it('默认展示 8 页合法拼版，表格行数 = 纸张数', () => {
    const { container, root } = renderApp();
    expect(container.textContent).toContain('8 页正文');
    expect(container.textContent).toContain('2 张实体纸');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    act(() => root.unmount());
  });

  it('非法输入不覆盖上次合法拼版，合法提交后更新', () => {
    const { container, root } = renderApp();
    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    );
    const bodyPagesInput = inputs[0]!;
    const applyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '生成拼版',
    )!;

    // 非法：0 页
    setNumberInput(bodyPagesInput, '0');
    click(applyBtn);
    expect(container.textContent).toContain('参数非法，已保留上次合法拼版');
    expect(container.textContent).toContain('8 页正文');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    // 合法：12 页 / 默认 8 帖容量 → 2 帖 4 张纸
    setNumberInput(bodyPagesInput, '12');
    click(applyBtn);
    expect(container.textContent).not.toContain('参数非法');
    expect(container.textContent).toContain('12 页正文');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    act(() => root.unmount());
  });

  it('页码反查显示签帖/纸张/面/槽位', () => {
    const { container, root } = renderApp();
    const lookupInput = container.querySelector<HTMLInputElement>(
      '.lookup input',
    )!;
    setNumberInput(lookupInput, '8');
    const result = container.querySelector('[data-testid="lookup-result"]');
    expect(result?.textContent).toContain('第 8 页');
    expect(result?.textContent).toContain('签帖 1');
    expect(result?.textContent).toContain('正面左');
    act(() => root.unmount());
  });
});
