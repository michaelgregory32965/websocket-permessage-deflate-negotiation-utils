# websocket-permessage-deflate-negotiation-utils

Parses and constructs the `permessage-deflate` extension offers and responses carried in the `Sec-WebSocket-Extensions` header.

```js
import { parseOffer, negotiate, buildExtensions } from 'websocket-permessage-deflate-negotiation-utils';

const offer = parseOffer('permessage-deflate; client_max_window_bits');
// { serverNoContextTakeover: false,
//   clientNoContextTakeover: false,
//   serverMaxWindowBits: undefined,
//   clientMaxWindowBits: true }

const response = negotiate('permessage-deflate; client_max_window_bits');
// 'permessage-deflate; client_max_window_bits=15'

buildExtensions({ serverNoContextTakeover: true });
// 'permessage-deflate; server_no_context_takeover'
```

## Why this exists

The `Sec-WebSocket-Extensions` header is a comma-separated list of extensions whose parameters can be valueless, numeric, or quoted strings containing commas. Splitting it with `String.prototype.split(',')` is correct until the first quoted parameter, and then it is quietly wrong. This library parses the grammar properly, validates window-bit ranges, and rejects duplicate parameters instead of letting the last one win. The trade-off is strictness: malformed input throws `SyntaxError` or `RangeError` rather than being coerced into something plausible, because a silently misparsed negotiation produces a connection that fails later with no useful diagnostic.

## Exports

- `splitExtensions(headerValue)` — splits a header value on top-level commas, respecting quoted strings.
- `parseExtensions(headerValue)` — returns an array of `{ name, params }`, where `params` is a `Map` and valueless parameters map to `true`.
- `serializeExtensions(extensions)` — the inverse of `parseExtensions` for the values this library produces.
- `parseOffer(headerValue)` — returns a normalized `permessage-deflate` offer object, or `null` if the extension is not present.
- `buildExtensions(config)` — builds a header value from a negotiation result.
- `negotiate(offerHeader, options)` — returns the response header value, or `null` to decline.

## The awkward edge

A valueless `client_max_window_bits` in an offer is a request for the server to choose a window size, while a valued one is a hard constraint. `negotiate` therefore answers the valueless form with `client_max_window_bits=15` and echoes any concrete value unchanged. The same parameter name means two different things depending on whether `=value` was present, and this library keeps that distinction rather than collapsing it.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

