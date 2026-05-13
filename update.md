# ha-map-card: In-card Date and Person Filters

## Goal

Add built-in controls to `ha-map-card` so a user can:

- choose a date or date range from within the card UI
- choose which configured person/entities are visible
- use the card without editing Lovelace YAML for routine filter changes

This should preserve YAML as the source of **defaults**, while allowing **runtime overrides** from the card itself.

---

## Scope

### In scope
- Add a small filter UI inside the card
- Add runtime state for:
  - selected date/date range
  - selected visible entities
- Update rendered markers/history/layers when filters change
- Keep existing YAML configuration compatible
- Prefer minimal invasive changes

### Out of scope for first pass
- Full visual card editor
- Automatic discovery of all `person.*` entities in Home Assistant
- Persisting selections across dashboard reloads
- Editing Lovelace config from the UI
- Advanced HA dialog/form integrations unless easy

---

## Recommended MVP

Implement these first:

1. **Person visibility selector**
   - Show checkboxes/toggles for configured entities
   - Prefer showing only configured entities whose id starts with `person.`
   - Allow hiding/showing them at runtime

2. **Single date picker**
   - Add one in-card date input
   - Use selected date as:
     - `start = selected date at 00:00:00`
     - `end = selected date at 23:59:59`
   - Feed that into history/WMS logic that already supports dynamic date changes

3. **Optional YAML defaults**
   - Add config options for enabling the controls and setting initial behavior
   - Keep old dashboards working unchanged

---

## Current Architecture Summary

### Main entry point
- `src/components/MapCard.js`
  - Lit-based custom element
  - Owns card render lifecycle
  - Builds services in `setup()`
  - Already contains in-card buttons like reset focus and clustering toggle

### Config parsing
- `src/configs/MapConfig.js`
  - Parses YAML into normalized config objects
  - Builds `EntityConfig[]`
  - Controls top-level history defaults and date-selection mode

### Entity rendering
- `src/services/render/EntitiesRenderService.js`
  - Instantiates and sets up all configured entities
  - Calls `entity.update()` during render
  - Good place to add visibility filtering APIs

### Entity display model
- `src/models/Entity.js`
  - Owns marker, circle, geojson, history manager
  - Good place to add `show()` / `hide()` / visibility lifecycle methods

### History/date logic
- `src/models/EntityHistoryManager.js`
  - Responds to dynamic date range updates
- `src/models/LayerWithHistory.js`
  - Updates WMS/tile history layers based on date
- `src/services/HaDateRangeService.js`
  - Currently subscribes to HA energy date selector
  - Existing observable pattern can inspire local filter state service

---

## Design Decisions

## 1. YAML remains defaults, not runtime state
Continue to use YAML to define:
- which entities exist on the card
- default history behavior
- whether controls are visible

Use in-card state for:
- currently selected visible people
- currently selected date/date range

## 2. UI only filters configured entities
Do not auto-load arbitrary HA persons in the first version.

Instead:
- only entities already listed in `entities:` are eligible
- the UI may optionally only show `person.*` entities in the selector

This keeps implementation predictable and avoids adding discovery logic.

## 3. Add a local date source instead of overloading the existing energy service
Do not tightly couple the new UI to `HaDateRangeService`.

Instead:
- create a small local observable/controller for in-card date changes
- pass it into history/layer consumers the same way the current date range manager is used

This avoids breaking existing energy-date behavior.

---

## Proposed New Config Options

Add optional config keys in `MapConfig`:

```yaml
show_filter_controls: true
show_person_filter: true
show_date_filter: true
filter_only_person_entities: true
default_visible_entities:
  - person.alice
  - person.bob
```

### Behavior
- `show_filter_controls`
  - master switch for filter UI
- `show_person_filter`
  - show/hide entity selector
- `show_date_filter`
  - show/hide date selector
- `filter_only_person_entities`
  - when true, selector only lists `person.*`
- `default_visible_entities`
  - runtime initial selection; falls back to all eligible entities if omitted

### Compatibility
All keys must be optional with safe defaults so existing configs continue to work unchanged.

---

## Proposed Implementation Steps

## Phase 1: Add filter UI state to `MapCard`

### Files
- `src/components/MapCard.js`
- optionally new helper component:
  - `src/components/MapCardFilters.js`

### Tasks
- Add Lit reactive properties/state for:
  - `filterPanelOpen`
  - `selectedEntityIds`
  - `selectedDate`
- Initialize state from config in `setConfig()` or first `setup()`
- Add one new filter button to open/close a small panel
- Render panel inside the card, layered above the map

