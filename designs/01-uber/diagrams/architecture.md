# Detailed Architecture Diagram

A more detailed view than the high-level diagram in the [main write-up](../README.md), showing the client layer, connection fleet, regional sharding, the isolated location firehose path, pub/sub fan-out, and the datastores.

```mermaid
---
config:
  look: handDrawn
  layout: elk
  theme: neutral
---
flowchart TB
    subgraph CLIENT[📱 Client Layer]
        RA[Rider App]
        DA[Driver App]
    end

    subgraph EDGE[🌐 Edge]
        LB[Load Balancer<br/>geo-aware routing]
        GW[API Gateway<br/>auth · rate limit · routing]
        WS[WebSocket Fleet<br/>persistent connections]
    end

    RA -->|REST| LB
    DA -->|REST + pings| LB
    RA <-->|live updates| WS
    DA <-->|live updates| WS
    LB --> GW

    subgraph CORE[⚙️ Core Services · per-region shards]
        RS[Ride Service<br/>trip state machine]
        MS[Matching Service]
        LS[Location Service<br/>write-optimised]
        PAY[Payment Service]
    end

    GW --> RS
    GW --> LS
    RS -->|find driver| MS

    subgraph GEOSTORE[🗺️ Geo / Hot State]
        GEO[(Geo Index<br/>Redis · H3 cells<br/>sharded by region)]
    end

    LS -->|upsert LWW| GEO
    MS -->|nearby query| GEO
    RS -->|CAS driver status| GEO

    subgraph MSG[📨 Messaging]
        PUBSUB([Pub/Sub<br/>fan-out to WS fleet])
        KAFKA([Kafka<br/>event stream])
    end

    RS -->|status events| PUBSUB
    LS -->|live positions| PUBSUB
    PUBSUB --> WS
    LS -.->|sampled| KAFKA
    RS -.->|trip events| KAFKA

    subgraph DATA[💾 Durable Storage]
        TRIPDB[(Trip DB<br/>relational · sharded)]
        PAYDB[(Payment DB<br/>ACID)]
        DWH[(Analytics / DWH)]
    end

    RS -->|persist trip| TRIPDB
    RS -->|settle fare| PAY
    PAY --> PAYDB
    KAFKA --> DWH

    subgraph EXT[🔌 External]
        MAPS[Maps / Routing API<br/>ETA · distance]
        PSP[Payment Provider]
    end

    MS -.->|ETA| MAPS
    RS -.-> MAPS
    PAY -.->|charge| PSP
```

## Reading the diagram

### The two paths
The design deliberately separates two very different workloads:

- **🔴 Hot path (location firehose):** `Driver App → LB → API Gateway → Location Service → Geo Index`. ~250k writes/sec, last-write-wins, in-memory, no durability. It never touches the relational databases.
- **🔵 Correctness path (trips & payments):** `Ride Service → Trip DB / Payment Service → Payment DB`. Low volume, ACID, sharded by region.

### Real-time delivery
The **WebSocket Fleet** holds millions of persistent connections. Services don't push to clients directly — they publish to **Pub/Sub**, which fans out to whichever connection server holds the target client's socket. This decouples the stateless core services from the stateful connection layer and lets each scale independently.

### Regional sharding
Core services and the Geo Index are **sharded by region** (city / metro area). A ride is local — a rider in London is never matched with a driver in Tokyo — so partitioning by geography keeps shards independent and enables regional failover.

### Analytics decoupling
**Kafka** carries a sampled copy of location data and all trip events to the data warehouse. This analytics path is fully decoupled from the live path, so it can lag or backpressure without affecting active rides.

### External dependencies
- **Maps / Routing API** — real road-network ETA and distance for ranking candidates and computing fares (straight-line distance is not good enough).
- **Payment Provider (PSP)** — the actual card charge, behind the Payment Service.
