import RandExp from 'randexp';
// Set RandExp default range to a-z, A-Z, 0-9 for implicit patterns
RandExp.prototype.defaultRange.subtract(32, 126).add(48, 57).add(65, 90).add(97, 122);
RandExp.prototype.max = 3; // Set global max for all RandExp instances

// Lightweight mock data generator
const MockData = {
   countryCodes: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'IN', 'BR', 'MX', 'SG', 'HK', 'NZ', 'SE', 'CH'],
   currencyCodes: ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD', 'SGD', 'HKD', 'MXN', 'BRL'],
   
   pickOne(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
   },
   
   int(min = 0, max = 999999) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
   },
   
   float(min = 0, max = 999999, decimals = 2) {
      return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
   },
   
   string(length = 10, chars = 'abcdefghijklmnopqrstuvwxyz') {
      let result = '';
      for (let i = 0; i < length; i++) {
         result += chars[Math.floor(Math.random() * chars.length)];
      }
      return result;
   },
   
   uuid() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
         const r = (Math.random() * 16) | 0;
         return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
   },
   
   email() {
      return `${this.string(8)}@${this.string(6)}.com`;
   },
   
   url() {
      return `https://${this.string(10)}.com/`;
   },
   
   dateISO(daysBack = 30) {
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
      return d.toISOString();
   },
   
   dateOnly(daysBack = 30) {
      return this.dateISO(daysBack).split('T')[0];
   },
   
   boolean() {
      return Math.random() > 0.5;
   },
   
   ctry() {
      return this.pickOne(this.countryCodes);
   },
   
   curr() {
      return this.pickOne(this.currencyCodes);
   },
   
   latitude() {
      return this.float(-90, 90, 6);
   },
   
   longitude() {
      return this.float(-180, 180, 6);
   },
   
   base64(length = 10) {
      return Buffer.from(this.string(length)).toString('base64');
   },
   
   json() {
      return JSON.stringify({ key: this.string(8) });
   },
   
   html() {
      return `<p>${this.string(20)}</p>`;
   },
   
   text() {
      return this.string(15, 'abcdefghijklmnopqrstuvwxyz ');
   }
};

