# `@drawmotive/editor`

`@drawmotive/editor` 将提供可嵌入的 DrawMotive 可视化编辑器。它支持从 TextGraph 生成结果或空白画布开始编辑，并由网页、VS Code 和其他宿主复用。

该仓库目前处于基础结构阶段，尚未包含可用的编辑器运行时，因此禁止发布。接入正式 WASM、稳定公共 API 和独立构建验证后才会开放发布。

私有总仓生成的本地 Debug WASM 位于 `.local/`，仅用于联调且不会进入 Git 或 npm 包。正式 Release WASM 将由受验证的发布流程写入 `generated/wasm/`。

## 开发命令

```console
npm ci
npm test
npm run build
npm pack --dry-run
```

## 许可证

代码和随包发布的产物使用 MIT 许可证。
