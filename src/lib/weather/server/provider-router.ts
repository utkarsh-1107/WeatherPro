import type {
  NormalizedWeatherData,
  WeatherProviderId,
} from "../schema";
import type {
  WeatherProvider,
  WeatherProviderAttempt,
  WeatherProviderInput,
} from "./provider-types";
import { metNorwayProvider } from "./providers/met-norway";
import { openMeteoProvider } from "./providers/open-meteo";

const providers: Record<
  WeatherProviderId,
  WeatherProvider
> = {
  "met-norway": metNorwayProvider,
  "open-meteo": openMeteoProvider,
};

function primaryProviderId(): WeatherProviderId {
  return process.env
    .WEATHER_PRIMARY_PROVIDER ===
    "open-meteo"
    ? "open-meteo"
    : "met-norway";
}

function providerOrder() {
  const primary = primaryProviderId();
  const fallback: WeatherProviderId =
    primary === "met-norway"
      ? "open-meteo"
      : "met-norway";

  return [primary, fallback] as const;
}

export async function getWeatherWithFailover(
  input: WeatherProviderInput
): Promise<{
  data: NormalizedWeatherData;
  provider: WeatherProviderId;
  fallbackUsed: boolean;
  responseTimeMs: number;
}> {
  const order = providerOrder();
  const attempts: WeatherProviderAttempt[] =
    [];

  for (
    let index = 0;
    index < order.length;
    index += 1
  ) {
    const providerId = order[index];
    const provider = providers[providerId];
    const startedAt = performance.now();

    try {
      const data =
        await provider.getForecast(input);

      const responseTimeMs = Math.round(
        performance.now() - startedAt
      );

      return {
        data: {
          ...data,
          source: {
            provider: providerId,
            fallbackUsed: index > 0,
            responseTimeMs,
            generatedAt:
              new Date().toISOString(),
          },
        },
        provider: providerId,
        fallbackUsed: index > 0,
        responseTimeMs,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown provider failure";

      attempts.push({
        provider: providerId,
        message,
      });

      console.warn(
        `[weather] ${providerId} failed; ${
          index === 0
            ? "trying fallback"
            : "no providers remain"
        }.`,
        message
      );
    }
  }

  throw new Error(
    `All weather providers failed: ${attempts
      .map(
        (attempt) =>
          `${attempt.provider}: ${attempt.message}`
      )
      .join(" | ")}`
  );
}
