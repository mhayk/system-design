# Mermaid Style Comparison

Two ways to draw the Uber architecture, **both rendered natively by GitHub** (no images, no external services). Compare them and pick a favourite — we can then make it the canonical diagram.

---

## Style A — Flowchart with the **ELK layout engine**

Keeps every edge label and groups components into subgraphs. The `layout: elk` config produces tidier layering and far fewer crossing lines than the default engine.

```mermaid
---
config:
  layout: elk
  theme: dark
---
flowchart TB
  Rider([Rider])
  Driver([Driver])

  subgraph clients[Client Apps]
    RA[Rider App]
    DA[Driver App]
  end

  subgraph edge[Edge]
    GW[API Gateway]
    WS[WebSocket Fleet]
  end

  subgraph core[Core Services]
    RS[Ride Service]
    MS[Matching Service]
    LS[Location Service]
    PS[Payment Service]
  end

  subgraph hot[Hot State and Messaging]
    GEO[(Geo Index)]
    PUB{{Pub/Sub}}
    KAF[(Kafka)]
  end

  subgraph data[Durable Storage]
    TDB[(Trip DB)]
    PDB[(Payment DB)]
    DWH[(Data Warehouse)]
  end

  MAPS[Maps / Routing API]
  PSP[Payment Provider]

  Rider --> RA
  Driver --> DA
  RA -->|REST| GW
  DA -->|REST + pings| GW
  RA <-->|live updates| WS
  DA <-->|live updates| WS
  GW --> RS
  GW --> LS
  RS -->|find driver| MS
  MS -->|nearby query| GEO
  LS -->|upsert LWW| GEO
  RS -->|CAS status| GEO
  RS -->|persist trip| TDB
  RS -->|settle fare| PS
  PS --> PDB
  RS -->|status events| PUB
  LS -->|live positions| PUB
  PUB -->|fan-out| WS
  LS -.->|sampled| KAF
  RS -.->|trip events| KAF
  KAF --> DWH
  MS -.->|ETA| MAPS
  PS -->|charge| PSP
```

> If the `layout: elk` line ever fails to render, delete the `config` front-matter block and it falls back to the default engine — the diagram still works.

---

## Style B — **`architecture-beta`** with service icons

Purpose-built for cloud/service architecture, with icons per node. Looks the most like a "real" architecture diagram. Trade-off: this diagram type **does not support edge labels**, so the relationship descriptions are dropped.

```mermaid
architecture-beta
  group clients(internet)[Clients]
  group edge(cloud)[Edge]
  group core(server)[Core Services]
  group hot(database)[Hot State and Messaging]
  group data(database)[Durable Storage]
  group ext(cloud)[External]

  service riderApp(internet)[Rider App] in clients
  service driverApp(internet)[Driver App] in clients

  service gw(server)[API Gateway] in edge
  service ws(server)[WebSocket Fleet] in edge

  service rs(server)[Ride Service] in core
  service ms(server)[Matching Service] in core
  service ls(server)[Location Service] in core
  service ps(server)[Payment Service] in core

  service geo(database)[Geo Index] in hot
  service pub(server)[Pub Sub] in hot
  service kaf(disk)[Kafka] in hot

  service tdb(database)[Trip DB] in data
  service pdb(database)[Payment DB] in data
  service dwh(database)[Data Warehouse] in data

  service maps(cloud)[Maps Routing API] in ext
  service psp(cloud)[Payment Provider] in ext

  riderApp:B --> T:gw
  driverApp:B --> T:gw
  gw:B --> T:rs
  gw:B --> T:ls
  rs:R --> L:ms
  ms:B --> T:geo
  ls:B --> T:geo
  rs:B --> T:tdb
  rs:R --> L:ps
  ps:B --> T:pdb
  rs:B --> T:pub
  ls:B --> T:pub
  pub:R --> L:ws
  ls:B --> T:kaf
  kaf:B --> T:dwh
  ms:R --> L:maps
  ps:R --> L:psp
```

> `architecture-beta` needs a recent Mermaid version (11.1+). GitHub ships a current build, but if it does not render, Style A is the safe choice. Only the five built-in icons (`cloud`, `database`, `disk`, `internet`, `server`) are used, since custom icon packs require external loading that GitHub blocks.

---

## Style C — **Hand-drawn look** + ELK (the "mermaid.ai" aesthetic)

The polished look you see on mermaid.ai comes largely from open-source config that GitHub *can* render: a `look`, a `theme`, and the ELK engine. This is Style A with `look: handDrawn` and a theme applied — the closest you get to the premium aesthetic while staying native and text-based.

```mermaid
---
config:
  look: handDrawn
  layout: elk
  theme: neutral
---
flowchart TB
  Rider([Rider])
  Driver([Driver])

  subgraph clients[Client Apps]
    RA[Rider App]
    DA[Driver App]
  end

  subgraph edge[Edge]
    GW[API Gateway]
    WS[WebSocket Fleet]
  end

  subgraph core[Core Services]
    RS[Ride Service]
    MS[Matching Service]
    LS[Location Service]
    PS[Payment Service]
  end

  subgraph hot[Hot State and Messaging]
    GEO[(Geo Index)]
    PUB{{Pub/Sub}}
    KAF[(Kafka)]
  end

  subgraph data[Durable Storage]
    TDB[(Trip DB)]
    PDB[(Payment DB)]
    DWH[(Data Warehouse)]
  end

  MAPS[Maps / Routing API]
  PSP[Payment Provider]

  Rider --> RA
  Driver --> DA
  RA -->|REST| GW
  DA -->|REST + pings| GW
  RA <-->|live updates| WS
  DA <-->|live updates| WS
  GW --> RS
  GW --> LS
  RS -->|find driver| MS
  MS -->|nearby query| GEO
  LS -->|upsert LWW| GEO
  RS -->|CAS status| GEO
  RS -->|persist trip| TDB
  RS -->|settle fare| PS
  PS --> PDB
  RS -->|status events| PUB
  LS -->|live positions| PUB
  PUB -->|fan-out| WS
  LS -.->|sampled| KAF
  RS -.->|trip events| KAF
  KAF --> DWH
  MS -.->|ETA| MAPS
  PS -->|charge| PSP
```

> `look: handDrawn` needs Mermaid 11+. Swap `theme: neutral` for `default`, `dark`, `forest`, or `base` to taste. Remove the whole `config` block to fall back to plain rendering.

---

## Quick comparison

| | Style A — ELK flowchart | Style B — architecture-beta | Style C — hand-drawn + ELK |
|---|---|---|---|
| Edge labels | ✅ Yes | ❌ No | ✅ Yes |
| Icons | ❌ No | ✅ Yes | ❌ No |
| Aesthetic | Clean, technical | Icon-led overview | Polished / sketch |
| Renderer requirement | Modern Mermaid | Mermaid 11.1+ | Mermaid 11+ |
| Native on GitHub | ✅ | ✅ | ✅ |

**Key point:** all three are native and text-based. Anything beyond this (the exact mermaid.ai proprietary render) means exporting an SVG and committing it — same trade-off as IcePanel.
