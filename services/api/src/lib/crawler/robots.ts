import robotsParser from "robots-parser";
import { USER_AGENT } from "./fetcher";

type RobotsChecker = {
  isAllowed: (url: string) => boolean;
};

const PERMISSIVE: RobotsChecker = { isAllowed: () => true };

export async function fetchRobots(rootUrl: string): Promise<RobotsChecker> {
  const origin = new URL(rootUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;

  try {
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return PERMISSIVE;

    const text = await response.text();
    const parser = robotsParser(robotsUrl, text);

    return {
      isAllowed: (url: string) => parser.isAllowed(url, USER_AGENT) !== false,
    };
  } catch {
    return PERMISSIVE;
  }
}
