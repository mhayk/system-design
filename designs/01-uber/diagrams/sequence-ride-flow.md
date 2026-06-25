# Sequence Diagram — Ride Lifecycle

The end-to-end flow of a single ride, from request to payment. Renders inline on GitHub.

```mermaid
sequenceDiagram
    autonumber
    actor Rider
    participant RA as Rider App
    participant GW as API Gateway
    participant RS as Ride Service
    participant MS as Matching Service
    participant GEO as Geo Index
    participant NS as Notification Service
    participant DA as Driver App
    actor Driver
    participant PAY as Payment Service

    Note over Driver,GEO: Drivers continuously ping their location (background)
    Driver->>DA: moving
    DA->>GW: POST /drivers/{id}/location (every ~4s)
    GW->>GEO: upsert driver location (last-write-wins)

    rect rgb(235, 245, 255)
    Note over Rider,GEO: 1 — Request & Match
    Rider->>RA: Request ride (pickup, destination)
    RA->>GW: POST /v1/rides
    GW->>RS: create ride (status: requested)
    RS->>MS: find driver for pickup
    MS->>GEO: query nearby available drivers
    GEO-->>MS: candidate drivers (ranked by ETA)
    end

    rect rgb(240, 255, 240)
    Note over MS,Driver: 2 — Offer & Accept (race-safe)
    MS->>NS: offer ride to top candidate
    NS-->>DA: push ride offer
    DA-->>Driver: show offer
    Driver->>DA: Accept
    DA->>GW: POST /v1/rides/{id}/accept
    GW->>RS: accept
    RS->>GEO: atomic CAS — mark driver busy
    alt driver already taken
        GEO-->>RS: CAS failed
        RS->>MS: re-match next candidate
    else won the match
        GEO-->>RS: CAS ok
        RS->>RS: status: matched
        RS-->>NS: notify both parties
        NS-->>RA: driver matched + live ETA
        NS-->>DA: pickup details + route
    end
    end

    rect rgb(255, 250, 235)
    Note over Rider,Driver: 3 — Trip in progress (live tracking)
    Driver->>DA: en route / pickup / driving
    DA->>GW: location pings
    GW->>NS: forward live position
    NS-->>RA: live driver location (WebSocket)
    Driver->>DA: Complete trip (drop-off)
    DA->>GW: POST complete
    GW->>RS: status: completed
    end

    rect rgb(255, 240, 245)
    Note over RS,Rider: 4 — Fare & Payment
    RS->>PAY: compute fare (distance, time, surge)
    PAY->>PAY: charge rider's payment method
    PAY-->>RS: payment confirmed
    RS-->>NS: trip receipt
    NS-->>RA: receipt + fare
    NS-->>DA: earnings
    end
```

## Notes on the flow

- **Background location pings** (steps before the request) run continuously and independently — they keep the geo index fresh so matching has data to query.
- **The atomic CAS** (compare-and-set) on the driver's status is what prevents the same driver being double-booked. The `alt` branch shows the loser of a race falling back to re-matching.
- **Live tracking** during the trip flows over the WebSocket held open by the Notification Service, not by polling.
- **Payment** happens only on completion, as a distinct step the Ride Service orchestrates.
