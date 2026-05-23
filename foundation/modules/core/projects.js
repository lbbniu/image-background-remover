import { DEFAULT_PROJECT_ID } from './constants.js';

export function getProjectId(env) {
  return env?.PROJECT_ID || DEFAULT_PROJECT_ID;
}
