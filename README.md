# 骑马订拼版检查台（Saddle-Stitch Imposition Checker）

离线纯前端工具，供装订员在印刷前核对小批量骑马订手册每一页正文落在哪一张
实体纸、哪一面、哪个槽位，避免补 BLANK 或切换翻纸方式后页码倒置、签帖串页。

- TypeScript + React 18 + Vite，无任何运行时后端依赖
- Vitest 金样（4 / 8 / 12 页）+ 全模式正反向互查性质测试
- Docker Compose 运行 Nginx 静态托管

## 参数

| 参数 | 规则 |
| --- | --- |
| 正文页数 bodyPages | 1–512 的整数 |
| signatureSize | 4–32 且为 4 的倍数（固定容量流程） |
| 装订方向 | 左订 / 右订 |
| 翻纸方式 | 长边翻转 / 短边翻转 |

非法参数组合不会覆盖上次合法拼版（界面保留旧结果并报错）。

## 库存拼版流程

装订车间临时只剩不同容量的签帖时，切换到「库存拼版」：输入正文页数、
装订/翻纸方式，以及 **2–4 种**互不相同的签帖容量（4–32 且为 4 的倍数）
和各自 **0–8** 的可用册数。每本书按签帖顺序连续装页：除最后一帖可补
`BLANK` 外，前面的签帖必须装满。

规划目标依次是：

1. **最小化总补白页**（= 选定容量之和 − 正文页数）；
2. **最小化使用签帖数**（容量序列长度）；
3. 取**容量序列字典序最小**者（升序排列即字典序最小）。

库存总容量不足以覆盖正文页数时返回 `NO_IMPOSITION`，不生成任何部分纸张；
非法库存输入同样保留上次合法拼版。选定序列后逐帖复用与固定容量完全相同
的物理槽位映射——页码反查、翻面卡片、表格与下载 JSON 指向同一全局纸张
编号，导出时不另行计算。固定容量旧入口及四种翻转模式的结果保持不变。

## 拼版规则（系统内只有这一套公式）

每个签帖独立补 `BLANK` 到满帖，再按实体纸张顺序生成
`frontLeft / frontRight / backLeft / backRight`：

1. **左订长边基准**：帖容量 `m`，帖内第 `k` 张（k 从 0 起）

   | frontLeft | frontRight | backLeft | backRight |
   | --- | --- | --- | --- |
   | m−2k | 2k+1 | 2k+2 | m−2k−1 |

2. **右订**：在基准上交换每一张纸**每一面**的左右槽位；
3. **短边翻转**：再只对**背面**交换左右槽位（长边背面不变）。

表格、可翻面卡片、页码反查与下载 JSON 共用同一个 `Imposition` 映射，
导出时不另写公式。

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # Vitest 全量测试
npm run build      # 类型检查 + 产出 dist/
npm run preview    # 本地预览构建产物
```

## Docker Compose 运行

```bash
docker compose up --build -d
# 浏览器打开 http://localhost:8080
```

镜像构建阶段会先跑 `npm run test`，测试失败则镜像不产出。

## JSON 导出示例

```json
{
  "bodyPages": 12,
  "signatureSize": 8,
  "binding": "left",
  "flip": "long",
  "signatureCount": 2,
  "sheetCount": 4,
  "blankCount": 4,
  "sheets": [
    { "sheetIndex": 1, "signature": 1, "sheetInSignature": 1,
      "frontLeft": 8, "frontRight": 1, "backLeft": 2, "backRight": 7 },
    { "sheetIndex": 3, "signature": 2, "sheetInSignature": 1,
      "frontLeft": "BLANK", "frontRight": 9, "backLeft": 10, "backRight": "BLANK" }
  ],
  "locations": [{ "page": 1, "signature": 1, "sheetIndex": 1,
                  "sheetInSignature": 1, "face": "front", "slot": "frontRight" }]
}
```

库存拼版导出不带 `signatureSize`，改为携带选定容量序列与耗用库存：

```json
{
  "bodyPages": 9,
  "binding": "left",
  "flip": "long",
  "signatureCount": 2,
  "sheetCount": 3,
  "blankCount": 3,
  "sheets": [
    { "sheetIndex": 1, "signature": 1, "sheetInSignature": 1,
      "frontLeft": 4, "frontRight": 1, "backLeft": 2, "backRight": 3 },
    { "sheetIndex": 2, "signature": 2, "sheetInSignature": 1,
      "frontLeft": "BLANK", "frontRight": 5, "backLeft": 6, "backRight": "BLANK" }
  ],
  "signatureSizes": [4, 8],
  "usedStock": [{ "capacity": 4, "count": 1 }, { "capacity": 8, "count": 1 }],
  "locations": [{ "page": 1, "signature": 1, "sheetIndex": 1,
                  "sheetInSignature": 1, "face": "front", "slot": "frontRight" }]
}
```
