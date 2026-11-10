function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export function defineProvider(config, transcribe) {
  requireString(config?.id, 'provider id');
  if (typeof transcribe !== 'function') {
    throw new TypeError('provider transcribe must be a function');
  }

  return Object.freeze({
    id: config.id,
    config,
    async transcribe(request) {
      requireString(request?.audioPath, 'audioPath');
      requireString(request?.language, 'language');
      requireString(request?.model, 'model');

      const result = await transcribe(request);
      if (typeof result?.transcript !== 'string') {
        throw new TypeError('transcript must be a string');
      }
      requireString(result?.provider, 'provider');
      requireString(result?.model, 'model');
      if (!Object.hasOwn(result, 'raw')) {
        throw new TypeError('provider result must include raw metadata');
      }

      return result;
    }
  });
}
