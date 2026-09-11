import React, { useEffect, useRef, useState, useCallback } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { TiandituTerrainProvider } from "./TiandituTerrainProvider";
import "./App.css";

// ─── 配置区 ───────────────────────────────────────────────────────────────────
// 替换为你自己的天地图 Token（https://umap.tianditu.gov.cn/api/gettoken）
const TIANDITU_KEY = import.meta.env.VITE_TIANDITU_KEY || "";

// 替换为你自己的 Cesium Ion Token（https://ion.cesium.com/tokens）
const ION_TOKEN = import.meta.env.VITE_ION_TOKEN || "";

// 天地图地形 URL 构建
// 开发模式：走 Vite proxy（/tianditu-terrain → t0.tianditu.gov.cn/mapservice/swdx）
// 生产模式：直连天地图多子域名
const buildTerrainUrls = (key) => {
  if (import.meta.env.DEV) {
    return [`/tianditu-terrain?T=elv_c&tk=${key}`];
  }
  return Array.from(
    { length: 8 },
    (_, i) =>
      `https://t${i}.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk=${key}`
  );
};
// ─────────────────────────────────────────────────────────────────────────────

if (ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
}

export default function App() {
  const cesiumRef = useRef(null);
  const viewerRef = useRef(null);
  const tiandituTerrainRef = useRef(null);
  const cesiumIonTerrainRef = useRef(null);

  const [tiandituEnabled, setTiandituEnabled] = useState(false);
  const [cesiumEnabled, setCesiumEnabled] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | ok | error
  const [statusMsg, setStatusMsg] = useState("");
  const [keyInput, setKeyInput] = useState(TIANDITU_KEY);

  // ─── 初始化 Cesium Viewer ───
  useEffect(() => {
    const viewer = new Cesium.Viewer(cesiumRef.current, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });

    // 初始视角：中国广东-深圳
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(114.05, 22.55, 300000),
      duration: 0,
    });

    viewerRef.current = viewer;

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, []);

  // ─── 重置到椭球体地形 ───
  const resetTerrain = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  }, []);

  // ─── 切换天地图三维地形 ───
  const handleTiandituToggle = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (tiandituEnabled) {
      resetTerrain();
      setTiandituEnabled(false);
      setCesiumEnabled(false);
      setStatus("idle");
      setStatusMsg("已关闭天地图地形");
      return;
    }

    if (!keyInput || keyInput === "YOUR_TIANDITU_KEY") {
      setStatus("error");
      setStatusMsg("请先在输入框填入你的天地图 Token");
      return;
    }

    setCesiumEnabled(false);
    setStatus("loading");
    setStatusMsg("正在初始化天地图三维地形...");

    try {
      if (!tiandituTerrainRef.current) {
        const urls = buildTerrainUrls(keyInput);
        console.log("[TiandituTerrain] 初始化 Provider, URL:", urls[0]);
        tiandituTerrainRef.current = new TiandituTerrainProvider({ urls });
      }
      viewer.terrainProvider = tiandituTerrainRef.current;
      setTiandituEnabled(true);
      setStatus("ok");
      setStatusMsg("天地图三维地形已启用 ✓");
    } catch (e) {
      console.error("[TiandituTerrain] 加载失败:", e);
      setStatus("error");
      setStatusMsg(`加载失败: ${e.message}`);
    }
  }, [tiandituEnabled, keyInput, resetTerrain]);

  // ─── 切换 Cesium Ion 自带地形 ───
  const handleCesiumToggle = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (cesiumEnabled) {
      resetTerrain();
      setCesiumEnabled(false);
      setTiandituEnabled(false);
      setStatus("idle");
      setStatusMsg("已关闭 Cesium 地形");
      return;
    }

    if (!ION_TOKEN) {
      setStatus("error");
      setStatusMsg("未配置 Cesium Ion Token，请在 .env 中设置 VITE_ION_TOKEN");
      return;
    }

    setTiandituEnabled(false);
    setStatus("loading");
    setStatusMsg("正在加载 CesiumWorldTerrain...");

    try {
      if (!cesiumIonTerrainRef.current) {
        cesiumIonTerrainRef.current =
          await Cesium.CesiumTerrainProvider.fromIonAssetId(1);
      }
      viewer.terrainProvider = cesiumIonTerrainRef.current;
      setCesiumEnabled(true);
      setStatus("ok");
      setStatusMsg("CesiumWorldTerrain 已启用 ✓");
    } catch (e) {
      console.error("[CesiumTerrain] 加载失败:", e);
      setStatus("error");
      setStatusMsg(`CesiumWorldTerrain 加载失败: ${e.message}`);
    }
  }, [cesiumEnabled, resetTerrain]);

  // Token 变更时重置缓存
  const handleKeyChange = (e) => {
    setKeyInput(e.target.value);
    tiandituTerrainRef.current = null;
  };

  const statusColors = {
    idle: "#64748b",
    loading: "#f59e0b",
    ok: "#22c55e",
    error: "#ef4444",
  };

  return (
    <div className="app-layout">
      {/* ─── 左侧控制面板 ─── */}
      <aside className="panel">
        <div className="panel-header">
          <div className="panel-badge">CESIUM</div>
          <h1 className="panel-title">天地图三维地形</h1>
          <p className="panel-sub">
            现代 ESM 实现 · 无全局污染
            <br />
            彻底解决 Cannot redefine property 崩溃
          </p>
        </div>

        <div className="panel-body">
          {/* Token 配置 */}
          <div className="config-section">
            <label className="config-label">天地图 Token (tk)</label>
            <input
              id="tianditu-token-input"
              className="config-input"
              type="text"
              value={keyInput}
              onChange={handleKeyChange}
              placeholder="输入你的天地图 Token"
              spellCheck={false}
            />
            <div className="config-hint">
              从{" "}
              <a
                href="https://umap.tianditu.gov.cn/api/gettoken"
                target="_blank"
                rel="noreferrer"
              >
                天地图开放平台
              </a>{" "}
              免费申请 Token
            </div>
          </div>

          {/* 状态指示器 */}
          {statusMsg && (
            <div
              className="status-bar"
              style={{ borderColor: statusColors[status] }}
            >
              <span
                className="status-dot"
                style={{ background: statusColors[status] }}
              />
              <span style={{ color: statusColors[status] }}>{statusMsg}</span>
            </div>
          )}

          {/* 地形切换 */}
          <div className="section-title">地形数据源</div>

          <button
            id="btn-tianditu-terrain"
            className={`terrain-btn ${tiandituEnabled ? "terrain-btn--active" : ""}`}
            onClick={handleTiandituToggle}
            disabled={status === "loading"}
          >
            <div className="terrain-btn-icon">🌏</div>
            <div className="terrain-btn-info">
              <div className="terrain-btn-name">天地图三维地形</div>
              <div className="terrain-btn-desc">
                swdx 服务 · CGCS2000 · elv_c
              </div>
            </div>
            <div
              className={`terrain-btn-state ${tiandituEnabled ? "terrain-btn-state--on" : ""}`}
            >
              {tiandituEnabled ? "已开启" : "关闭"}
            </div>
          </button>

          <button
            id="btn-cesium-terrain"
            className={`terrain-btn ${cesiumEnabled ? "terrain-btn--active terrain-btn--cesium" : ""}`}
            onClick={handleCesiumToggle}
            disabled={status === "loading" || !ION_TOKEN}
            title={!ION_TOKEN ? "需在 .env 中配置 VITE_ION_TOKEN" : ""}
          >
            <div className="terrain-btn-icon">🛰️</div>
            <div className="terrain-btn-info">
              <div className="terrain-btn-name">CesiumWorldTerrain</div>
              <div className="terrain-btn-desc">
                Cesium Ion · Asset ID 1
                {!ION_TOKEN && (
                  <span style={{ color: "#f59e0b" }}>（需配置 Ion Token）</span>
                )}
              </div>
            </div>
            <div
              className={`terrain-btn-state ${cesiumEnabled ? "terrain-btn-state--on" : ""}`}
            >
              {cesiumEnabled ? "已开启" : "关闭"}
            </div>
          </button>

          <button
            id="btn-reset-terrain"
            className="terrain-btn"
            onClick={() => {
              resetTerrain();
              setTiandituEnabled(false);
              setCesiumEnabled(false);
              setStatus("idle");
              setStatusMsg("已重置为椭球体（无地形）");
            }}
          >
            <div className="terrain-btn-icon">⭕</div>
            <div className="terrain-btn-info">
              <div className="terrain-btn-name">椭球体（无地形）</div>
              <div className="terrain-btn-desc">EllipsoidTerrainProvider</div>
            </div>
          </button>
        </div>

        <div className="panel-footer">
          <div className="footer-row">
            <span className="footer-label">地形协议</span>
            <span className="footer-val">zlib + 150×150 INT16</span>
          </div>
          <div className="footer-row">
            <span className="footer-label">输出格式</span>
            <span className="footer-val">64×64 HeightmapTerrainData</span>
          </div>
          <div className="footer-row">
            <span className="footer-label">坐标系</span>
            <span className="footer-val">CGCS2000 / Geographic</span>
          </div>
          <div className="footer-row">
            <span className="footer-label">依赖</span>
            <span className="footer-val">cesium + pako</span>
          </div>
          <div className="footer-links">
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="footer-link"
            >
              📦 GitHub
            </a>
            <a
              href="https://www.tianditu.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className="footer-link"
            >
              🌐 天地图
            </a>
          </div>
        </div>
      </aside>

      {/* ─── 地图区 ─── */}
      <div className="map-wrap">
        <div ref={cesiumRef} className="cesium-container" />
        <div className="map-overlay">
          <span>🗺 深圳 · 114.05°E 22.55°N</span>
          <span className="map-overlay-tip">
            开启天地图地形后，缩放到广东山区查看地形起伏效果
          </span>
        </div>
      </div>
    </div>
  );
}
