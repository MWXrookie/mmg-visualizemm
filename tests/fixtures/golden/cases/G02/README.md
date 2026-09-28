# G02 校园实验耗材供应商综合评价

原创合成题，用于验证多工作表 XLSX、成本/效益指标方向、缺失值填补、加权综合评价和权重敏感性。

- 数据与题干均由 MMG 项目原创生成，不包含真实供应商或个人信息。
- `attachments/供应商数据.xlsx` 由 `npm run generate:golden-fixtures` 生成；默认保留已存在文件，需要重建时显式追加 `-- --force`。
- `baseline.mjs` 是可复现最低基线，不代表唯一正确建模方法。

运行基线：

```bash
node tests/fixtures/golden/cases/G02/baseline.mjs
```
