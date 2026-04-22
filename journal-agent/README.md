# 心记 / Journal Agent

一个基于 Vue 3 + TypeScript + Capacitor iOS 的本地优先记录 App。当前已经包含心记、笔记、做记、待办、密库和 Agent 浮窗等能力，并持续按 `feature_list.md` / `feature_list.json` 迭代。

## 开发命令

在项目目录执行：

```bash
cd journal-agent
npm install
npm run build
npx cap sync ios
```

如果你习惯从仓库根目录走脚本，也可以执行根目录的 `run.sh`，它会进入 `journal-agent` 后依次执行构建和 iOS 同步。

## 首页天气提示

心记首页头部现在新增了一块紧凑天气提示，位置在标题右侧、`今日` 计数左侧。

- 数据层使用免费 `Open-Meteo Forecast API`，不需要额外 API Key。
- 定位策略优先使用当前位置；如果用户没有授权或定位失败，会回退到最近一次成功位置，再不行则按当前时区选择默认城市。
- 呈现层使用 Vue + CSS 实现一个轻量 badge，只显示天气图标、概况、温度和高低温，不再占用大面积头部空间。
- iOS 端通过 Capacitor 原生桥接渲染 SF Symbols 天气图标，当前实现的图标桥接名为 `WeatherSymbols`。
- 由于会请求当前位置，iOS 已增加 `NSLocationWhenInUseUsageDescription`。

## 目录说明

- `src/App.vue`: 主界面与交互编排。
- `src/components/JournalWeatherHeroCard.vue`: 首页天气提示组件。
- `src/services/weatherService.ts`: 天气定位、Open-Meteo 拉取与数据整形。
- `src/services/weatherSymbolPlugin.ts`: 前端对原生 SF Symbols 插件的调用封装。
- `ios/App/App/AppDelegate.swift`: iOS 侧自定义 `AppViewController` 与 `WeatherSymbolsPlugin`。

## 验证

每次修改 iOS 相关能力后，至少执行：

```bash
cd journal-agent
npm run build
npx cap sync ios
```
