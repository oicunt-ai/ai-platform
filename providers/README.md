# Provider Adapter Boundary

This directory documents the provider anti-corruption boundary used by the Model Gateway.

No concrete provider adapter is currently included. Future providers must be implemented behind the existing `IProviderAdapter` contract and registered with the Model Gateway adapter registry. Adding an adapter must not add provider logic to BILLY, Platform Gateway, AI Orchestrator, Inference, or Model Registry.

The boundary guarantees:

- public callers select only stable IDs in the `oicunt.model.<catalog-slug>` namespace;
- Model Registry stores the private mapping from an OICUNT model ID to provider targets and upstream model IDs;
- Model Gateway selects the registered adapter named by the resolved target;
- provider credentials and endpoints belong to the adapter's Model Gateway configuration, never Registry metadata;
- raw provider requests, responses, errors, and model identifiers never cross the adapter boundary;
- normalized streaming, cancellation, timeout, retry, error, and Usage behavior remains owned by the existing Model Gateway pipeline.

Until a provider adapter is configured, Model Gateway remains live but reports not-ready and dispatch returns the existing provider-unavailable error.
