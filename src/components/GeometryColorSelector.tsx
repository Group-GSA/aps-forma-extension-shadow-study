import { Forma } from "forma-embedded-view-sdk/auto";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FormaElement, Urn } from "forma-embedded-view-sdk/elements/types";
import { useTranslation } from "../i18n/useTranslation";
import { DEFAULT_SHADOW_OPACITY, shadowOverlay } from "../shadowOverlay";

const DEFAULT_CONTEXT_BUILDINGS_COLOR = "#cccccc";
const DEFAULT_DESIGN_BUILDINGS_COLOR = "#ffffff";
const DEFAULT_CONTEXT_SHADOWS_COLOR = "#4d4d4d";
const DEFAULT_DESIGN_SHADOWS_COLOR = "#31437c";
const DEFAULT_TERRAIN_COLOR = "#ffffff";

/** Delay before re-reading the proposal after a change, so a burst of edits is handled once. */
const PROPOSAL_REFRESH_DEBOUNCE_MS = 300;

type ElementGroups = {
  context: string[];
  design: string[];
  terrain: string[];
};

type ProposalState = {
  rootUrn: Urn;
  groups: ElementGroups;
};

/**
 * Color configuration persisted between sessions.
 */
type ColorConfig = {
  shouldPaintContext: boolean;
  shouldPaintDesign: boolean;
  shouldPaintContextShadows: boolean;
  shouldPaintDesignShadows: boolean;
  shouldPaintTerrain: boolean;
  contextColor: string;
  designColor: string;
  contextShadowsColor: string;
  designShadowsColor: string;
  terrainColor: string;
  shadowOpacity: number;
};

const DEFAULT_COLOR_CONFIG: ColorConfig = {
  shouldPaintContext: false,
  shouldPaintDesign: false,
  shouldPaintContextShadows: false,
  shouldPaintDesignShadows: false,
  shouldPaintTerrain: false,
  contextColor: DEFAULT_CONTEXT_BUILDINGS_COLOR,
  designColor: DEFAULT_DESIGN_BUILDINGS_COLOR,
  contextShadowsColor: DEFAULT_CONTEXT_SHADOWS_COLOR,
  designShadowsColor: DEFAULT_DESIGN_SHADOWS_COLOR,
  terrainColor: DEFAULT_TERRAIN_COLOR,
  shadowOpacity: DEFAULT_SHADOW_OPACITY,
};

/** Bump the version whenever the shape of {@link ColorConfig} changes. */
const COLOR_CONFIG_STORAGE_KEY = "shadow-study.colorConfig.v1";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Read the persisted color configuration, falling back to the defaults for
 * anything missing or malformed. Storage access is wrapped since embedded
 * views run in a third-party iframe where some browsers block it.
 */
function loadColorConfig(): ColorConfig {
  try {
    const raw = window.localStorage.getItem(COLOR_CONFIG_STORAGE_KEY);
    if (raw == null) {
      return DEFAULT_COLOR_CONFIG;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") {
      return DEFAULT_COLOR_CONFIG;
    }
    const stored = parsed as Record<string, unknown>;
    const bool = (key: keyof ColorConfig): boolean =>
      typeof stored[key] === "boolean"
        ? (stored[key] as boolean)
        : (DEFAULT_COLOR_CONFIG[key] as boolean);
    const color = (key: keyof ColorConfig): string =>
      typeof stored[key] === "string" && HEX_COLOR.test(stored[key] as string)
        ? (stored[key] as string)
        : (DEFAULT_COLOR_CONFIG[key] as string);
    const opacity =
      typeof stored.shadowOpacity === "number" &&
      stored.shadowOpacity >= 0.05 &&
      stored.shadowOpacity <= 1
        ? stored.shadowOpacity
        : DEFAULT_COLOR_CONFIG.shadowOpacity;
    return {
      shouldPaintContext: bool("shouldPaintContext"),
      shouldPaintDesign: bool("shouldPaintDesign"),
      shouldPaintContextShadows: bool("shouldPaintContextShadows"),
      shouldPaintDesignShadows: bool("shouldPaintDesignShadows"),
      shouldPaintTerrain: bool("shouldPaintTerrain"),
      contextColor: color("contextColor"),
      designColor: color("designColor"),
      contextShadowsColor: color("contextShadowsColor"),
      designShadowsColor: color("designShadowsColor"),
      terrainColor: color("terrainColor"),
      shadowOpacity: opacity,
    };
  } catch (error) {
    console.warn("[shadow-study] could not read stored color configuration", error);
    return DEFAULT_COLOR_CONFIG;
  }
}

