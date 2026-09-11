import * as Cesium from "cesium";
import { inflate } from "pako";

/**
 * TiandituTerrainProvider
 * 现代 ESM 天地图三维地形 Provider
 *
 * 背景：
 * 天地图官方旧版 SDK（Cesium_ext_min.js，2.5MB）在现代前端工程（Vite/Webpack/ESM）中
 * 会因为向 Cesium.Scene.prototype 写入 configurable:false 属性而直接崩溃：
 *   TypeError: Cannot redefine property: primitiveAdded
 *
 * 本模块对旧 SDK 进行了逆向工程与协议解析，以 100% 纯 ESM 方式重新实现，
 * 彻底解决上述崩溃问题。
 *
 * 协议说明：
 * - 服务端点: https://t{0-7}.tianditu.gov.cn/mapservice/swdx
 * - 服务类型 T=elv_c（经纬度投影高程瓦片）
 * - 坐标系: CGCS2000 (≈ WGS84) → 使用 GeographicTilingScheme
 * - 层级参数: l = level + 1（天地图约定，非 level）
 * - 响应格式: zlib 压缩的 150×150 INT16 高程格网（45000 字节）
 * - 输出格式: 64×64 RGBA HeightmapTerrainData（heightScale=0.001, heightOffset=-1000）
 *
 * 使用示例：
 * ```js
 * import { TiandituTerrainProvider } from "./TiandituTerrainProvider";
 *
 * const provider = new TiandituTerrainProvider({
 *   urls: [
 *     "/tianditu-terrain?T=elv_c&tk=YOUR_KEY",
 *     // 生产环境可传入多个子域名 URL 以负载均衡
 *   ],
 * });
 * viewer.terrainProvider = provider;
 * ```
 *
 * @see https://www.tianditu.gov.cn/
 */
export class TiandituTerrainProvider {
  /** 数据类型：整数（默认） */
  static INT = "int";
  /** 数据类型：浮点 */
  static FLOAT = "float";

  /**
   * @param {object} options
   * @param {string|string[]} options.urls        天地图地形服务 URL（可传多个子域名 URL 以实现负载均衡）
   * @param {string}  [options.dataType="int"]    高程数据类型："int" | "float"
   * @param {number}  [options.topLevel=5]        低于此层级返回平坦地表（天地图不提供过低层级瓦片）
   * @param {number}  [options.bottomLevel=25]    高于此层级停止请求
   * @param {string|Cesium.Credit} [options.credit] 版权信息
   * @param {Cesium.Ellipsoid} [options.ellipsoid] 椭球体（默认 WGS84）
   */
  constructor(options = {}) {
    if (!options.urls || !options.urls.length) {
      throw new Cesium.DeveloperError("options.urls is required.");
    }

    this._urls = Array.isArray(options.urls) ? options.urls : [options.urls];
    this._urls_length = this._urls.length;
    this._url_i = 0;
    this._url_step = 0;

    this._dataType = options.dataType || TiandituTerrainProvider.INT;
    // 0~4 级使用平坦地表缓存；5级起开始请求天地图真实地形瓦片
    this._topLevel = options.topLevel ?? 5;
    this._bottomLevel = options.bottomLevel ?? 25;

    this._errorEvent = new Cesium.Event();
    this._credit =
      typeof options.credit === "string"
        ? new Cesium.Credit(options.credit)
        : options.credit || new Cesium.Credit("天地图三维地形");

    const ellipsoid = options.ellipsoid || Cesium.Ellipsoid.WGS84;
    this._tilingScheme = new Cesium.GeographicTilingScheme({ ellipsoid });

    this._heightmapWidth = 64;
    this._heightmapHeight = 64;
    this._levelZeroMaximumGeometricError =
      Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
        ellipsoid,
        Math.min(this._heightmapWidth, this._heightmapHeight),
        this._tilingScheme.getNumberOfXTilesAtLevel(0)
      );

    // RGBA 编码参数：实际高度 = (RGBA解码值) * heightScale + heightOffset
    this._terrainDataStructure = {
      heightScale: 0.001,
      heightOffset: -1000,
      elementsPerHeight: 3,
      stride: 4,
      elementMultiplier: 256,
      isBigEndian: true,
    };

