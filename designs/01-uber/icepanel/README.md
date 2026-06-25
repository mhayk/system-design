# IcePanel — Interactive C4 View

This folder holds the script that builds the Uber architecture as a **C4 model** in [IcePanel](https://icepanel.io), giving us an interactive, navigable view alongside the inline Mermaid diagrams.

> ⚠️ **The IcePanel REST API requires a paid plan (Growth).** There is a 14-day free trial — remember to cancel before it ends if you do not wish to be charged. The model created during the trial stays viewable afterwards (within the Free plan's limit of 1 landscape / 100 objects).

## What the script does

[`build-landscape.mjs`](./build-landscape.mjs) creates, via the API:

- **Model objects** — actors (Rider, Driver), the Uber Platform system, its containers (apps & stores), and external systems (Maps API, Payment Provider).
- **Connections** — every relationship from the architecture diagram.
- **A container diagram** with a computed layered layout you can then tidy in the UI.

## Prerequisites

1. **Node 18+** (the script uses the built-in `fetch`).
2. An IcePanel account on the **Growth trial** (or paid).
3. A **landscape** created in your organisation.

## Getting your credentials

| Value | Where to find it |
|-------|------------------|
| **API key** | IcePanel → *Profile settings* → *API keys* → *Create API key*. Copy it immediately — it is shown only once. |
| **Landscape ID** | Open your landscape; it is the id in the URL: `app.icepanel.io/landscapes/`**`<landscapeId>`**`/…` |
| **Version ID** | Use the special value `latest` (the current editable version). This is the default. |

## Running it

Fill in [`.env`](./.env) (gitignored — copied from [`.env.example`](./.env.example)), then run with Node's built-in `--env-file` (Node 20.6+):

```bash
cd designs/01-uber/icepanel
node --env-file=.env build-landscape.mjs
```

Then, in IcePanel: open the *Uber Platform — Containers* diagram, adjust the layout if needed, and:

- **Share → Export → SVG** → save the file into [`../diagrams/`](../diagrams/) as `icepanel-architecture.svg`.
- **Share → copy link** → paste it into the README so the image links to the interactive view.

The README pattern (image that links out to the live diagram):

```markdown
[![Uber architecture](./diagrams/icepanel-architecture.svg)](https://s.icepanel.io/your-share-link)
```

## Re-running

The script always **creates** objects (it is not idempotent). To rebuild from scratch, clear the landscape's model in the UI first, or create a fresh landscape.