function saveColorConfig(config: ColorConfig): void {
  try {
    window.localStorage.setItem(COLOR_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn("[shadow-study] could not store color configuration", error);
  }
}

/**
 * Element URNs follow the scheme `urn:adsk-forma-elements:{system}:{authcontext}:{id}:{revision}`.
 */
function getElementSystem(urn: Urn): string {
  return urn.split(":")[2];
}

function isTerrainElement(urn: Urn, element: FormaElement): boolean {
  return element.properties?.category === "terrain" || getElementSystem(urn) === "terrain";
}

function isBaseElement(urn: Urn): boolean {
  return getElementSystem(urn) === "base";
}

/**
 * The revision-independent identity of an element (`{system}:{authcontext}:{id}`),
 * so the same element can be recognized when it is referenced from more than
 * one place in the hierarchy, e.g. from both the base and the proposal after
 * a "Move to base".
 */
function getElementId(urn: Urn): string {
  return urn.split(":").slice(2, 5).join(":");
}

/**
 * Group the paths of all elements in the hierarchy into context elements
 * (everything in a base layer, i.e. the surroundings shared between
 * proposals) and design elements (everything else in the proposal, whether
 * drawn natively in Forma or uploaded). Terrain elements are grouped
 * separately: they cast no shadows and are colored through the ground
 * texture, but their mesh is what shadows are projected onto.
 *
 * If the proposal has no base layer, falls back to treating elements
 * imported through the integrate element system as design and everything
 * else as context.
 *
 * An element moved to the base ("Move to base") can still be referenced from
 * the proposal side of the hierarchy; since the base is what defines context,
 * every reference to such an element is treated as context so it stops
 * counting as design.
 */
function groupElementPaths(rootUrn: Urn, elements: Record<Urn, FormaElement>): ElementGroups {
  const groups: ElementGroups = { context: [], design: [], terrain: [] };
  const hasBase = Object.keys(elements).some((urn) => isBaseElement(urn as Urn));
  const contextIds = new Set<string>();
  const designEntries: { path: string; id: string }[] = [];

  const walk = (urn: Urn, path: string, inBase: boolean, inContext: boolean, inDesign: boolean) => {
    const element = elements[urn];
    if (element == null) {
      return;
    }
    if (isTerrainElement(urn, element)) {
      if (path !== "root") {
        groups.terrain.push(path);
      }
      return;
    }

    const isInBase = inBase || isBaseElement(urn);
    // Elements inside a context container are context regardless of their
    // own system: an integrate-system element moved into the base must stop
    // counting as design.
    const isDesign = hasBase
      ? !isInBase
      : !inContext && (inDesign || getElementSystem(urn) === "integrate");
    if (path !== "root") {
      if (isDesign) {
        designEntries.push({ path, id: getElementId(urn) });
      } else {
        groups.context.push(path);
        contextIds.add(getElementId(urn));
      }
    }

    for (const child of element.children ?? []) {
      walk(
        child.urn,
        `${path}/${child.key}`,
        isInBase,
        inContext || (path !== "root" && !isDesign),
        isDesign,
      );
    }
  };

  walk(rootUrn, "root", false, false, false);

  for (const entry of designEntries) {
    if (contextIds.has(entry.id)) {
      console.debug(`[shadow-study] ${entry.path} is also part of the base -- treating as context`);
      groups.context.push(entry.path);
    } else {
      groups.design.push(entry.path);
    }
  }
  return groups;
}

/**
 * Reduce a group of paths to only the topmost ones, since hiding an element
 * also hides all of its children.
 */
function topLevelPaths(paths: string[]): string[] {
  const set = new Set(paths);
  return paths.filter((path) => !set.has(path.slice(0, path.lastIndexOf("/"))));
}

/**
 * Will debounce the function call to avoid calling it too often.
 * Useful for avoiding color input events to be called too often.
 */
export const debounce = <F extends (...args: any[]) => ReturnType<F>>(func: F, waitFor: number) => {
  let timeout: number | undefined;

  return (...args: Parameters<F>): Promise<ReturnType<F>> =>
    new Promise((resolve) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(() => resolve(func(...args)), waitFor);
    });
};