    this._ready = true;
    this._readyPromise = Promise.resolve(true);
    this._vHeightBuffer = null;
  }

  get errorEvent() {
    return this._errorEvent;
  }

  get credit() {
    return this._credit;
  }

  get tilingScheme() {
    return this._tilingScheme;
  }

  get ready() {
    return this._ready;
  }

  get readyPromise() {
    return this._readyPromise;
  }

  get hasWaterMask() {
    return false;
  }

  get hasVertexNormals() {
    return false;
  }

  get availability() {
    return undefined;
  }

  getLevelMaximumGeometricError(level) {
    return this._levelZeroMaximumGeometricError / (1 << level);
  }

  getTileDataAvailable(x, y, level) {
    return level < this._bottomLevel;
  }

  /**
   * 返回全球基础平坦高度缓存（用于低层级无数据时的占位）
   * 高度值对应海拔约 1000m（与 heightOffset=-1000 配合编码为 0）
   */
  getvHeightBuffer() {
    if (!this._vHeightBuffer) {
      const total = this._heightmapWidth * this._heightmapHeight * 4;
      const buf = new Uint8ClampedArray(total);
      // 编码海拔约 0 米：m = (0 + 1000) / 0.001 = 1000000
      // R = floor(1000000 / 65536) = 15
      // G = floor((1000000 - 15*65536) / 256) = floor(17920/256) = 70 => 0x46
      // B = floor(1000000 - 15*65536 - 70*256) = floor(17920 - 17920) = 0 => 0x40
      // 实际存为 R=15 G=66 B=64 A=255
      for (let i = 0; i < total; i += 4) {
        buf[i] = 15;
        buf[i + 1] = 66;
        buf[i + 2] = 64;
        buf[i + 3] = 255;
      }
      this._vHeightBuffer = buf;
    }
    return this._vHeightBuffer;
  }

  /**
   * 将天地图原始高程格网（150×150 INT16）重采样为 Cesium HeightmapTerrainData 所需的 64×64 RGBA 格式
   * @param {Uint8Array} rawData 解压后的原始字节流
   * @returns {Uint8Array|null} 64×64 RGBA 字节数组，格式出错返回 null
   */
  transformBuffer(rawData) {
    const bytesPerElem =
      this._dataType === TiandituTerrainProvider.FLOAT ? 4 : 2;
    // 150 × 150 格网共 22500 个点
    if (rawData.length !== 22500 * bytesPerElem) {
      return null;
    }

    const w = this._heightmapWidth;
    const h = this._heightmapHeight;
    const out = new Uint8Array(w * h * 4);
    const view = new DataView(
      rawData.buffer,
      rawData.byteOffset,
      rawData.byteLength
    );

    for (let d = 0; d < h; d++) {
      for (let g = 0; g < w; g++) {
        // 双线性邻近采样：将 64×64 坐标映射到 150×150
        const s = Math.round((149 * d) / (h - 1));
        const x_coord = Math.round((149 * g) / (w - 1));
        const gridOffset = 150 * s + x_coord;

        let height = 0;
        if (bytesPerElem === 4) {
          height = view.getFloat32(gridOffset * 4, true);
        } else {
          // INT16 小端：低字节 + 高字节 × 256
          const byteIdx = gridOffset * 2;
          height = rawData[byteIdx] + 256 * rawData[byteIdx + 1];
        }

        // 过滤异常值（海拔超出合理范围视为无数据）
        if (height > 10000 || height < -2000) {
          height = 0;
        }

        // RGBA 编码：m = (height + 1000) / 0.001
        const m = (height + 1000) / 0.001;
        const outIdx = 4 * (d * w + g);

        out[outIdx] = Math.floor(m / 65536);
        out[outIdx + 1] = Math.floor((m - 256 * out[outIdx] * 256) / 256);
        out[outIdx + 2] = Math.floor(
          m - 256 * out[outIdx] * 256 - 256 * out[outIdx + 1]
        );
        out[outIdx + 3] = 255;
      }
    }
    return out;
  }

  /**
   * 请求指定瓦片的地形数据（Cesium 核心接口）
   * @param {number} x     瓦片列号
   * @param {number} y     瓦片行号
   * @param {number} level 层级
   * @returns {Promise<Cesium.HeightmapTerrainData|undefined>}
   */
  async requestTileGeometry(x, y, level) {
    // 低层级（全球视角）：返回平坦基础缓存，避免无效网络请求
    if (level < this._topLevel) {
      return new Cesium.HeightmapTerrainData({
        buffer: this.getvHeightBuffer(),
        width: this._heightmapWidth,
        height: this._heightmapHeight,
        childTileMask: 15,
        structure: this._terrainDataStructure,
      });
    }

    if (level >= this._bottomLevel) {
      return undefined;
    }

    // 多子域名轮询，防限流
    if (this._urls_length > 1) {
      if (this._url_step < 8) {
        this._url_step++;
      } else {
        this._url_step = 0;
        this._url_i = (this._url_i + 1) % this._urls_length;
      }
    }

    const baseUrl = this._urls[this._url_i];
    const sep = baseUrl.includes("?") ? "&" : "?";
    // 天地图服务协议规范：层级参数 l = level + 1
    const tileUrl = `${baseUrl}${sep}x=${x}&y=${y}&l=${level + 1}`;

    try {
      const response = await fetch(tileUrl);
      if (!response.ok) return undefined;

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 100) return undefined;

      // 使用 pako 同步解压 zlib 数据（约 1ms 内完成）
      const rawDecompressed = inflate(new Uint8Array(arrayBuffer));
      const heightBuffer = this.transformBuffer(rawDecompressed);
      if (!heightBuffer) return undefined;

      const terrainData = new Cesium.HeightmapTerrainData({
        buffer: heightBuffer,
        width: this._heightmapWidth,
        height: this._heightmapHeight,
        childTileMask: 15,
        structure: this._terrainDataStructure,
      });
      // 裙边高度 6000m，消除瓦片拼接缝隙
      terrainData._skirtHeight = 6000;
      return terrainData;
    } catch {
      return undefined;
    }
  }
}