### Suggested state shape
```js
this._filterPanelOpen = false;
this._selectedEntityIds = new Set();
this._selectedDate = null;
```

### UI suggestion
Keep first version simple:
- one icon button: filter/settings
- a small absolute-position panel with:
  - date input
  - checkbox list of eligible entities
  - reset button

---

## Phase 2: Add config parsing for filter defaults

### Files
- `src/configs/MapConfig.js`

### Tasks
Add normalized config properties:
- `showFilterControls`
- `showPersonFilter`
- `showDateFilter`
- `filterOnlyPersonEntities`
- `defaultVisibleEntities`

### Suggested defaults
```js
this.showFilterControls = inputConfig.show_filter_controls ?? false;
this.showPersonFilter = inputConfig.show_person_filter ?? true;
this.showDateFilter = inputConfig.show_date_filter ?? true;
this.filterOnlyPersonEntities = inputConfig.filter_only_person_entities ?? true;
this.defaultVisibleEntities = inputConfig.default_visible_entities ?? null;
```

---

## Phase 3: Add runtime entity visibility support

### Files
- `src/services/render/EntitiesRenderService.js`
- `src/models/Entity.js`

### Tasks in `EntitiesRenderService`
Add:
- entity lookup by ID
- eligible filter list
- `setVisibleEntities(entityIds)`
- `getFilterableEntities()`

### Suggested behavior
- Keep all entities instantiated once
- Toggle visibility on existing instances instead of rebuilding card
- On visibility change:
  - show/hide marker
  - show/hide history path
  - show/hide circle
  - show/hide geojson

### Suggested API
```js
setVisibleEntities(entityIds) {
  const visible = new Set(entityIds);
  this.entities.forEach((entity) => {
    if (visible.has(entity.id)) {
      entity.show(this.markerClusterGroup);
    } else {
      entity.hide();
    }
  });
  this.updateInitialView();
}
```

### Tasks in `Entity.js`
Add:
- `visible` flag
- `show(clusterGroup = null)`
- `hide()`

### `hide()` should remove:
- marker
- history layer group
- circle layer
- geojson layer

### `show()` should restore/setup:
- marker if enabled
- history/circle/geojson visibility

### Notes
If full show/hide restoration is awkward, a safe MVP is:
- keep everything set up
- just remove/add visible map layers
- guard `update()` so hidden entities do not keep re-adding themselves

---

## Phase 4: Add a local date range controller

### New file
- `src/services/LocalDateRangeService.js`

### Purpose
Provide a lightweight observable interface similar to current date range subscriptions.

### Suggested API
```js
export default class LocalDateRangeService {
  listeners = [];
  currentRange = null;

  onDateRangeChange(callback) {
    this.listeners.push(callback);
    if (this.currentRange) callback(this.currentRange);
  }

  setDateRange(start, end) {
    this.currentRange = { start, end };
    this.listeners.forEach((cb) => cb(this.currentRange));
  }

  disconnect() {
    this.listeners = [];
  }
}
```

### Why this helps
It lets you plug the new card-local UI into:
- `EntityHistoryManager`
- `LayerWithHistory`

without rewriting their subscription model.

---

## Phase 5: Wire date picker to history/layers

### Files
- `src/components/MapCard.js`
- `src/models/EntityHistoryManager.js`
- `src/models/LayerWithHistory.js`

### Tasks
- Instantiate `LocalDateRangeService` when date UI is enabled
- Pass it where `dateRangeManager` is currently passed
- On date input change:
  - convert selected date into start/end bounds
  - call `setDateRange(start, end)`

### Suggested conversion
For a single selected day:
- start = local date at `00:00:00`
- end = local date at `23:59:59.999`

### Important decision
For MVP, card-local date selection should override:
- entity history using date range manager
- WMS/tile history layers using date range manager

Do **not** override per-entity linked date entities unless you explicitly choose to.

---

## Phase 6: Make visibility and date changes stable in render lifecycle

### Files
- `src/components/MapCard.js`
- `src/services/render/EntitiesRenderService.js`
- `src/models/Entity.js`

### Risks to address
`MapCard.render()` calls service `render()` methods repeatedly.

Ensure:
- filter selections are stored on the card instance
- changing `hass` does not reset selections
- hidden entities stay hidden across updates
- date choice survives rerenders until card teardown

### Tasks
- Initialize filter state only once unless config changes
- In `Entity.update()`, no-op marker/layer repositioning when hidden
- Avoid calling full `setup()` just because filters changed

---

## Phase 7: Add reset actions

