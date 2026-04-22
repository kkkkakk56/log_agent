import { Capacitor, registerPlugin } from '@capacitor/core';

interface RenderSymbolOptions {
  name: string;
  pointSize?: number;
  weight?: 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
  scale?: 'small' | 'medium' | 'large';
  tintColor?: string;
}

interface RenderSymbolResult {
  dataUrl: string;
}

interface WeatherSymbolsPlugin {
  renderSymbol(options: RenderSymbolOptions): Promise<RenderSymbolResult>;
}

const WeatherSymbols = registerPlugin<WeatherSymbolsPlugin>('WeatherSymbols');
const symbolCache = new Map<string, Promise<string | null>>();

function buildCacheKey(options: RenderSymbolOptions): string {
  return [
    options.name,
    options.pointSize ?? 48,
    options.weight ?? 'light',
    options.scale ?? 'medium',
    options.tintColor ?? '#FFFFFF',
  ].join(':');
}

export async function renderWeatherSymbol(options: RenderSymbolOptions): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'ios') {
    return null;
  }

  const cacheKey = buildCacheKey(options);
  const cachedValue = symbolCache.get(cacheKey);

  if (cachedValue) {
    return cachedValue;
  }

  const pendingValue = WeatherSymbols.renderSymbol({
    pointSize: 48,
    weight: 'light',
    scale: 'medium',
    tintColor: '#FFFFFF',
    ...options,
  })
    .then((result) => result.dataUrl)
    .catch(() => null);

  symbolCache.set(cacheKey, pendingValue);

  return pendingValue;
}
