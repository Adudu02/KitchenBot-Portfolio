export class ContractError extends Error {
  constructor(source, message) {
    super(`${source}: ${message}`);
    this.name = 'ContractError';
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validQuantity(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value > 0)
    || nonEmptyString(value);
}

export function validateSample(sample, source = 'sample') {
  if (sample === null || Array.isArray(sample) || typeof sample !== 'object') {
    throw new ContractError(source, 'descriptor must be a JSON object');
  }

  for (const field of ['id', 'audio', 'speaker', 'noise']) {
    if (!nonEmptyString(sample[field])) {
      throw new ContractError(source, `${field} must be a non-empty string`);
    }
  }

  if (typeof sample.transcript_literal !== 'string') {
    throw new ContractError(source, 'transcript_literal must be a string');
  }

  const items = sample.order_expected?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ContractError(source, 'order_expected.items must be a non-empty array');
  }

  items.forEach((item, index) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      throw new ContractError(source, `order_expected.items[${index}] must be an object`);
    }
    if (!nonEmptyString(item.item)) {
      throw new ContractError(source, `order_expected.items[${index}].item must be a non-empty string`);
    }
    if (!validQuantity(item.quantity)) {
      throw new ContractError(source, `order_expected.items[${index}].quantity must be a positive number or non-empty string`);
    }
    if (!Array.isArray(item.modifiers) || !item.modifiers.every(nonEmptyString)) {
      throw new ContractError(source, `order_expected.items[${index}].modifiers must be an array of non-empty strings`);
    }
  });

  return sample;
}

export function validateAliases(aliases, source = 'aliases') {
  if (aliases === null || Array.isArray(aliases) || typeof aliases !== 'object') {
    throw new ContractError(source, 'aliases must be a JSON object');
  }

  for (const [canonical, alternatives] of Object.entries(aliases)) {
    if (!nonEmptyString(canonical) || !Array.isArray(alternatives) || !alternatives.every(nonEmptyString)) {
      throw new ContractError(source, 'each alias entry must have a non-empty canonical key and an array of non-empty strings');
    }
  }

  return aliases;
}
