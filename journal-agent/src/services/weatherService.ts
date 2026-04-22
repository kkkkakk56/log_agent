export type WeatherCondition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

export interface WeatherHourForecast {
  id: string;
  time: string;
  hourLabel: string;
  temperature: number;
  precipitationProbability: number;
  condition: WeatherCondition;
  symbolName: string;
  isDay: boolean;
}

export interface WeatherSnapshot {
  locationLabel: string;
  locationSourceLabel: string;
  updatedLabel: string;
  summary: string;
  temperature: number;
  apparentTemperature: number;
  highTemperature: number;
  lowTemperature: number;
  precipitationProbability: number;
  windSpeed: number;
  condition: WeatherCondition;
  symbolName: string;
  isDay: boolean;
  hourly: WeatherHourForecast[];
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  displayName: string;
  sourceLabel: string;
}

interface OpenMeteoForecastResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    is_day: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    weather_code: number[];
    is_day: number[];
  };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

interface StoredWeatherLocation {
  latitude: number;
  longitude: number;
  savedAt: number;
}

const WEATHER_LOCATION_STORAGE_KEY = 'journal-agent.weather.location.v1';
const OPEN_METEO_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_LOCATION_TIMEOUT = 8_000;
const DEFAULT_WEATHER_LOCATIONS: Record<string, WeatherLocation> = {
  'Asia/Shanghai': {
    latitude: 31.2304,
    longitude: 121.4737,
    displayName: '上海',
    sourceLabel: '默认城市',
  },
  'Asia/Hong_Kong': {
    latitude: 22.3193,
    longitude: 114.1694,
    displayName: '香港',
    sourceLabel: '默认城市',
  },
  'Asia/Tokyo': {
    latitude: 35.6762,
    longitude: 139.6503,
    displayName: '东京',
    sourceLabel: '默认城市',
  },
  'America/Los_Angeles': {
    latitude: 37.7749,
    longitude: -122.4194,
    displayName: '旧金山',
    sourceLabel: '默认城市',
  },
  'America/New_York': {
    latitude: 40.7128,
    longitude: -74.006,
    displayName: '纽约',
    sourceLabel: '默认城市',
  },
  'Europe/London': {
    latitude: 51.5072,
    longitude: -0.1276,
    displayName: '伦敦',
    sourceLabel: '默认城市',
  },
};
const FALLBACK_WEATHER_LOCATION = DEFAULT_WEATHER_LOCATIONS['Asia/Shanghai'];

function roundTemperature(value: number): number {
  return Math.round(value);
}

function getWeatherCondition(code: number): WeatherCondition {
  if (code === 0) {
    return 'clear';
  }

  if ([45, 48].includes(code)) {
    return 'fog';
  }

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return 'rain';
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return 'snow';
  }

  if ([95, 96, 99].includes(code)) {
    return 'storm';
  }

  return 'cloudy';
}

function getWeatherSummary(code: number): string {
  if (code === 0) {
    return '晴朗';
  }

  if (code === 1) {
    return '大致晴朗';
  }

  if (code === 2) {
    return '局部多云';
  }

  if (code === 3) {
    return '阴天';
  }

  if ([45, 48].includes(code)) {
    return '有雾';
  }

  if ([51, 53, 55].includes(code)) {
    return '毛毛雨';
  }

  if ([56, 57].includes(code)) {
    return '冻毛雨';
  }

  if ([61, 63, 65].includes(code)) {
    return '下雨';
  }

  if ([66, 67].includes(code)) {
    return '冻雨';
  }

  if ([71, 73, 75].includes(code)) {
    return '下雪';
  }

  if (code === 77) {
    return '米雪';
  }

  if ([80, 81, 82].includes(code)) {
    return '阵雨';
  }

  if ([85, 86].includes(code)) {
    return '阵雪';
  }

  if (code === 95) {
    return '雷阵雨';
  }

  if ([96, 99].includes(code)) {
    return '雷暴伴冰雹';
  }

  return '多云';
}

function getWeatherSymbolName(code: number, isDay: boolean): string {
  const condition = getWeatherCondition(code);

  if (condition === 'clear') {
    return isDay ? 'sun.max.fill' : 'moon.stars.fill';
  }

  if (condition === 'cloudy') {
    return code === 1 || code === 2
      ? isDay
        ? 'cloud.sun.fill'
        : 'cloud.moon.fill'
      : 'cloud.fill';
  }

  if (condition === 'fog') {
    return 'cloud.fog.fill';
  }

  if (condition === 'rain') {
    return 'cloud.rain.fill';
  }

  if (condition === 'snow') {
    return 'snow';
  }

  return 'cloud.bolt.rain.fill';
}

function formatUpdatedLabel(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `更新于 ${hours}:${minutes}`;
}

function formatHourLabel(time: string): string {
  const date = new Date(time);
  const hours = String(date.getHours()).padStart(2, '0');

  return `${hours}时`;
}