type ColorRowProps = {
  label: string;
  checked: boolean;
  setChecked: (checked: boolean) => void;
  color: string;
  setColor: (color: string) => void;
};

function ColorRow({ label, checked, setChecked, color, setColor }: ColorRowProps) {
  return (
    <div class="row">
      <div class="row-title" style={{ width: "60%" }}>
        <weave-checkbox
          checked={checked}
          label={label}
          showlabel
          onChange={(e) => setChecked(e.detail.checked)}
        ></weave-checkbox>
      </div>
      <div class="row-item">
        <input
          type="color"
          class={"color-picker"}
          value={color}
          onInput={(e) => {
            if (e.target instanceof HTMLInputElement) setColor(e.target.value);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Keep the element groups in sync with the proposal currently open in Forma.
 *
 * Every proposal change (edits as well as switching proposal) schedules a
 * re-read of the hierarchy once the proposal has been persisted, which the
 * elements API requires. Overlapping reads are resolved in favour of the
 * most recent one so a slow response for an old revision can never
 * overwrite a newer one.
 */
function useProposalElementGroups(): ProposalState | undefined {
  const [state, setState] = useState<ProposalState | undefined>();

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let lastRootUrn: Urn | undefined;
    let timer: number | undefined;
    let subscription: { unsubscribe: () => void } | undefined;

    const refresh = async () => {
      const current = ++generation;
      try {
        await Forma.proposal.awaitProposalPersisted();
        const rootUrn = (await Forma.proposal.getRootUrn()) as Urn;
        if (disposed || current !== generation) {
          return;
        }
        if (rootUrn === lastRootUrn) {
          // Same revision, so the hierarchy and geometry are unchanged.
          return;
        }
        const { elements } = await Forma.elements.get({ urn: rootUrn, recursive: true });
        if (disposed || current !== generation) {
          return;
        }
        lastRootUrn = rootUrn;
        setState({ rootUrn, groups: groupElementPaths(rootUrn, elements) });
      } catch (error) {
        console.warn("[shadow-study] could not read the proposal hierarchy", error);
      }
    };

    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), PROPOSAL_REFRESH_DEBOUNCE_MS);
    };

    void refresh();
    Forma.proposal
      .subscribe(scheduleRefresh)
      .then((result) => {
        if (disposed) {
          result.unsubscribe();
        } else {
          subscription = result;
        }
      })
      .catch((error) => {
        console.warn("[shadow-study] could not subscribe to proposal changes", error);
      });

    return () => {
      disposed = true;
      clearTimeout(timer);
      subscription?.unsubscribe();
    };
  }, []);

  return state;
}

