# Shadow study: visual enhancement for Forma

This extension is a **visual enhancement to the existing
[Forma Shadow Study](https://github.com/autodesk-platform-services/aps-forma-extension-shadow-study)**
example extension. On top of the original shadow study workflow, it lets you
manipulate how the shadows in your design look, and what color they have, so
you can better customize the presentation of your design.

![Shadow study with custom colors for design buildings and design shadows](/assets/Screenshot-color-configuration.png)

- [What it adds](#what-it-adds)
- [How it works](#how-it-works)
- [Local development](#local-development)
- [Original extension](#original-extension)

## What it adds

The original shadow study lets you pick a date, a time range and an interval,
then previews or exports screenshots of the proposal at each sun position. This
version keeps that workflow and adds a **Color configurations** panel and
**Visibility** toggles:

- **Context buildings** and **Design buildings** can be given their own
  colors, so your proposal stands out from its surroundings.
- **Context shadows** and **Design shadows** are drawn separately and can be
  colored independently, so you can tell at a glance which shadows are cast
  by your design.
- **Shadow opacity** makes the shadows as subtle or as strong as you need
  against the backdrop.
- **Terrain** can be recolored to control the overall look of the scene the
  shadows are drawn on.
- Each group can be **checked on or off**, and **Reset colors** restores the
  defaults.
- **Visibility** toggles hide or show context and design buildings entirely.
- **Shadow area** shows the ground area, in square meters, that the design
  buildings put in shadow at the current sun position. It updates live as the
  sun moves, and the exported zip includes a `shadow-areas.csv` with the area
  at every captured time.

The settings apply to both the live preview and the exported screenshots, so
the customized look carries through to the final shadow study.

## How it works

Shadows are rendered by the extension as a colored ground texture draped over
the terrain (see `src/shadowOverlay.ts`). Building meshes are projected along
the sun direction onto a heightfield rasterized from the terrain mesh, so the
shadows follow sloped ground. Elements in the proposal's base layer are
classified as context and everything else as design, which is what allows the
two shadow groups to be colored separately.

The color and visibility controls live in
`src/components/GeometryColorSelector.tsx`, and the preview and export buttons
refresh the overlay for each sun position before capturing.

The shadow area is measured from the same projection: the projected design
triangles are rasterized into a mask, the building footprints are cut out, and
the remaining coverage is summed. Overlapping shadows from several buildings
are therefore counted once, shadows are measured on the terrain only (not on
other buildings), and the footprints themselves are not included. The value is
shown in `src/components/ShadowAreaDisplay.tsx`.

## Local development

Follow the
[Forma getting started guide](https://aps.autodesk.com/en/docs/forma/v1/overview/getting-started/)
to create your own extension pointing to `http://localhost:8081`, using the
**RIGHT_MENU_ANALYSIS_PANEL** placement. Then install dependencies and start
the dev server:

```shell
pnpm install
pnpm start
```

The extension should now be visible in the analysis panel on the right hand
side of the Forma design UI.

## Original extension

This repository is a fork of the
[Autodesk Platform Services shadow study example](https://github.com/autodesk-platform-services/aps-forma-extension-shadow-study).
Its README contains a full walkthrough of how the base extension was built with
the Forma SDK, including file structure, state management, use of the Forma
API, styling with the Forma design system, and deployment through GitHub
Actions. That content is not repeated here.
