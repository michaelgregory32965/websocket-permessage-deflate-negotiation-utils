const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Splits a header value into extension entries on commas that are not inside
 * quoted strings. RFC 7230 allows quoted-string parameters to contain commas,
 * so a naive split on ',' corrupts values such as `server_max_window_bits="15,16"`.
 */
export function splitExtensions(headerValue) {
  if (typeof headerValue !== 'string') {
    throw new TypeError('headerValue must be a string');
  }
  const parts = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;
  for (let i = 0; i < headerValue.length; i += 1) {
    const ch = headerValue[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (inQuotes && ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseParameters(rest) {
  const params = new Map();
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && (rest[i] === ' ' || rest[i] === '\t')) i += 1;
    if (i >= rest.length) break;
    if (rest[i] !== ';') {
      throw new SyntaxError(`expected ';' at position ${i} in parameters`);
    }
    i += 1;
    while (i < rest.length && (rest[i] === ' ' || rest[i] === '\t')) i += 1;
    let name = '';
    while (i < rest.length && rest[i] !== '=' && rest[i] !== ';' && rest[i] !== ' ' && rest[i] !== '\t') {
      name += rest[i];
      i += 1;
    }
    if (name.length === 0) {
      throw new SyntaxError('empty parameter name');
    }
    if (!TOKEN.test(name)) {
      throw new SyntaxError(`invalid parameter name: ${name}`);
    }
    while (i < rest.length && (rest[i] === ' ' || rest[i] === '\t')) i += 1;
    let value = true;
    if (i < rest.length && rest[i] === '=') {
      i += 1;
      while (i < rest.length && (rest[i] === ' ' || rest[i] === '\t')) i += 1;
      if (rest[i] === '"') {
        i += 1;
        let v = '';
        let closed = false;
        while (i < rest.length) {
          const ch = rest[i];
          if (ch === '\\') {
            if (i + 1 >= rest.length) throw new SyntaxError('dangling escape in quoted string');
            v += rest[i + 1];
            i += 2;
            continue;
          }
          if (ch === '"') {
            i += 1;
            closed = true;
            break;
          }
          v += ch;
          i += 1;
        }
        if (!closed) throw new SyntaxError('unterminated quoted string');
        value = v;
      } else {
        let v = '';
        while (i < rest.length && rest[i] !== ';' && rest[i] !== ' ' && rest[i] !== '\t') {
          v += rest[i];
          i += 1;
        }
        if (v.length === 0) throw new SyntaxError('empty parameter value');
        if (!TOKEN.test(v)) throw new SyntaxError(`invalid parameter value: ${v}`);
        value = v;
      }
    }
    if (params.has(name)) {
      throw new SyntaxError(`duplicate parameter: ${name}`);
    }
    params.set(name, value);
  }
  return params;
}

function parseEntry(entry) {
  const semicolon = entry.indexOf(';');
  const name = (semicolon === -1 ? entry : entry.slice(0, semicolon)).trim();
  if (name.length === 0) {
    throw new SyntaxError('empty extension name');
  }
  if (!TOKEN.test(name)) {
    throw new SyntaxError(`invalid extension name: ${name}`);
  }
  const rest = semicolon === -1 ? '' : entry.slice(semicolon);
  return { name, params: parseParameters(rest) };
}

/**
 * Parses a `Sec-WebSocket-Extensions` header value into extension entries.
 *
 * Returns an array of `{ name, params }` where `params` is a `Map`. A bare
 * parameter (no `=`) is represented by the boolean `true`; this matches the
 * RFC 6455 grammar and keeps `permessage-deflate` offers distinguishable from
 * responses that carry explicit values. Duplicate parameters or malformed
 * tokens throw a `SyntaxError` rather than being silently dropped, because a
 * silently ignored parameter is a negotiation bug that is very hard to see.
 */
export function parseExtensions(headerValue) {
  if (headerValue === undefined || headerValue === null || headerValue === '') {
    return [];
  }
  if (typeof headerValue !== 'string') {
    throw new TypeError('headerValue must be a string');
  }
  return splitExtensions(headerValue).map(parseEntry);
}

function needsQuoting(value) {
  return !TOKEN.test(value);
}

function quote(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function serializeParams(params) {
  if (params === undefined || params === null) return '';
  const entries = params instanceof Map ? Array.from(params.entries()) : Object.entries(params);
  let out = '';
  for (const [name, value] of entries) {
    if (!TOKEN.test(name)) {
      throw new TypeError(`invalid parameter name: ${name}`);
    }
    if (value === true || value === undefined) {
      out += `; ${name}`;
    } else if (typeof value === 'number') {
      out += `; ${name}=${value}`;
    } else if (typeof value === 'string') {
      out += `; ${name}=${needsQuoting(value) ? quote(value) : value}`;
    } else {
      throw new TypeError(`unsupported parameter value for ${name}`);
    }
  }
  return out;
}

/**
 * Serializes extension entries back into a header value. This is the inverse of
 * `parseExtensions` for the subset of values this library produces: strings are
 * quoted only when they contain characters outside the HTTP token set, numbers
 * are emitted bare, and `true` emits a valueless parameter.
 */
export function serializeExtensions(extensions) {
  if (!Array.isArray(extensions)) {
    throw new TypeError('extensions must be an array');
  }
  return extensions
    .map(({ name, params }) => {
      if (typeof name !== 'string' || !TOKEN.test(name)) {
        throw new TypeError(`invalid extension name: ${name}`);
      }
      return name + serializeParams(params);
    })
    .join(', ');
}

function toMap(params) {
  if (params === undefined || params === null) return new Map();
  if (params instanceof Map) return new Map(params);
  return new Map(Object.entries(params));
}

function normalizeWindowBits(rawValue, paramName) {
  if (rawValue === undefined) return undefined;
  if (rawValue === true) return true;
  const text = String(rawValue);
  if (!/^\d+$/.test(text)) {
    throw new SyntaxError(`${paramName} must be a decimal integer`);
  }
  const n = Number(text);
  if (n < 8 || n > 15) {
    throw new RangeError(`${paramName} must be between 8 and 15`);
  }
  return n;
}

/**
 * Extracts the `permessage-deflate` offer from a parsed header. Returns `null`
 * when the header does not contain that extension. Only the first occurrence is
 * used: a peer that offers the same extension twice is malformed, and picking
 * the first is the behaviour browsers have settled on.
 */
export function parseOffer(headerValue) {
  const entries = parseExtensions(headerValue);
  for (const entry of entries) {
    if (entry.name === 'permessage-deflate') {
      return {
        serverNoContextTakeover: entry.params.get('server_no_context_takeover') === true,
        clientNoContextTakeover: entry.params.get('client_no_context_takeover') === true,
        serverMaxWindowBits: normalizeWindowBits(entry.params.get('server_max_window_bits'), 'server_max_window_bits'),
        clientMaxWindowBits: normalizeWindowBits(entry.params.get('client_max_window_bits'), 'client_max_window_bits')
      };
    }
  }
  return null;
}

/**
 * Builds a `Sec-WebSocket-Extensions` value from a negotiation result. Fields
 * left as `undefined` or `false` are omitted, which is what the RFC expects for
 * a parameter the endpoint is not requesting.
 */
export function buildExtensions(config = {}) {
  const params = new Map();
  if (config.serverNoContextTakeover === true) params.set('server_no_context_takeover', true);
  if (config.clientNoContextTakeover === true) params.set('client_no_context_takeover', true);
  if (config.serverMaxWindowBits !== undefined) {
    params.set('server_max_window_bits', normalizeWindowBits(config.serverMaxWindowBits, 'server_max_window_bits'));
  }
  if (config.clientMaxWindowBits !== undefined) {
    params.set('client_max_window_bits', normalizeWindowBits(config.clientMaxWindowBits, 'client_max_window_bits'));
  }
  return serializeExtensions([{ name: 'permessage-deflate', params }]);
}

/**
 * Negotiates a `permessage-deflate` response from a parsed offer.
 *
 * The policy is deliberately conservative: the server accepts the extension
 * only when the offer explicitly asks for it, echoes `server_no_context_takeover`
 * when the client requested it (that is a client-side requirement, not a
 * preference), and otherwise keeps context takeover enabled. `client_max_window_bits`
 * is accepted as a request for the server to choose a value; we choose the
 * default 15, which is always legal.
 *
 * @param {string|Array} offerHeader raw header value or result of `parseExtensions`
 * @param {{ serverNoContextTakeover?: boolean, clientNoContextTakeover?: boolean, serverMaxWindowBits?: number, clientMaxWindowBits?: number }} options
 * @returns {string|null} header value to send back, or `null` to decline
 */
export function negotiate(offerHeader, options = {}) {
  const offer = typeof offerHeader === 'string'
    ? parseOffer(offerHeader)
    : findOffer(offerHeader);
  if (offer === null) return null;

  const result = {};

  // A client that demands no server context takeover gets it; we never invent
  // the parameter when the client did not ask, because that would change the
  // client's own memory profile without consent.
  if (offer.serverNoContextTakeover || options.serverNoContextTakeover === true) {
    result.serverNoContextTakeover = true;
  }
  if (options.clientNoContextTakeover === true) {
    result.clientNoContextTakeover = true;
  }

  if (offer.serverMaxWindowBits !== undefined) {
    if (offer.serverMaxWindowBits === true) {
      throw new SyntaxError('server_max_window_bits requires a value in an offer');
    }
    result.serverMaxWindowBits = offer.serverMaxWindowBits;
  } else if (options.serverMaxWindowBits !== undefined) {
    result.serverMaxWindowBits = options.serverMaxWindowBits;
  }

  if (offer.clientMaxWindowBits !== undefined) {
    // `client_max_window_bits` without a value is a request for the server to
    // pick; 15 is the default window and always acceptable. A concrete value in
    // the offer is a hard client constraint, so it is echoed.
    result.clientMaxWindowBits = offer.clientMaxWindowBits === true
      ? 15
      : offer.clientMaxWindowBits;
  } else if (options.clientMaxWindowBits !== undefined) {
    result.clientMaxWindowBits = options.clientMaxWindowBits;
  }

  return buildExtensions(result);
}

function findOffer(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('offer must be a string or an array of extension entries');
  }
  for (const entry of entries) {
    if (entry && entry.name === 'permessage-deflate') {
      const params = toMap(entry.params);
      return {
        serverNoContextTakeover: params.get('server_no_context_takeover') === true,
        clientNoContextTakeover: params.get('client_no_context_takeover') === true,
        serverMaxWindowBits: normalizeWindowBits(params.get('server_max_window_bits'), 'server_max_window_bits'),
        clientMaxWindowBits: normalizeWindowBits(params.get('client_max_window_bits'), 'client_max_window_bits')
      };
    }
  }
  return null;
}
