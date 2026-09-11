# cesium-tianditu-terrain

> **现代 ESM 实现的天地图三维地形 Provider for Cesium**  
> 彻底解决官方旧 SDK 在 Vite/Webpack 环境下的 `Cannot redefine property` 崩溃问题

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Cesium](https://img.shields.io/badge/Cesium-1.100%2B-green)](https://cesium.com)
[![pako](https://img.shields.io/badge/pako-3.x-orange)](https://github.com/nodeca/pako)

---

## 🌟 背景与痛点

天地图官方提供的三维地形 SDK（`Cesium_ext_min.js`，约 2.5MB）在现代前端工程中存在**致命缺陷**：

```
TypeError: Cannot redefine property: primitiveAdded
```

**根本原因**：该 SDK 编写于 2018 年前后，通过 `Object.defineProperties(Cesium.Scene.prototype, ...)` 强行向 Cesium 原型注入属性。在 Vite/ESM 打包的 Cesium 产物中，这些属性被标记为 `configurable: false`，ECMAScript 规范禁止对不可配置属性再次定义，导致整个 SDK 初始化崩溃，地图白屏卡死。

本项目对官方 SDK 进行了**逆向工程与协议解析**，以 100% 纯 ESM 方式重写，无任何原型污染。

---

## ✨ 特性

| 对比维度 | 官方旧 SDK | 本项目 |
|:---|:---|:---|
| **模块格式** | 旧版 UMD 全局闭包 | 原生 ESM（`import/export`） |
| **原型污染** | 暴力修改 `Object.defineProperties` | ✅ **零污染** |
| **崩溃修复** | 无法兼容 Vite/ESM | ✅ **彻底解决 Cannot redefine property** |
| **包体积** | 2,498 KB（2.5MB） | 单文件 ~6KB + pako ~14KB |
| **全局变量** | 强依赖 `window.Cesium` | ✅ 模块级引用，支持 Tree-shaking |
| **兼容性** | Vite/Webpack 5/React 18+ 崩溃 | ✅ 完美兼容 Vite 5/6/8、React 18/19 |

---

## 🚀 快速开始

### 安装

```bash
npm install cesium pako
```

### 使用

直接复制 `src/TiandituTerrainProvider.js` 到你的项目：

```js
import * as Cesium from "cesium";
import { TiandituTerrainProvider } from "./TiandituTerrainProvider";

const TIANDITU_KEY = "你的天地图Token";

const provider = new TiandituTerrainProvider({
  urls: [
    `https://t0.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk=${TIANDITU_KEY}`,
    `https://t1.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk=${TIANDITU_KEY}`,
    // 可传入 t0~t7 共 8 个子域名实现负载均衡
  ],
});

viewer.terrainProvider = provider;
```

### 开发代理配置（Vite）

天地图服务对空 `Referer` 会返回 418，开发时需要通过 Vite proxy 伪造合法来源：

```js
// vite.config.js
export default defineConfig({
  server: {
    proxy: {
      "/tianditu-terrain": {
        target: "https://t0.tianditu.gov.cn",
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("referer", "https://www.tianditu.gov.cn/");
            proxyReq.setHeader("origin", "https://www.tianditu.gov.cn");
          });
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["access-control-allow-origin"] = "*";
          });
        },
        rewrite: (path) =>
          path.replace(/^\/tianditu-terrain/, "/mapservice/swdx"),
      },
    },
  },
});
```

开发时 URL 写法：

```js
const provider = new TiandituTerrainProvider({
  urls: [`/tianditu-terrain?T=elv_c&tk=${TIANDITU_KEY}`],
});
```

### 生产环境（Nginx）

```nginx
location /tianditu-terrain/ {
    proxy_pass https://t0.tianditu.gov.cn/mapservice/swdx;
    proxy_set_header Host t0.tianditu.gov.cn;
    proxy_set_header Referer "https://www.tianditu.gov.cn/";
    proxy_set_header Origin "https://www.tianditu.gov.cn";
    proxy_ssl_server_name on;
    add_header Access-Control-Allow-Origin *;
}
```

---

## 🔬 协议说明

天地图三维高程服务（`swdx`）使用私有协议，非 OGC 标准的 quantized-mesh：

| 参数 | 值 | 说明 |
|:---|:---|:---|
| **端点** | `https://t{0-7}.tianditu.gov.cn/mapservice/swdx` | 支持 8 个子域名 |
| **服务类型** | `T=elv_c` | 经纬度投影高程瓦片 |
| **坐标系** | CGCS2000 (≈ WGS84) | 使用 `GeographicTilingScheme` |
| **层级参数** | `l = level + 1` | ⚠️ 天地图约定，非 level 本身 |
| **Token** | `tk=YOUR_KEY` | 必传 |
| **响应格式** | zlib 压缩的 150×150 INT16 格网 | 45000 字节 |

解析流程：

```
HTTP 响应（zlib 压缩）
    │
    ▼ pako.inflate()
原始高程格网（150×150 × 2字节 = 45000 字节）
    │
    ▼ 邻近采样重映射（150×150 → 64×64）+ RGBA 编码
HeightmapTerrainData（64×64 RGBA，heightScale=0.001，heightOffset=-1000）
```

---

## 📦 运行 Demo

```bash
# 1. 克隆项目
git clone https://github.com/YOUR_USERNAME/cesium-tianditu-terrain.git
cd cesium-tianditu-terrain

# 2. 安装依赖
npm install

# 3. 配置 Token
cp .env.example .env
# 编辑 .env，填入你的天地图 Token

# 4. 启动开发服务
npm run dev
```

---

## 📄 API 文档

### `new TiandituTerrainProvider(options)`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|:---|:---|:---|:---|:---|
| `options.urls` | `string or string[]` | ✅ | - | 天地图地形服务 URL，可传多个子域名实现负载均衡 |
| `options.dataType` | `"int" or "float"` | ❌ | `"int"` | 高程数据类型 |
| `options.topLevel` | `number` | ❌ | `5` | 低于此层级返回平坦基础地表 |
| `options.bottomLevel` | `number` | ❌ | `25` | 高于此层级停止请求 |
| `options.credit` | `string or Cesium.Credit` | ❌ | `"天地图三维地形"` | 版权信息 |
| `options.ellipsoid` | `Cesium.Ellipsoid` | ❌ | `Cesium.Ellipsoid.WGS84` | 椭球体 |

---

## 📝 License

[MIT](./LICENSE)

---

## 🙏 致谢

- [Cesium](https://cesium.com) - 三维地球引擎
- [天地图](https://www.tianditu.gov.cn/) - 国家地理信息公共服务平台
- [pako](https://github.com/nodeca/pako) - 高性能 zlib 实现
