# sl2d

sl2d 是一款运行在浏览器中的 2D 横版动作游戏。项目使用 TypeScript 开发，由 PixiJS 负责渲染、Box2D WASM 负责物理模拟，游戏逻辑通过 ECS 架构运行在 Web Worker 中。

项目包含实时战斗、武器与技能、抓钩、地形交互、光照和昼夜变化，并提供内置编辑器用于制作地图和角色身体。

## 本地运行

```bash
npm install
npm run dev
```

## 代码检查

```bash
npm run lint
npm run format
```

## 架构文档

- [中文](ARCHITECTURE.zh.md)
- [English](ARCHITECTURE.md)

## 许可证

本项目采用 [GNU Affero 通用公共许可证 v3.0（仅此版本）](LICENSE)。