export default function GeometryColorSelector() {
  const { t } = useTranslation();

  const [showContext, setShowContext] = useState(true);
  const [showDesign, setShowDesign] = useState(true);

  const [initialConfig] = useState(loadColorConfig);
  const [shouldPaintContext, setShouldPaintContext] = useState(initialConfig.shouldPaintContext);
  const [shouldPaintDesign, setShouldPaintDesign] = useState(initialConfig.shouldPaintDesign);
  const [shouldPaintContextShadows, setShouldPaintContextShadows] = useState(
    initialConfig.shouldPaintContextShadows,
  );
  const [shouldPaintDesignShadows, setShouldPaintDesignShadows] = useState(
    initialConfig.shouldPaintDesignShadows,
  );
  const [shouldPaintTerrain, setShouldPaintTerrain] = useState(initialConfig.shouldPaintTerrain);

  const [contextColor, setContextColor] = useState(initialConfig.contextColor);
  const [designColor, setDesignColor] = useState(initialConfig.designColor);
  const [contextShadowsColor, setContextShadowsColor] = useState(initialConfig.contextShadowsColor);
  const [designShadowsColor, setDesignShadowsColor] = useState(initialConfig.designShadowsColor);
  const [terrainColor, setTerrainColor] = useState(initialConfig.terrainColor);
  const [shadowOpacity, setShadowOpacity] = useState(initialConfig.shadowOpacity);

  const proposal = useProposalElementGroups();
  const elementGroups = proposal?.groups;

  const setContextColorDebounced = useMemo(() => debounce(setContextColor, 50), []);
  const setDesignColorDebounced = useMemo(() => debounce(setDesignColor, 50), []);
  const setContextShadowsColorDebounced = useMemo(() => debounce(setContextShadowsColor, 50), []);
  const setDesignShadowsColorDebounced = useMemo(() => debounce(setDesignShadowsColor, 50), []);
  const setTerrainColorDebounced = useMemo(() => debounce(setTerrainColor, 50), []);
  const setShadowOpacityDebounced = useMemo(() => debounce(setShadowOpacity, 50), []);

  useEffect(() => {
    saveColorConfig({
      shouldPaintContext,
      shouldPaintDesign,
      shouldPaintContextShadows,
      shouldPaintDesignShadows,
      shouldPaintTerrain,
      contextColor,
      designColor,
      contextShadowsColor,
      designShadowsColor,
      terrainColor,
      shadowOpacity,
    });
  }, [
    shouldPaintContext,
    shouldPaintDesign,
    shouldPaintContextShadows,
    shouldPaintDesignShadows,
    shouldPaintTerrain,
    contextColor,
    designColor,
    contextShadowsColor,
    designShadowsColor,
    terrainColor,
    shadowOpacity,
  ]);

  // Paths currently painted, so paths that drop out (unchecked group, or a
  // proposal change that removed or re-keyed elements) can be cleared.
  const paintedPaths = useRef(new Set<string>());
  useEffect(() => {
    if (elementGroups == null) {
      return;
    }
    const pathsToColor = new Map<string, string>();
    if (shouldPaintContext) {
      for (const path of elementGroups.context) {
        pathsToColor.set(path, contextColor);
      }
    }
    if (shouldPaintDesign) {
      for (const path of elementGroups.design) {
        pathsToColor.set(path, designColor);
      }
    }

    const pathsToClear = [...paintedPaths.current].filter((path) => !pathsToColor.has(path));
    paintedPaths.current = new Set(pathsToColor.keys());

    if (pathsToColor.size === 0) {
      Forma.render.elementColors.clearAll();
      return;
    }
    if (pathsToClear.length > 0) {
      Forma.render.elementColors.clear({ paths: pathsToClear });
    }
    Forma.render.elementColors.set({ pathsToColor });
  }, [shouldPaintContext, shouldPaintDesign, contextColor, designColor, elementGroups]);

  // Paths currently hidden, so they can be shown again if they leave the group.
  const hiddenPaths = useRef(new Set<string>());
  useEffect(() => {
    if (elementGroups == null) {
      return;
    }
    const pathsToHide = new Set<string>([
      ...(showContext ? [] : topLevelPaths(elementGroups.context)),
      ...(showDesign ? [] : topLevelPaths(elementGroups.design)),
    ]);
    for (const path of hiddenPaths.current) {
      if (!pathsToHide.has(path)) {
        Forma.render.unhideElement({ path });
      }
    }
    for (const path of pathsToHide) {
      if (!hiddenPaths.current.has(path)) {
        Forma.render.hideElement({ path });
      }
    }
    hiddenPaths.current = pathsToHide;
  }, [showContext, showDesign, elementGroups]);

  useEffect(() => {
    if (proposal == null) {
      return;
    }
    // Keyed on the proposal revision rather than the groups: moving or
    // reshaping a building keeps the same paths but changes the mesh.
    void shadowOverlay.loadGeometry(
      {
        context: topLevelPaths(proposal.groups.context),
        design: topLevelPaths(proposal.groups.design),
      },
      proposal.groups.terrain,
    );
  }, [proposal]);

  useEffect(() => {
    shadowOverlay.setSettings({
      // Hidden buildings should not cast shadows in the overlay either.
      contextShadows: {
        enabled: shouldPaintContextShadows && showContext,
        color: contextShadowsColor,
      },
      designShadows: {
        enabled: shouldPaintDesignShadows && showDesign,
        color: designShadowsColor,
      },
      terrain: { enabled: shouldPaintTerrain, color: terrainColor },
      shadowOpacity,
    });
  }, [
    shouldPaintContextShadows,
    shouldPaintDesignShadows,
    shouldPaintTerrain,
    contextShadowsColor,
    designShadowsColor,
    terrainColor,
    shadowOpacity,
    showContext,
    showDesign,
  ]);

  const onResetColors = () => {
    setShouldPaintContext(DEFAULT_COLOR_CONFIG.shouldPaintContext);
    setShouldPaintDesign(DEFAULT_COLOR_CONFIG.shouldPaintDesign);
    setShouldPaintContextShadows(DEFAULT_COLOR_CONFIG.shouldPaintContextShadows);
    setShouldPaintDesignShadows(DEFAULT_COLOR_CONFIG.shouldPaintDesignShadows);
    setShouldPaintTerrain(DEFAULT_COLOR_CONFIG.shouldPaintTerrain);
    setContextColor(DEFAULT_COLOR_CONFIG.contextColor);
    setDesignColor(DEFAULT_COLOR_CONFIG.designColor);
    setContextShadowsColor(DEFAULT_COLOR_CONFIG.contextShadowsColor);
    setDesignShadowsColor(DEFAULT_COLOR_CONFIG.designShadowsColor);
    setTerrainColor(DEFAULT_COLOR_CONFIG.terrainColor);
    setShadowOpacity(DEFAULT_COLOR_CONFIG.shadowOpacity);
  };

  return (
    <>
      <div class="section-title">{t("colorConfig.title")}</div>
      <ColorRow
        label={t("colorConfig.contextBuildings")}
        checked={shouldPaintContext}
        setChecked={setShouldPaintContext}
        color={contextColor}
        setColor={setContextColorDebounced}
      />
      <ColorRow
        label={t("colorConfig.designBuildings")}
        checked={shouldPaintDesign}
        setChecked={setShouldPaintDesign}
        color={designColor}
        setColor={setDesignColorDebounced}
      />
      <ColorRow
        label={t("colorConfig.contextShadows")}
        checked={shouldPaintContextShadows}
        setChecked={setShouldPaintContextShadows}
        color={contextShadowsColor}
        setColor={setContextShadowsColorDebounced}
      />
      <ColorRow
        label={t("colorConfig.designShadows")}
        checked={shouldPaintDesignShadows}
        setChecked={setShouldPaintDesignShadows}
        color={designShadowsColor}
        setColor={setDesignShadowsColorDebounced}
      />
      <div class="row">
        <div class="row-title" style={{ width: "60%" }}>
          {t("colorConfig.shadowOpacity")}
        </div>
        <div class="row-item">
          <input
            type="range"
            class="opacity-slider"
            min="5"
            max="100"
            step="5"
            value={Math.round(shadowOpacity * 100)}
            onInput={(e) => {
              if (e.target instanceof HTMLInputElement) {
                setShadowOpacityDebounced(Number(e.target.value) / 100);
              }
            }}
          />
          <span class="opacity-value">{Math.round(shadowOpacity * 100)}%</span>
        </div>
      </div>
      <ColorRow
        label={t("colorConfig.terrain")}
        checked={shouldPaintTerrain}
        setChecked={setShouldPaintTerrain}
        color={terrainColor}
        setColor={setTerrainColorDebounced}
      />
      <div class="row">
        <weave-button variant="flat" onClick={onResetColors}>
          {t("colorConfig.resetColors")}
        </weave-button>
      </div>
      <div class="section-title">{t("visibility.title")}</div>
      <div class="row">
        <div class="row-title">
          <weave-checkbox
            checked={showContext}
            label={t("colorConfig.contextBuildings")}
            showlabel
            onChange={(e) => setShowContext(e.detail.checked)}
          ></weave-checkbox>
        </div>
      </div>
      <div class="row">
        <div class="row-title">
          <weave-checkbox
            checked={showDesign}
            label={t("colorConfig.designBuildings")}
            showlabel
            onChange={(e) => setShowDesign(e.detail.checked)}
          ></weave-checkbox>
        </div>
      </div>
    </>
  );
}
