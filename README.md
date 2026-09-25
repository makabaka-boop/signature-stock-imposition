# 骑马订拼版检查台（Saddle-Stitch Imposition Checker）

离线纯前端工具，供装订员在印刷前核对小批量骑马订手册每一页正文落在哪一张
实体纸、哪一面、哪个槽位，避免补 BLANK 或切换翻纸方式后页码倒置、签帖串页。

- TypeScript + React 18 + Vite，无任何运行时后端依赖
- Vitest 金样（4 / 8 / 12 页）+ 全模式正反向互查性质测试
- Docker Compose 运行 Nginx 静态托管

## 参数

### 固定容量入口（旧入口，行为不变）

| 参数 | 规则 |
| --- | --- |
| 正文页数 bodyPages | 1–512 的整数 |
| signatureSize | 4–32 且为 4 的倍数 |
| 装订方向 | 左订 / 右订 |
| 翻纸方式 | 长边翻转 / 短边翻转 |

### 库存拼版入口

装订车间临时只剩零散签帖时使用：

| 参数 | 规则 |
| --- | --- |
| 正文页数 bodyPages | 1–512 的整数 |
| 库存签帖 | 2～4 种，容量互不相同、4–32 且为 4 的倍数 |
| 各容量可用册数 | 0～8 的整数（0 册允许，仅表示该种暂时不可用） |
| 装订方向 / 翻纸方式 | 同固定入口 |

每本书按签帖顺序连续装页：**前面签帖必须装满，仅最后一帖可补 `BLANK`**
（末帖至少装 1 个正文页，不允许空帖）。容量序列按以下顺序取最优：

1. 总补白页最少；
2. 使用签帖数最少；
3. 容量序列字典序最小。

库存不足（无任何可行序列）时返回 **`NO_IMPOSITION`**，不生成部分纸张，
界面保留上次合法拼版。库存条目本身非法（容量重复/越界、册数越界等）同样
保留上次合法拼版。

非法参数组合不会覆盖上次合法拼版（界面保留旧结果并报错）。

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
导出时不另写公式；库存拼版逐帖复用同一套槽位映射，各帖容量来自选中的
容量序列，全局纸张编号（`sheetIndex`）跨签帖连续。

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

库存拼版导出额外带 `mode: "inventory"`、`signatureSizes`、`usedSignatures`，
每张纸带所属帖容量 `signatureSize`；固定容量入口的导出结构保持不变。
10 页 / 库存 `{4×2, 8×2}`（选中序列 `[4, 8]`）示例：

```json
{
  "mode": "inventory",
  "bodyPages": 10,
  "binding": "left",
  "flip": "long",
  "signatureCount": 2,
  "sheetCount": 3,
  "blankCount": 2,
  "signatureSizes": [4, 8],
  "usedSignatures": [{ "size": 4, "used": 1 }, { "size": 8, "used": 1 }],
  "sheets": [
    { "sheetIndex": 1, "signature": 1, "sheetInSignature": 1,
      "signatureSize": 4,
      "frontLeft": 4, "frontRight": 1, "backLeft": 2, "backRight": 3 },
    { "sheetIndex": 2, "signature": 2, "sheetInSignature": 1,
      "signatureSize": 8,
      "frontLeft": "BLANK", "frontRight": 5, "backLeft": 6, "backRight": "BLANK" },
    { "sheetIndex": 3, "signature": 2, "sheetInSignature": 2,
      "signatureSize": 8,
      "frontLeft": 10, "frontRight": 7, "backLeft": 8, "backRight": 9 }
  ]
}
```
