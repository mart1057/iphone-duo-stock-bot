export type StockStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

/// Normalised, source-agnostic view of one (variant x store) observation.
export interface ProductStock {
  model: string;
  color: string; // canonical English, e.g. "Night Sky"
  colorTh: string; // Thai display, e.g. "ไนท์สกาย"
  storage: string; // "256GB"
  partNumber: string; // "MJXQ4ZP/A"
  basePart: string; // "MJXQ4"
  priceTHB: number | null;

  storeName: string; // "Apple Central World"
  storeCode?: string; // "R733"

  status: StockStatus;
  /// Convenience mirror of status === 'AVAILABLE'. UNKNOWN is never `true`.
  available: boolean;
  /// Human readable quote from Apple, e.g. "พร้อมจำหน่าย วันนี้"
  quote?: string;

  checkedAt: Date;
}

/// A false -> true edge. Only these produce a LINE push.
export interface StockTransition {
  stockId: string;
  previousStatus: StockStatus;
  currentStatus: StockStatus;
  stock: ProductStock;
}

export interface StockCheckResult {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  checked: number;
  available: number;
  unavailable: number;
  unknown: number;
  transitions: StockTransition[];
  firstRun: boolean;
  errors: string[];
  /// Apple pushed back on at least one request this cycle.
  rateLimited: boolean;
}
