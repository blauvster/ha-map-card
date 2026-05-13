import Logger from "../util/Logger.js";

/**
 * A lightweight, card-local observable date range service.
 * Provides the same subscription API as HaDateRangeService so it can be
 * passed wherever a dateRangeManager is expected (e.g. LayerWithHistory).
 */
export default class LocalDateRangeService {
  listeners = [];
  /** @type {{start: Date, end: Date}|null} */
  currentRange = null;

  /**
   * Register a callback to be invoked whenever the date range changes.
   * If a range is already set, the callback fires immediately with the current value.
   * @param {function} callback
   */
  onDateRangeChange(callback) {
    this.listeners.push(callback);
    if (this.currentRange) callback(this.currentRange);
  }

  /**
   * Set a new date range and notify all registered listeners.
   * @param {Date} start
   * @param {Date} end
   */
  setDateRange(start, end) {
    this.currentRange = { start, end };
    this.listeners.forEach((cb) => cb(this.currentRange));
    Logger.debug(`[LocalDateRangeService] Date range set: ${start} -> ${end}`);
  }

  disconnect() {
    this.listeners = [];
    Logger.debug("[LocalDateRangeService] Disconnecting");
  }
}
