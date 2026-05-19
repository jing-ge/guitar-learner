/**
 * Round 62: 录音持久化存储 (IndexedDB)
 *
 * 用户场景: 现场录陌生歌, 多次录音对比 (副歌/主歌/桥段), 跨 session 重听
 *
 * 设计:
 *   - IndexedDB 单 database 'guitar-learner-recordings' v1
 *   - 单 store 'recordings', keyPath = id (auto-increment Date.now())
 *   - 每条记录含: { id, createdAt, durationMs, sampleRate, pcm: Blob, analysis: object, mode: 'chord'|'melody' }
 *   - PCM 存为 Float32Array → Blob, 避免 IDB 大对象序列化爆炸
 *   - analysis 存 ChordSummary | MelodyTrack 完整 JSON, 加载时直接复用不重跑 Essentia
 *
 * 容量预估:
 *   - 30s × 44100Hz × 4 byte (Float32) = 5.04 MB/条 PCM
 *   - 20 条上限 ≈ 100 MB; analysis JSON 每条 < 50 KB 可忽略
 *   - Chrome PWA quota 通常 ≥ 1 GB, 100 MB 安全; 不行就 catch QuotaExceededError 降级
 *
 * 砍掉 (Karpathy):
 *   - 录音重命名 / tag / 收藏
 *   - 自动清理 (用户没要求, 手动删 + 满 20 条提示)
 *   - 跨段共享 keyRoot 智能合并
 *   - 导出 WAV (YAGNI)
 */

const DB_NAME = 'guitar-learner-recordings';
const DB_VERSION = 1;
const STORE = 'recordings';

export interface StoredRecording {
  /** 唯一 ID, 使用 Date.now() 创建时间作为主键 */
  id: number;
  /** 创建时间 (ms epoch), 与 id 相同便于排序 */
  createdAt: number;
  /** 录音时长 (ms) */
  durationMs: number;
  /** 采样率 (通常 44100) */
  sampleRate: number;
  /** 音频 PCM 数据 (Float32Array 转 Blob 存储) */
  pcm: Blob;
  /** Essentia 分析结果, 加载时直接渲染不重跑 */
  analysis: any;
  /** 模式: chord (和弦/调性) | melody (主旋律) */
  mode: 'chord' | 'melody';
}

export const MAX_RECORDINGS = 20;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * 保存录音 + 分析结果
 *
 * Round 64 oracle 审计修复:
 *   - 满 MAX_RECORDINGS 时 LRU 截断 (自动删最旧 1 条)
 *   - QuotaExceededError 抛出, 调用方可 toast 提示
 */
export async function saveRecording(
  pcm: Float32Array,
  sampleRate: number,
  analysis: any,
  mode: 'chord' | 'melody',
): Promise<number> {
  // Round 64: LRU 截断 — 已到上限就删最旧一条 (避免 quota 慢慢逼近时静默失败)
  try {
    const existing = await listRecordings();
    if (existing.length >= MAX_RECORDINGS) {
      const oldest = existing[existing.length - 1];  // listRecordings 按降序, 末尾是最旧
      if (oldest) await deleteRecording(oldest.id);
    }
  } catch {
    // list 失败不阻塞保存
  }

  const db = await openDB();
  const id = Date.now();
  const record: StoredRecording = {
    id,
    createdAt: id,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    sampleRate,
    // Float32Array → Blob, IDB 存 Blob 比存 typed array 在浏览器实现上更稳
    // (类型断言: PCM 永远不会从 SharedArrayBuffer 来, 这里 buffer 必是 ArrayBuffer)
    pcm: new Blob([pcm.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
    analysis,
    mode,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve(id);
    req.onerror = () => {
      const err = req.error;
      // QuotaExceededError → 抛给调用方提示用户清理
      if (err && err.name === 'QuotaExceededError') {
        reject(new Error('STORAGE_QUOTA_EXCEEDED'));
      } else {
        reject(err);
      }
    };
  });
}

/** 列表 (按 createdAt 降序, 即最新在前) */
export async function listRecordings(): Promise<StoredRecording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as StoredRecording[];
      all.sort((a, b) => b.createdAt - a.createdAt);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 取单条 */
export async function getRecording(id: number): Promise<StoredRecording | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** 删除单条 */
export async function deleteRecording(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** 把 Blob 还原为 Float32Array (供回放) */
export async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  return new Float32Array(buf);
}

/** 估算存储用量 (返回 MB) */
export async function estimateStorage(): Promise<{ usedMB: number; quotaMB: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return {
      usedMB: (est.usage ?? 0) / 1024 / 1024,
      quotaMB: (est.quota ?? 0) / 1024 / 1024,
    };
  } catch {
    return null;
  }
}
