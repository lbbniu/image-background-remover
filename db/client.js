import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export function getDb(d1) {
  if (!d1) {
    throw new Error('D1 database binding is required');
  }

  return drizzle(d1, { schema });
}

export { schema };