// Simple mock data generator based on JSON Schema, with depth control to prevent infinite recursion
export function generateMockFromSchema(schema, definitions = {}, parentKey = '', traceid = '', depth = 0, _pathSet = new Set()) {
   const MAX_DEPTH = 12;
   const shallowMode = depth > MAX_DEPTH; // Flag to skip recursion but respect schema

   // Prevent circular recursion by tracking PATHS, not schema objects
   // This allows schema reuse (like EventDateTime for both start and end)
   if (schema && typeof schema === 'object' && schema.$ref) {
      const refKey = schema.$ref;

      // Check if this $ref is already in our current path
      if (_pathSet.has(refKey)) {
         // True circular reference in path
         return undefined;
      }

      // Add to path and pass down
      const newPathSet = new Set(_pathSet);
      newPathSet.add(refKey);
      _pathSet = newPathSet;
   }

   if (shallowMode) {
      //console.log(`Max recursion depth (${MAX_DEPTH}) reached for ${parentKey} ${traceid}`);
      // In shallow mode, we continue through the function but skip recursion
      // This allows full schema validation (const/enum/default/format/pattern)
   }

   if (!schema || typeof schema !== 'object') return null;
   // Return early if schema is an empty object (no response schema for method in discovery docs)
   if (Object.keys(schema).length === 0) return null;

   // Handle $ref
   if (schema.$ref) {
      if (shallowMode) {
         // Return appropriate type-based default instead of null
         const refPath = schema.$ref.split('/').pop();
         const resolvedSchema = definitions[refPath];
         if (resolvedSchema?.type === 'array') return [];
         if (resolvedSchema?.type === 'object') return {};
         return null;
      }
      const refPath = schema.$ref.split('/').pop();
      if (definitions[refPath]) {
         return generateMockFromSchema(definitions[refPath], definitions, parentKey, traceid + `->${refPath}`, depth + 1, _pathSet);
      }
      console.log(`Warning: Unable to resolve $ref: ${schema.$ref}`, parentKey, traceid);
      return null;
   }

   // Handle oneOf/anyOf before const/enum/default
   if (schema.oneOf || schema.anyOf) {
      if (shallowMode) {
         // Return safe default based on common type
         return schema.type === 'array' ? [] : schema.type === 'object' ? {} : null;
      }
      const variants = schema.oneOf || schema.anyOf;
      const chosen = MockData.pickOne(variants);
      return generateMockFromSchema(chosen, definitions, parentKey, traceid + '->variant', depth + 1, _pathSet); // <-- add _seen
   }

   if (schema.const !== undefined) return schema.const;
   if (schema.enum !== undefined && Array.isArray(schema.enum) && schema.enum.length > 0) {
      return MockData.pickOne(schema.enum);
   }

   // Skip empty string defaults - treat them as undefined
   if (schema.default !== undefined) {
      // If default is empty string and there's a pattern, ignore the default
      if (schema.default === '' && schema.pattern) {
         // Fall through to pattern generation below
      } else if (schema.default === '') {
         // Empty string default means optional field - return undefined to omit it
         return undefined;
      } else {
         return schema.default;
      }
   }

   // Normalize schema.type (handle union types like ["string","array"])
   let schemaType = schema.type;

   // If schema.type is an array (union), pick the best concrete type:
   if (Array.isArray(schema.type)) {
      // Prefer 'array' when items schema is provided (common pattern for "string or array of strings")
      if (schema.type.includes('array') && schema.items) {
         schemaType = 'array';
      } else if (schema.type.includes('string')) {
         schemaType = 'string';
      } else if (schema.type.includes('object')) {
         schemaType = 'object';
      } else {
         // fallback to first declared type
         schemaType = schema.type[0];
      }
   }

   if (schemaType === undefined && schema.description !== undefined) schemaType = 'string'; // assume string if description exists but no type

   // Better handling of missing/optional fields
   // If schema has no type and no constraints, return undefined instead of null
   if (!schemaType && !schema.properties && !schema.items && !schema.oneOf && !schema.anyOf) {
      return undefined; // Don't generate empty strings
   }

   const k11 = parentKey.toLowerCase(); // fuzzy key from parentKey 
   const useFuzzy = !schema.format && !schema.pattern && schema.const === undefined && schema.default === undefined && schema.enum === undefined && !schema.$ref;
   const useFuzzy2 = schema.const === undefined && schema.default === undefined && schema.enum === undefined && !schema.$ref;

   // Handle different types
   switch (schemaType) {
      case 'object':
         {
            if (shallowMode) return {}; // Empty object in shallow mode

            const obj = {};
            if (schema.properties) {
               for (const [key, propSchema] of Object.entries(schema.properties)) {
                  const value = generateMockFromSchema(propSchema, definitions, key, traceid + `->props[${key}]`, depth + 1, _pathSet); // <-- add _seen
                  // Only add property if value is not undefined
                  if (value !== undefined) {
                     obj[key] = value;
                  }
               }
            }
            return obj;
         }

      case 'array':
         {
            if (shallowMode) return []; // Empty array in shallow mode

            // Handle missing items schema
            if (!schema.items) {
               console.log(`Warning: Array schema missing items definition`, parentKey, traceid);
               return [];
            }

            let min = schema.minItems ?? 1;
            let max = schema.maxItems ?? Math.max(min, 2);
            const arrayLength = MockData.int(min, max);
            const generatedItems = Array.from({ length: arrayLength }, () =>
               generateMockFromSchema(schema.items, definitions, parentKey, traceid + '->arrayItems', depth + 1, _pathSet) // <-- add _seen
            ).filter(item => item !== undefined && item !== null); // Remove null AND undefined

            // If all items were filtered out, return empty array (not array with nulls)
            return generatedItems.length > 0 ? generatedItems : [];
         }

      case 'string':
         {
            if (
               useFuzzy2 &&
               (schema.pattern === '^-?[0-9]+$' || schema.format === 'int64' || schema.format === 'int32')
               // && (k11.includes('total') || k11.includes('count') || k11.includes('items') || k11.includes('number'))
            ) {
               return MockData.int(1, 999999).toString();
            }

            if (useFuzzy && parentKey.includes('Url') && !parentKey.includes('MaxAgeSec')) return MockData.url();
            if (useFuzzy && (k11.includes('reviewedsite') || k11 === 'url' || k11 === 'selflink')) return MockData.url();
            if (useFuzzy && k11 === 'currencycode') return MockData.curr();
            if (useFuzzy && k11 === 'countrycode') return MockData.ctry();

            // **DATETIME DETECTION - Handle BEFORE generic pattern check**
            // Detect RFC 3339 datetime pattern (Google API standard)
            // Pattern contains year-month-day and hour:minute:second with T separator
            const isRFC3339Pattern = schema.pattern &&
               (schema.pattern.includes('d{4}') || schema.pattern.includes('d\\d\\d\\d')) && // Year
               schema.pattern.includes('T') && // Date-time separator
               schema.pattern.includes(':'); // Time component

            if (isRFC3339Pattern || schema.format === 'date-time' || schema.format === 'google-datetime') {
               // Generate valid RFC 3339 datetime directly
               return MockData.dateISO(30); // Always valid: "2025-11-12T10:30:45.123Z"
            }
            if (useFuzzy && (k11 === 'start-date' || k11 === 'end-date')) {
               return MockData.dateOnly(30);
            }
            if (useFuzzy && schema.description?.toLowerCase().includes('rfc 3339 date-time')) {
               return MockData.dateISO(30);
            }

            // DATE pattern detection (YYYY-MM-DD only, no time)
            const isDatePattern = schema.pattern &&
               (schema.pattern.includes('d{4}') || schema.pattern.includes('d\\d\\d\\d')) &&
               !schema.pattern.includes('T'); // No time component

            if (isDatePattern || schema.format === 'date') {
               return MockData.dateOnly(30); // "2025-11-12"
            }

            // Check pattern BEFORE fuzzy logic (for other patterns)
            if (schema.pattern !== undefined) {
               let p = schema.pattern.trim(); // process pattern for RandExp
               p = p.replace(/\\\\/g, '\\'); // Unescape double backslashes
               p = p.replace(/^"|"$/g, ''); // Remove surrounding quotes if present
               p = p.replace(/([^\\])\//g, '$1\\/'); // Escape unescaped slashes
               p = p.replace(/^\^+/, '^').replace(/\$+$/, '$'); // Clean up anchors 

               try {
                  new RegExp(p); // validate regex
                  const randexp = new RandExp(p);
                  // randexp.max = 3;
                  let generated = randexp.gen();

                  // Better URL param detection
                  const isUrlParam = traceid.includes('query') ||
                     traceid.includes('params') ||
                     traceid.includes('gquery') ||
                     traceid.includes('gparams');

                  if (isUrlParam) {
                     // Remove characters that break URLs: # ? & space
                     generated = generated.replace(/[#?&\s]/g, '-');
                  }

                  // Validate against minLength/maxLength
                  if (schema.minLength && generated.length < schema.minLength) {
                     generated = generated.padEnd(schema.minLength, 'x');
                  }
                  if (schema.maxLength && generated.length > schema.maxLength) {
                     generated = generated.substring(0, schema.maxLength);
                  }

                  return generated;
               } catch (err) {
                  console.log(`Warning: Invalid pattern "${p}". Error: ${err.message}`, parentKey, traceid); // invalid regex
                  return MockData.string(10);
               }
            } // end pattern

            // Fuzzy logic (after pattern check)
            if (!schema.format && schema.const === undefined && schema.default === undefined && schema.enum === undefined && !schema.$ref) {
               const k11 = parentKey.toLowerCase(); // fuzzy key from parentKey 
               let v11 = '';

               if (k11.includes('email')) v11 = MockData.email();
               else if (k11.includes('country')) v11 = MockData.ctry();
               else if (k11.includes('address')) v11 = MockData.string(10);
               else if (k11.includes('zipcode') || k11.includes('postalcode')) v11 = MockData.string(5, '0123456789');
               else if (k11.includes('phone') || k11.includes('mobile')) v11 = `+1${MockData.int(2000000000, 9999999999)}`;

               if (v11 !== '') {
                  if (schema.minLength && v11.length < schema.minLength) v11 = v11.padEnd(schema.minLength, 'X');
                  if (schema.maxLength && v11.length > schema.maxLength) v11 = v11.substring(0, schema.maxLength);
                  return v11;
               }
            } // end fuzzy logic

            if (schema.format === 'date-time' || schema.format === 'google-datetime') return MockData.dateISO(); //date-time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
            if (schema.format === 'date') return MockData.dateOnly(); //date: /^\d{4}-\d{2}-\d{2}$/      
            if (schema.format === 'email') return MockData.email();
            if (schema.format === 'uri') return MockData.url();
            if (schema.format === 'uuid') return MockData.uuid();
            if (schema.minLength !== undefined || schema.maxLength !== undefined) {
               return MockData.string(schema.maxLength ?? schema.minLength ?? 10);
            }
            if (schema.contentEncoding === 'base64') return MockData.base64(10);
            if (schema.contentEncoding === 'binary') return MockData.string(10);
            if (schema.contentMediaType === 'application/json') return MockData.json();
            if (schema.contentMediaType === 'text/html') return MockData.html();
            if (schema.contentMediaType === 'text/plain') return MockData.text();

            // default string
            return MockData.string(10);
         }

      case 'integer':
         {
            if (useFuzzy && k11.includes('expirationdays')) return MockData.int(1, 365);
            if (useFuzzy && k11 === 'year') return MockData.int(1970, 2025);
            if (useFuzzy && k11 === 'month') return MockData.int(1, 12);
            if (useFuzzy && k11 === 'day') return MockData.int(1, 31);

            // Use exclusiveMinimum/exclusiveMaximum if present, else minimum/maximum
            let min = schema.exclusiveMinimum !== undefined
               ? Math.ceil(schema.exclusiveMinimum + 1e-9) // next integer above exclusiveMinimum
               : (schema.minimum ?? 0);
            let max = schema.exclusiveMaximum !== undefined
               ? Math.floor(schema.exclusiveMaximum - 1e-9) // previous integer below exclusiveMaximum
               : (schema.maximum ?? 999999);
            if (min > max) [min, max] = [max, min]; // Ensure valid range (swap if inverted)
            min = Math.max(Number.MIN_SAFE_INTEGER, min);
            max = Math.min(Number.MAX_SAFE_INTEGER, max);
            if (min < 0) min = 0; // always return positive numbers
            return MockData.int(min, max);
         }

      case 'number':
         {
            if (useFuzzy2 && schema.description?.toLowerCase().includes('latitude') && (k11.includes('latitude') || k11 === 'lat')) return MockData.latitude();
            if (useFuzzy2 && schema.description?.toLowerCase().includes('longitude') && (k11.includes('longitude') || k11 === 'long' || k11 === 'lng')) return MockData.longitude();

            let min = schema.exclusiveMinimum !== undefined
               ? schema.exclusiveMinimum + Number.EPSILON
               : (schema.minimum ?? 0);
            let max = schema.exclusiveMaximum !== undefined
               ? schema.exclusiveMaximum - Number.EPSILON
               : (schema.maximum ?? 999999);
            if (min > max) [min, max] = [max, min]; // Ensure valid range (swap if inverted)
            min = Math.max(-1e12, min);
            max = Math.min(1e12, max);
            if (min < 0) min = 0; // always return positive numbers
            return MockData.float(min, max, 2);
         }

      case 'boolean':
         return MockData.boolean();
      default:
         console.log(`Warning: Unsupported schema type: ${schema.type}`, JSON.stringify(schema, null, 2), parentKey, traceid);
         return undefined; // Return undefined instead of null for unknown types
   } // switch schema.type
} // generateMockFromSchema
