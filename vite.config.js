import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [react(), cesium()],
  base: "./", // 使用相对路径，支持 Live Server / file:// 协议直接打开 dist
  server: {
    port: 5173,
    open: true,
    proxy: {
      // 天地图三维地形瓦片代理（swdx 服务）
      // 作用：将 /tianditu-terrain?T=elv_c&x=...&y=...&l=...&tk=KEY
      //       转发到 https://t0.tianditu.gov.cn/mapservice/swdx?...
      // 同时注入合法 Referer / Origin，绕过天地图防盗链
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
            delete proxyRes.headers["access-control-allow-credentials"];
          });
        },
        rewrite: (path) =>
          path.replace(/^\/tianditu-terrain/, "/mapservice/swdx"),
      },
    },
  },
});