function parseTimeToMs(time: string): number {
  const timestamp = Date.parse(time);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getNearestHourlyIndex(times: string[], referenceTime: string): number {
  const targetMs = parseTimeToMs(referenceTime);
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  times.forEach((time, index) => {
    const distance = Math.abs(parseTimeToMs(time) - targetMs);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function readStoredWeatherLocation(): StoredWeatherLocation | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed: unknown = JSON.parse(rawValue);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { latitude?: unknown }).latitude !== 'number' ||
      typeof (parsed as { longitude?: unknown }).longitude !== 'number' ||
      typeof (parsed as { savedAt?: unknown }).savedAt !== 'number'
    ) {
      return null;
    }

    return parsed as StoredWeatherLocation;
  } catch {
    return null;
  }
}

function saveWeatherLocation(latitude: number, longitude: number) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      WEATHER_LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude,
        longitude,
        savedAt: Date.now(),
      } satisfies StoredWeatherLocation),
    );
  } catch {
    // Weather can still work without persistence.
  }
}

function getDefaultWeatherLocation(): WeatherLocation {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return DEFAULT_WEATHER_LOCATIONS[timeZone] ?? FALLBACK_WEATHER_LOCATION;
}

function requestCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('当前环境不支持定位，已改用默认城市天气。'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: WEATHER_LOCATION_TIMEOUT,
      maximumAge: 15 * 60 * 1000,
    });
  });
}

export async function resolveWeatherLocation(): Promise<WeatherLocation> {
  try {
    const position = await requestCurrentPosition();
    const location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      displayName: '当前位置',
      sourceLabel: '当前定位',
    } satisfies WeatherLocation;

    saveWeatherLocation(location.latitude, location.longitude);

    return location;
  } catch {
    const storedLocation = readStoredWeatherLocation();

    if (storedLocation) {
      return {
        latitude: storedLocation.latitude,
        longitude: storedLocation.longitude,
        displayName: '上次位置',
        sourceLabel: '最近一次定位',
      };
    }

    return getDefaultWeatherLocation();
  }
}

export async function fetchWeatherSnapshot(
  location: WeatherLocation,
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const url = new URL(OPEN_METEO_FORECAST_ENDPOINT);

  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'apparent_temperature',
      'is_day',
      'weather_code',
      'wind_speed_10m',
    ].join(','),
  );
  url.searchParams.set(
    'hourly',
    ['temperature_2m', 'precipitation_probability', 'weather_code', 'is_day'].join(','),
  );
  url.searchParams.set('daily', ['temperature_2m_max', 'temperature_2m_min'].join(','));
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('precipitation_unit', 'mm');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '2');

  const response = await fetch(url.toString(), { signal });

  if (!response.ok) {
    throw new Error('天气服务暂时不可用，请稍后重试。');
  }

  const data = (await response.json()) as OpenMeteoForecastResponse;

  const currentCode = data.current.weather_code;
  const currentIsDay = data.current.is_day === 1;
  const currentCondition = getWeatherCondition(currentCode);
  const nearestHourlyIndex = getNearestHourlyIndex(data.hourly.time, data.current.time);
  const futureHourlyIndices = data.hourly.time
    .map((time, index) => ({
      time,
      index,
      timestamp: parseTimeToMs(time),
    }))
    .filter((item) => item.timestamp > parseTimeToMs(data.current.time))
    .slice(0, 7);

  const hourly: WeatherHourForecast[] = [
    {
      id: `current-${data.current.time}`,
      time: data.current.time,
      hourLabel: '现在',
      temperature: roundTemperature(data.current.temperature_2m),
      precipitationProbability:
        data.hourly.precipitation_probability[nearestHourlyIndex] ?? 0,
      condition: currentCondition,
      symbolName: getWeatherSymbolName(currentCode, currentIsDay),
      isDay: currentIsDay,
    },
    ...futureHourlyIndices.map((item) => {
      const code = data.hourly.weather_code[item.index] ?? currentCode;
      const isDay = (data.hourly.is_day[item.index] ?? 1) === 1;

      return {
        id: `${item.time}-${item.index}`,
        time: item.time,
        hourLabel: formatHourLabel(item.time),
        temperature: roundTemperature(data.hourly.temperature_2m[item.index] ?? 0),
        precipitationProbability:
          data.hourly.precipitation_probability[item.index] ?? 0,
        condition: getWeatherCondition(code),
        symbolName: getWeatherSymbolName(code, isDay),
        isDay,
      };
    }),
  ];

  return {
    locationLabel: location.displayName,
    locationSourceLabel: location.sourceLabel,
    updatedLabel: formatUpdatedLabel(new Date(data.current.time)),
    summary: getWeatherSummary(currentCode),
    temperature: roundTemperature(data.current.temperature_2m),
    apparentTemperature: roundTemperature(data.current.apparent_temperature),
    highTemperature: roundTemperature(data.daily.temperature_2m_max[0] ?? data.current.temperature_2m),
    lowTemperature: roundTemperature(data.daily.temperature_2m_min[0] ?? data.current.temperature_2m),
    precipitationProbability: data.hourly.precipitation_probability[nearestHourlyIndex] ?? 0,
    windSpeed: Math.round(data.current.wind_speed_10m),
    condition: currentCondition,
    symbolName: getWeatherSymbolName(currentCode, currentIsDay),
    isDay: currentIsDay,
    hourly,
  };
}
