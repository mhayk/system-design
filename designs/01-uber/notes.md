# Uber — Scratch Notes

Working notes, open questions, and references gathered while designing. Not polished — this is the thinking space.

## Open questions

- [ ] How exactly does H3 handle neighbour lookups across resolution levels?
- [ ] What timeout is realistic for a driver to accept before re-matching?
- [ ] How to model surge regions — fixed grid cells or dynamic clusters?
- [ ] Where does the trip state machine live — Ride Service memory, or a workflow engine?

## Ideas to explore later

- Event sourcing for the trip lifecycle (replayable state transitions).
- Using Kafka as the backbone between Location Service and analytics.
- Geofencing for airport queues / special pickup zones.

## References

- Uber Engineering Blog: https://www.uber.com/en-GB/blog/
- H3 hexagonal hierarchical geospatial index: https://h3geo.org/
