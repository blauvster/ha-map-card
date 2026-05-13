
import L from 'leaflet';
import { LitElement, html, css } from "lit";
import MapConfig from "../configs/MapConfig.js"
import HaHistoryService from "../services/HaHistoryService.js"
import HaDateRangeService from "../services/HaDateRangeService.js"
import LocalDateRangeService from "../services/LocalDateRangeService.js"
import HaLinkedEntityService from "../services/HaLinkedEntityService.js"
import HaMapUtilities from "../util/HaMapUtilities.js"
import Logger from "../util/Logger.js"
import HaUrlResolveService from '../services/HaUrlResolveService.js';
import TileLayersService from '../services/render/TileLayersRenderService.js';
import EntitiesRenderService from '../services/render/EntitiesRenderService.js';
import InitialViewRenderService from '../services/render/InitialViewRenderService.js';
import TileLayer from '../leaflet/TileLayer.js';
import PluginsRenderService from '../services/render/PluginsRenderService.js';
import GeoJsonRenderService from '../services/render/GeoJsonRenderService.js';

export default class MapCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
      _filterPanelOpen: { state: true },
      _selectedEntityIds: { state: true },
      _selectedDateStart: { state: true },
      _selectedDateEnd: { state: true }
    };
  }

  setupNeeded = true;
  /** @type {L.Map} */
  map;
  /** @type {ResizeObserver} */
  resizeObserver;
  /** @type {HaHistoryService} */
  historyService;
  /** @type {HaLinkedEntityService} */
  linkedEntityService;
  /** @type {HaDateRangeService} */
  dateRangeManager;
  /** @type {HaUrlResolveService} */
  urlResolver;
  /** @type {string} */
  themeMode;
  /** @type {MapConfig} */
  _config;
  /** @type {TileLayersService} */
  tileLayersService;
  /** @type {EntitiesRenderService} */
  entitiesRenderService;
  /** @type {InitialViewRenderService} */
  initialViewRenderService;
  /** @type {PluginsRenderService} */
  pluginsRenderService;
  /** @type {GeoJsonRenderService} */
  geoJsonRenderService;
  hasError = false;
  hadError = false;

  // --- Filter state ---
  /** @type {boolean} */
  _filterPanelOpen = false;
  /** @type {Set<string>|null} null = not yet initialised */
  _selectedEntityIds = null;
  /** @type {string|null} */
  _selectedDateStart = null;
  /** @type {string|null} */
  _selectedDateEnd = null;
  /** @type {LocalDateRangeService} */
  localDateRangeService;

  setup() {
    Logger.debug("[MapCard] Setting up map card");

    // Clean up existing map instance before reinitializing (e.g. when setConfig triggers a re-setup)
    if (this.map) {
      this._teardown();
    }

    this.themeMode = this._config.themeMode;
    this.map = this._setupMap();
    // redraw the map every time it resizes
    this.resizeObserver = this._setupResizeObserver();

    // Setup core history service
    this.historyService = new HaHistoryService(this.hass);
    // Is history date range enabled via HA energy panel?
    if (this._config.historyDateSelection) {
      this.dateRangeManager = new HaDateRangeService(this.hass);
    }
    // Card-local date filter — takes precedence over the energy panel for WMS/tile layers
    if (this._config.showFilterControls && this._config.showDateFilter) {
      this.localDateRangeService = new LocalDateRangeService();
    }
    // Prefer local date service for tile/WMS layers when available
    const tileLayersDateManager = this.localDateRangeService ?? this.dateRangeManager;
    this.tileLayersService = new TileLayersService(this.map, this._config.tileLayers, this._config.wms, this.urlResolver, this.linkedEntityService, tileLayersDateManager);
    this.entitiesRenderService = new EntitiesRenderService(this.map, this.hass, this._config.focusFollow, this._config.entities, this.linkedEntityService, this.dateRangeManager, this.historyService, this._isDarkMode(), this._config.clusterMarkers);
    this.initialViewRenderService = new InitialViewRenderService(this.map, this._config, this.hass, this.entitiesRenderService);

    this.pluginsRenderService = new PluginsRenderService(this.map, this._config.plugins);
    this.geoJsonRenderService = new GeoJsonRenderService(this.map, this.hass, this._config.geojson);

    try {
      this.pluginsRenderService.setup();
      this.tileLayersService.setup();
      this.geoJsonRenderService.setup();
      this.entitiesRenderService.setup();
      this.initialViewRenderService.setup();

      // Initialise filter selections (reset each time setup runs, e.g. after setConfig)
      if (this._config.showFilterControls) {
        const allIds = this.entitiesRenderService.getFilterableEntities().map((e) => e.id);
        const defaults = this._config.defaultVisibleEntities;
        this._selectedEntityIds = new Set(defaults ?? allIds);
        // Apply initial visibility if a subset is configured
        if (defaults) {
          this.entitiesRenderService.setVisibleEntities(this._selectedEntityIds);
        }
      } else {
        this._selectedEntityIds = null;
      }

      this.setupNeeded = false;
      this.render();
      this.hasError = false;
    } catch (e) {
      this.hasError = true;
      this.hadError = true;
      Logger.error(e);
      HaMapUtilities.renderWarningOnMap(this.map, "Error found in first run, check Console");
    }
    Logger.debug("[MapCard] Map card setup complete");
  }

  firstUpdated() {
    this.setup();
  };

  render() {

    if (this.map) {
      if (this.setupNeeded) {
        this.setup();
      }
      this.pluginsRenderService.render();
      this.tileLayersService.render();
      this.geoJsonRenderService.render(this.hass);
      this.entitiesRenderService.render();
      this.initialViewRenderService.render();

      if (!this.hasError && this.hadError) {
        HaMapUtilities.removeWarningOnMap(this.map, "Error found, check Console");
        HaMapUtilities.removeWarningOnMap(this.map, "Error found in first run, check Console");
        this.hadError = false;
      }

    }

    return html`
            <link rel="stylesheet" href="/static/images/leaflet/leaflet.css">
            <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
            <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css">
            <ha-card header="${this._config.title}">
              <div id="mapContainer" style="min-height: ${this._config.mapHeight}px">
                <div id="map" style="min-height: ${this._config.mapHeight}px">
                  <ha-icon-button
                    label='Reset focus'
                    style='${this._isDarkMode() ? "color:#ffffff;" : "color:#000000;"} position: absolute; top: 75px; left: 3px; z-index: 1;'
                    @click=${this._fitMap}
                    tabindex="0"
                  >
                    <ha-icon icon="mdi:image-filter-center-focus"></ha-icon>
                  </ha-icon-button>
                  ${this._config.clusterMarkers ? html`
                    <ha-icon-button
                      label='Toggle grouping'
                      style='${this._isDarkMode() ? "color:#ffffff;" : "color:#000000;"} position: absolute; top: 115px; left: 3px; z-index: 1;'
                      @click=${this._toggleClustering}
                      tabindex="0"
                    >
                      <ha-icon icon="mdi:group"></ha-icon>
                    </ha-icon-button>
                  ` : ''}
                  ${this._config.showFilterControls ? html`
                    <ha-icon-button
                      label='Filter'
                      style='${this._isDarkMode() ? "color:#ffffff;" : "color:#000000;"} position: absolute; top: ${this._config.clusterMarkers ? 155 : 115}px; left: 3px; z-index: 1;'
                      @click=${this._toggleFilterPanel}
                      tabindex="0"
                    >
                      <ha-icon icon="mdi:filter-variant"></ha-icon>
                    </ha-icon-button>
                    ${this._filterPanelOpen ? this._renderFilterPanel() : ''}
                  ` : ''}
                </div>
              </div>
            </ha-card>
        `;
  }

  _fitMap() {
    this.initialViewRenderService.setup();
  }

  _toggleClustering() {
    this.entitiesRenderService.toggleClustering();
  }

  _toggleFilterPanel() {
    this._filterPanelOpen = !this._filterPanelOpen;
  }

  _renderFilterPanel() {
    const isDark = this._isDarkMode();
    const bg = isDark ? "rgba(30,30,30,0.95)" : "rgba(255,255,255,0.95)";
    const color = isDark ? "#ffffff" : "#000000";
    const borderColor = isDark ? "#444" : "#ccc";

    const filterableEntities = this.entitiesRenderService
      ? this.entitiesRenderService.getFilterableEntities().filter((e) =>
          this._config.filterOnlyPersonEntities ? e.id.startsWith("person.") : true
        )
      : [];

    return html`
      <div
        id="filter-panel"
        style="
          position: absolute;
          top: ${this._config.clusterMarkers ? 195 : 155}px;
          left: 3px;
          z-index: 2;
          background: ${bg};
          color: ${color};
          border: 1px solid ${borderColor};
          border-radius: 8px;
          padding: 10px 14px;
          min-width: 200px;
          max-width: 280px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          font-size: 13px;
        "
      >
        ${this._config.showDateFilter ? html`
          <div style="margin-bottom: 8px;">
            <div style="font-weight: bold; margin-bottom: 6px;">Date Range</div>
            <div style="margin-bottom: 4px;">
              <div style="font-size: 11px; margin-bottom: 2px; opacity: 0.7;">Start</div>
              <input
                type="date"
                .value="${this._selectedDateStart ?? ""}"
                style="width: 100%; box-sizing: border-box; background: ${isDark ? "#222" : "#fff"}; color: ${color}; border: 1px solid ${borderColor}; border-radius: 4px; padding: 4px 6px;"
                @change="${this._onDateStartChange}"
              />
            </div>
            <div>
              <div style="font-size: 11px; margin-bottom: 2px; opacity: 0.7;">End</div>
              <input
                type="date"
                .value="${this._selectedDateEnd ?? ""}"
                style="width: 100%; box-sizing: border-box; background: ${isDark ? "#222" : "#fff"}; color: ${color}; border: 1px solid ${borderColor}; border-radius: 4px; padding: 4px 6px;"
                @change="${this._onDateEndChange}"
              />
            </div>
          </div>
        ` : ""}
        ${this._config.showPersonFilter && filterableEntities.length > 0 ? html`
          <div style="margin-bottom: 8px;">
            <div style="font-weight: bold; margin-bottom: 4px;">Entities</div>
            ${filterableEntities.map((entityConfig) => {
              const friendlyName =
                this.hass?.states?.[entityConfig.id]?.attributes?.friendly_name ?? entityConfig.id;
              const isChecked = this._selectedEntityIds?.has(entityConfig.id) ?? true;
              return html`
                <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; cursor: pointer;">
                  <input
                    type="checkbox"
                    .checked="${isChecked}"
                    @change="${(ev) => this._onEntityVisibilityChange(ev, entityConfig.id)}"
                  />
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${friendlyName}">
                    ${friendlyName}
                  </span>
                </label>
              `;
            })}
          </div>
        ` : ""}
        <button
          style="
            width: 100%;
            padding: 4px 8px;
            background: ${isDark ? "#444" : "#e0e0e0"};
            color: ${color};
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          "
          @click="${this._resetFilters}"
        >Reset</button>
      </div>
    `;
  }

  _onDateStartChange(event) {
    this._selectedDateStart = event.target.value || null;
    this._applyDateRange();
  }

  _onDateEndChange(event) {
    this._selectedDateEnd = event.target.value || null;
    this._applyDateRange();
  }

  _applyDateRange() {
    const startStr = this._selectedDateStart;
    const endStr = this._selectedDateEnd;

    // Need at least a start date
    if (!startStr) return;

    const start = new Date(startStr + "T00:00:00");
    const end = endStr
      ? new Date(endStr + "T23:59:59.999")
      : new Date(startStr + "T23:59:59.999");

    // Drive WMS/tile history layers via the local service
    if (this.localDateRangeService) {
      this.localDateRangeService.setDateRange(start, end);
    }

    // Update entity histories directly
    this.entitiesRenderService?.entities.forEach((entity) => {
      if (entity.historyManager?.hasHistory) {
        entity.historyManager.setHistoryDates(start, end);
        entity.historyManager.refreshHistory();
      }
    });
  }

  _onEntityVisibilityChange(event, entityId) {
    if (!this._selectedEntityIds) return;
    const next = new Set(this._selectedEntityIds);
    if (event.target.checked) {
      next.add(entityId);
    } else {
      next.delete(entityId);
    }
    this._selectedEntityIds = next;
    this.entitiesRenderService?.setVisibleEntities(this._selectedEntityIds);
  }

  _resetFilters() {
    this._selectedDateStart = null;
    this._selectedDateEnd = null;

    // Restore all entities to visible
    const allIds = new Set(
      this.entitiesRenderService?.getFilterableEntities().map((e) => e.id) ?? []
    );
    this._selectedEntityIds = allIds;
    this.entitiesRenderService?.setVisibleEntities(this._selectedEntityIds);

    // Reset entity histories to their original config dates
    this.entitiesRenderService?.entities.forEach((entity) => {
      if (entity.historyManager?.hasHistory && !entity.config.usingDateRangeManager) {
        entity.historyManager.setHistoryDates(
          entity.config.historyStart,
          entity.config.historyEnd
        );
        entity.historyManager.refreshHistory();
      }
    });

    // Clear the local date service range
    if (this.localDateRangeService) {
      this.localDateRangeService.currentRange = null;
    }
  }


  _setupResizeObserver() {
    if (this.resizeObserver) {
      return this.resizeObserver;
    }

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.target === this.map?.getContainer()) {
          this.map?.invalidateSize();
          this.initialViewRenderService?.setup();
        }
      }
    });

    resizeObserver.observe(this.map.getContainer());
    return resizeObserver;
  }

  /** @returns {L.Map} Leaflet Map */
  _setupMap() {
    // Manages watching external entities.
    this.linkedEntityService = new HaLinkedEntityService(this.hass);
    this.urlResolver = new HaUrlResolveService(this.hass, this.linkedEntityService);

    L.Icon.Default.imagePath = "/static/images/leaflet/images/";

    const mapEl = this.shadowRoot.querySelector('#map');
    let map = L.map(mapEl, this._config.mapOptions);

    // Add dark class if darkmode
    this._isDarkMode() ? mapEl.classList.add('dark') : mapEl.classList.add('light');

    let tileUrl = this.urlResolver.resolveUrl(this._config.tileLayer.url);
    let layer = new TileLayer(tileUrl, this._config.tileLayer.options);
    map.addLayer(layer);
    this.urlResolver.registerLayer(layer, this._config.tileLayer.url);
    return map;
  }



  setConfig(config) {
    this.config = config;
    this._config = new MapConfig(config);
    this.setupNeeded = true;
    // Reset all filter state when config changes
    this._filterPanelOpen = false;
    this._selectedEntityIds = null;
    this._selectedDateStart = null;
    this._selectedDateEnd = null;
  }

  // The height of your card. Home Assistant uses this to automatically
  // distribute all cards over the available columns.
  getCardSize() {
    return this._config.cardSize;
  }

  connectedCallback() {
    super.connectedCallback();
    Logger.debug("[MapCard.connectedCallback] called");
    // Reinitialize the map when the card gets reloaded but it's still in view
    if (this.shadowRoot.querySelector('#map')) {
      this.setup();
    }
  }

  _teardown() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.historyService?.unsubscribe();
    this.dateRangeManager?.disconnect();
    this.localDateRangeService?.disconnect();
    this.localDateRangeService = undefined;
    this.linkedEntityService?.disconnect();
    this.pluginsRenderService?.cleanup();
    this.geoJsonRenderService?.cleanup();
    this.map.remove();
    this.map = undefined;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    Logger.debug("[MapCard.disconnectedCallback] called");
    if (this.map) {
      this._teardown();
      this.setupNeeded = true;
    }
  }

  _isDarkMode() {
    return (
      this.themeMode === "dark" ||
      (this.themeMode === "auto" && Boolean(this.hass.themes.darkMode))
    );
  }

  static getStubConfig(hass) {
    // Find a power entity for default
    const sampleEntities = Object.keys(hass.states).filter(
      (entityId) => {
        const entity = hass.states[entityId];
        return (entity.state && entity.attributes && entity.attributes.latitude && entity.attributes.longitude);
      }
    );

    // Sample config
    return {
      type: 'custom:map-card',
      history_start: '24 hours ago',
      entities: sampleEntities
    };
  }

  static get styles() {
    return css`
      ha-card {
        height: 100%;
        display: flex;
        width: 100%;
        flex-direction: column;
        overflow: hidden;
      }
      #mapContainer {
        border-radius: var(--ha-card-border-radius, 12px);
        overflow: hidden;
        z-index: 0;
        height: 100%;
        width: 100%;
      }
      #map {
        height: 100%;
      }
      .leaflet-pane {
        z-index: 0 !important;
      }
      .leaflet-edit-resize {
        border-radius: 50%;
        cursor: nesw-resize !important;
      }
      .leaflet-control,
      .leaflet-top,
      .leaflet-bottom {
        z-index: 1 !important;
      }
      .leaflet-tooltip {
        padding: 8px;
        font-size: 90%;
        background: rgba(80, 80, 80, 0.9) !important;
        color: white !important;
        border-radius: 4px;
        box-shadow: none !important;
      }
      .distance-tooltip {
        padding: 4px 8px;
        font-size: 12px;
        font-weight: bold;
        background: rgba(0, 0, 0, 0.8) !important;
        color: white !important;
        border-radius: 12px;
        border: none !important;
        white-space: nowrap;
      }
      .distance-tooltip::before {
        display: none;
      }
      #map.dark {
         background: #090909;
        color: #ffffff;
        --map-filter: invert(0.9) hue-rotate(170deg) brightness(1.5)
          contrast(1.2) saturate(0.3);
      }
      #map.dark .leaflet-control-attribution {
        background: #000000cc;
        color: #ffffff;
      }
      #map.dark .leaflet-control-attribution a {
        color: #ffffff;
      }
      #map.light {
        background: #ffffff;
        color: #000000;
        --map-filter: invert(0);
      }
      .dark .leaflet-bar a {
        background-color: #1c1c1c;
        color: #ffffff;
      }
      .dark .leaflet-bar a:hover {
        background-color: #313131;
      }
      .leaflet-tile-pane {
        filter: var(--map-filter);
      }
      #filter-panel input[type="checkbox"] {
        cursor: pointer;
      }
    `;
  }
}