### Files
- `src/components/MapCard.js`

### Tasks
Add simple reset controls:
- reset people to configured defaults
- reset date to null/default
- optionally “show all”

This will make testing and UX much easier.

---

## File-by-File Change List

## `src/components/MapCard.js`
### Add
- local UI state
- filter toggle button
- filter panel render function
- handlers:
  - `_toggleFilterPanel()`
  - `_onDateChange()`
  - `_onEntityVisibilityChange()`
  - `_resetFilters()`

### Update
- `setup()` to create/use local date service
- pass initial selected entities to `EntitiesRenderService`

---

## `src/configs/MapConfig.js`
### Add
- new optional config fields for filter UI and defaults

### Ensure
- zero breaking changes
- old cards behave exactly the same

---

## `src/services/render/EntitiesRenderService.js`
### Add
- `getFilterableEntities()`
- `setVisibleEntities(ids)`

### Possibly add
- map from `entityId -> Entity`

### Ensure
- hidden entities do not reappear on next render call

---

## `src/models/Entity.js`
### Add
- `visible` state
- `show()`
- `hide()`

### Ensure `hide()`
removes:
- marker
- history overlays
- circle overlay
- geojson overlay

### Ensure `update()`
does not restore hidden visuals unexpectedly

---

## `src/services/LocalDateRangeService.js`
### New
Small observable service for card-local date/date-range changes

---

## `src/models/EntityHistoryManager.js`
### Verify
It already supports date range manager callbacks

### Maybe add
- explicit refresh helper if needed after local range changes
- guards for hidden entity behavior if necessary

---

## `src/models/LayerWithHistory.js`
### Verify
It already responds to `dateRangeManager.onDateRangeChange(...)`

### Ensure
Local controller can be passed in without assumptions about HA energy selector

---

## Suggested UI Layout

## Option A: Small inline panel
Pros:
- easiest to build
- no custom dialog dependencies

Example structure:
- top-left or top-right filter button
- absolute-position floating panel
- date input
- checkbox list
- reset/apply buttons if needed

## Option B: Expandable drawer
Pros:
- cleaner if many people are listed

For MVP, use **Option A**.

---

## Suggested Eligibility Logic for Person Filter

Create a method in `EntitiesRenderService` or `MapCard`:

```js
getFilterableEntities() {
  const entities = this._config.entities;
  if (this._config.filterOnlyPersonEntities) {
    return entities.filter((e) => e.id.startsWith("person."));
  }
  return entities;
}
```

Display names should use:
- `label` if configured
- fallback to HA friendly name
- fallback to entity id

---

## Testing Checklist

## Manual tests
- Card still loads with no new config keys
- Existing reset focus button still works
- Cluster toggle still works
- Date picker changes history lines
- Date picker changes WMS history layer where configured
- Hiding a person removes marker
- Hiding a person also removes history path/circle/geojson
- Showing person again restores visuals
- Dashboard rerender does not reset filters unexpectedly
- Card teardown/reload works cleanly

## Edge cases
- No `person.*` entities configured
- Only one entity configured
- Entity without history configured
- Entity with GeoJSON and hidden marker
- Clustered and non-clustered markers
- Dark mode styling for filter panel
- Invalid or empty date input

---

## Suggested Implementation Order

1. Add config defaults in `MapConfig`
2. Add local state + basic filter button/panel in `MapCard`
3. Add entity filtering support in `EntitiesRenderService`
4. Add `show()` / `hide()` behavior in `Entity`
5. Add `LocalDateRangeService`
6. Wire date picker into history/layer updates
7. Add reset buttons
8. Polish styling and edge cases

---

## Suggested First Commit Breakdown

### Commit 1
`feat(config): add optional filter control config flags`

### Commit 2
`feat(card): add in-card filter panel shell`

### Commit 3
`feat(entities): support runtime entity visibility toggling`

### Commit 4
`feat(date): add local date range service and wire date picker`

### Commit 5
`style(card): polish filter panel layout and dark mode`

### Commit 6
`test: add regression coverage for config and visibility behavior`

---

## Notes for Future Enhancements

Possible later improvements:
- persist filter state in localStorage
- add multi-date range selection
- use HA-native chips/select components
- allow entity grouping by domain
- allow “all tracked entities” instead of just configured ones
- add card editor support for the new options

---

## Final Recommendation

Build this as a **runtime filter layer on top of existing YAML config**, not as a replacement for config.

That gives:
- low implementation risk
- good backward compatibility
- a much better day-to-day dashboard experience
- a clean path to future enhancements