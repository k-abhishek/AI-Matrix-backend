import { z } from 'zod';

/**
 * Converts a standard JSON Schema object into an equivalent Zod schema.
 */
export function jsonSchemaToZod(schema: Record<string, any>): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return z.record(z.string(), z.any());
  }

  // Handle direct enums
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const stringEnums = schema.enum.map(String);
    if (stringEnums.length === 1) {
      return z.literal(stringEnums[0]);
    }
    return z.enum(stringEnums as [string, ...string[]]);
  }

  const type = schema.type;

  switch (type) {
    case 'string': {
      let str = z.string();
      if (schema.description) {
        str = str.describe(schema.description);
      }
      return str;
    }

    case 'number':
    case 'integer': {
      let num = z.number();
      if (schema.description) {
        num = num.describe(schema.description);
      }
      return num;
    }

    case 'boolean': {
      let bool = z.boolean();
      if (schema.description) {
        bool = bool.describe(schema.description);
      }
      return bool;
    }

    case 'array': {
      const itemsSchema = schema.items ? jsonSchemaToZod(schema.items) : z.any();
      return z.array(itemsSchema);
    }

    case 'object': {
      const properties = schema.properties || {};
      const requiredList = Array.isArray(schema.required) ? schema.required : [];
      const shape: Record<string, z.ZodTypeAny> = {};

      for (const [key, propDef] of Object.entries(properties)) {
        let fieldZod = jsonSchemaToZod(propDef as Record<string, any>);
        if (!requiredList.includes(key)) {
          fieldZod = fieldZod.optional();
        }
        shape[key] = fieldZod;
      }

      // If no properties defined, allow arbitrary dictionary
      if (Object.keys(shape).length === 0) {
        return z.record(z.string(), z.any());
      }

      return z.object(shape);
    }

    default:
      return z.any();
  }
}

export default jsonSchemaToZod;
