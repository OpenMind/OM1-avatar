// Extend window interface for TypeScript
declare global {
  interface Window {
    ENV?: Record<string, string>;
  }
}

/**
 * Get environment variable value with fallback support
 * Checks runtime environment (window.ENV) first, then build-time environment (import.meta.env)
 * @param key - Environment variable key (should start with VITE_)
 * @param defaultValue - Default value if not found
 */
export function getEnvVar(key: string, defaultValue: string = ''): string {
  if (typeof window !== 'undefined' && window.ENV && window.ENV[key]) {
    return window.ENV[key];
  }

  if (import.meta.env[key]) {
    return import.meta.env[key];
  }

  return defaultValue;
}

/**
 * Get all environment variables that start with VITE_
 */
export function getAllEnvVars(): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (typeof window !== 'undefined' && window.ENV) {
    Object.entries(window.ENV).forEach(([key, value]) => {
      if (key.startsWith('VITE_')) {
        envVars[key] = value;
      }
    });
  }

  Object.entries(import.meta.env).forEach(([key, value]) => {
    if (key.startsWith('VITE_') && !envVars[key]) {
      envVars[key] = String(value);
    }
  });

  return envVars;
}

/**
 * Check if we're running in development mode
 */
export function isDevelopment(): boolean {
  return getEnvVar('VITE_NODE_ENV', import.meta.env.MODE) === 'development';
}

/**
 * Check if we're running in production mode
 */
export function isProduction(): boolean {
  return getEnvVar('VITE_NODE_ENV', import.meta.env.MODE) === 'production';
}
